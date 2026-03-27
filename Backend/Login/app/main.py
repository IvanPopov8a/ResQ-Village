import datetime
import asyncio
import httpx
import pandas as pd
import numpy as np
import joblib
import xgboost as xgb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .database import engine, SessionLocal, get_db
from . import models, schemas, crud
from .auth import verify_password, create_access_token, get_current_user
from .services import trigger_node_alert

# ---------------------------------------------------------------------------
# 1. LOAD MODEL
# ---------------------------------------------------------------------------
MODEL_PATH = 'best_fire_model_weight_50.0.joblib'
try:
    fire_model = joblib.load(MODEL_PATH)
    print("✅ AI Model loaded and ready.")
except Exception as e:
    print(f"⚠️ Warning: AI Model could not load: {e}")
    fire_model = None

# ---------------------------------------------------------------------------
# 2. HOURLY BACKGROUND INFERENCE LOGIC
# ---------------------------------------------------------------------------

# Global semaphore to limit concurrent HTTP requests (prevents API rate-limiting)
http_semaphore = asyncio.Semaphore(10)

async def fetch_and_predict(client: httpx.AsyncClient, village: dict):
    """
    Fetches weather, calculates KBDI correctly, and makes a prediction.
    Returns a dictionary of updates rather than accessing the DB directly.
    """
    async with http_semaphore:
        now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        result = {"id": village["id"], "success": False}

        # --- A. PERSISTENCE LOGIC (Retention) ---
        if village["fire_event_started_at"]:
            hours_passed = (now_utc - village["fire_event_started_at"]).total_seconds() / 3600
            
            if hours_passed < 14:
                print(f"🔥 {village['name']} is in PERSISTENCE MODE (Hour {hours_passed:.1f}/14).")
                result["success"] = True
                return result
            else:
                result["clear_persistence"] = True

        # --- B. DRILL / SYNTHETIC DATA LOGIC ---
        is_drill_time = (
            village["id"] == 1 and 
            now_utc.date() == datetime.date(2026, 3, 28) and 
            now_utc.hour >= 7 # 7 AM UTC is 9 AM Bulgarian Time
        )

        if is_drill_time:
            print(f"🚨 [DRILL] Injecting synthetic fire data for {village['name']}")
            temp, hum, wind = 42.0, 11.0, 38.0
            rain_24h = 0.0
            dsr = 30
            drought_idx = 400.0 # High KBDI
            fuel_idx = 0.95
        else:
            # NORMAL OPERATION: Fetch real weather
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": village["lat"],
                "longitude": village["lng"],
                "hourly": ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"],
                "daily": ["temperature_2m_max", "precipitation_sum"],
                "past_days": 60,   # Need 60 days to accurately calculate KBDI
                "forecast_days": 1,
                "timezone": "UTC"
            }
            
            try:
                resp = await client.get(url, params=params, timeout=15.0)
                if resp.status_code != 200: return result
                data = resp.json()
                
                # 1. Compute Historical Derived Features (KBDI & Days Since Rain)
                daily_df = pd.DataFrame(data['daily'])
                dsr = 0
                kbdi = 50.0
                for _, row in daily_df.iterrows():
                    rain = float(row.get('precipitation_sum', 0) or 0)
                    temp_max = float(row.get('temperature_2m_max', 25) or 25)
                    dsr = 0 if rain > 1.0 else dsr + 1
                    net_rain = max(0.0, rain - 5.0)
                    daily_drying = ((800 - kbdi) * (0.968 * np.exp(0.0486 * temp_max) - 8.3)) / 1000
                    kbdi = float(np.clip(kbdi + daily_drying - net_rain * 3.94, 0, 800))
                
                drought_idx = round(kbdi, 2)

                # 2. Extract 12h Forecast for immediate conditions
                hourly_df = pd.DataFrame(data['hourly'])
                hourly_df['time'] = pd.to_datetime(hourly_df['time']).dt.tz_localize(None)

                target_time = now_utc + pd.Timedelta(hours=12)
                idx = (hourly_df['time'] - target_time).abs().idxmin()
                
                temp = hourly_df.loc[idx, 'temperature_2m']
                hum = hourly_df.loc[idx, 'relative_humidity_2m']
                wind = hourly_df.loc[idx, 'wind_speed_10m']
                
                # 3. Calculate trailing 24h rain
                now_idx = (hourly_df['time'] - now_utc).abs().idxmin()
                rain_24h = hourly_df.iloc[max(0, now_idx-24) : now_idx]['precipitation'].sum()
                
                # 4. Calculate final fuel curing based on predicted humidity
                fuel_idx = round(float(np.clip(0.3 + (kbdi/800)*0.4 + max(0, (50-hum)/50)*0.3, 0.3, 1.0)), 3)

            except Exception as e:
                print(f"❌ Weather Fetch Error for {village['name']}: {e}")
                return result

        # --- C. PREDICTION ---
        if fire_model:
            features = [[temp, hum, wind, rain_24h, dsr, drought_idx, fuel_idx]]
            input_df = pd.DataFrame(features, columns=['temp', 'hum', 'wind', 'rain', 'days_since_rain', 'drought_index', 'fuel_curing_index'])
            
            prob = float(fire_model.predict_proba(input_df)[0][1])
            
            result["update_predictions"] = True
            result["prob"] = prob
            result["risk_level"] = 3 if prob > 0.75 else 2 if prob > 0.4 else 1
            result["ignite"] = (prob > 0.75 and village["fire_event_started_at"] is None)
            
        result["success"] = True
        return result

async def run_global_inference():
    """Loops through all villages safely."""
    print(f"🔄 [Inference Engine] Cycle started: {datetime.datetime.utcnow()}")
    
    # Read Phase
    db = SessionLocal()
    try:
        villages = db.query(models.Village).all()
        # Extract data into simple dictionaries so we don't pass SQLAlchemy objects to async tasks
        village_dicts = [{
            "id": v.id,
            "name": v.name,
            "lat": float(v.lat),
            "lng": float(v.lng),
            "fire_event_started_at": v.fire_event_started_at
        } for v in villages]
    finally:
        db.close()

    # Async Fetch Phase
    async with httpx.AsyncClient() as client:
        tasks = [fetch_and_predict(client, vd) for vd in village_dicts]
        results = await asyncio.gather(*tasks)
        
    # Write Phase (Sequential, safe for the database)
    db_write = SessionLocal()
    try:
        for res in results:
            if not res or not res.get("success"):
                continue
                
            v = db_write.query(models.Village).get(res["id"])
            
            if res.get("clear_persistence"):
                v.fire_event_started_at = None
                
            if res.get("update_predictions"):
                v.fire_probability = res["prob"]
                v.fire_risk_level = res["risk_level"]
                
                if res.get("ignite"):
                    v.fire_event_started_at = datetime.datetime.utcnow()
                    trigger_node_alert(
                        disaster_type="fire",
                        level=3,
                        village_id=v.id,
                        lat=float(v.lat),
                        lng=float(v.lng)
                    )
        db_write.commit()
        print("✅ [Inference Engine] All villages updated successfully.")
    except Exception as e:
        print(f"🚨 [Inference Engine] Global DB Write Error: {e}")
        db_write.rollback()
    finally:
        db_write.close()

# ---------------------------------------------------------------------------
# 3. LIFECYCLE & APP SETUP
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    models.Base.metadata.create_all(bind=engine)
    
    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_global_inference, 'interval', minutes=60)
    scheduler.start()
    
    # Run once immediately on startup
    asyncio.create_task(run_global_inference())
    
    yield
    # Shutdown
    scheduler.shutdown()

app = FastAPI(title="ResQ Village AI API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# 4. ENDPOINTS
# ---------------------------------------------------------------------------

@app.get("/districts/status", response_model=List[schemas.DistrictStatus])
def get_status(db: Session = Depends(get_db)):
    """
    Returns the last stored data.
    If the 14h window is active, it enforces a 'Critical' state.
    """
    villages = db.query(models.Village).all()
    results = []
    
    # Standardize to naive UTC for accurate comparison against DB timestamps
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    
    for v in villages:
        is_active_fire = False
        if v.fire_event_started_at:
            elapsed = (now_utc - v.fire_event_started_at).total_seconds() / 3600
            if elapsed < 14:
                is_active_fire = True

        # Override probability to 99% if fire is persistent
        prob = 0.99 if is_active_fire else float(v.fire_probability or 0.0)
        
        results.append({
            "district_id": str(v.id),
            "district_name": v.name,
            "lat": float(v.lat),
            "lng": float(v.lng),
            "probability": prob,
            "risk_level": "Critical" if prob > 0.75 else "High" if prob > 0.4 else "Low",
            "has_disaster": prob > 0.6,
            "disaster_type": "fire"
        })
    return results

@app.post("/users", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    return crud.create_user(db, user)

@app.post("/login")
def login(user: schemas.LoginRequest, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        return {"error": "Invalid credentials"}
    
    token = create_access_token({"sub": db_user.email})
    return {"access_token": token, "token_type": "bearer"}
