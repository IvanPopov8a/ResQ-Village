import datetime
import asyncio
import httpx
import pandas as pd
import numpy as np
import joblib
import xgboost as xgb
import requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from apscheduler.schedulers.background import BackgroundScheduler

# Local project imports
from .database import engine, Base, get_db
from . import models, schemas, crud
from .auth import verify_password, create_access_token, get_current_user

# Importing your existing logic for Disaster Algorithm and Gemini Guides
from Disaster_algorythm.disaster_probability import (
    get_all_districts_status,
    get_unique_districts,
    haversine_distance,
    DistrictStatus,
)
from generateInstructions.ModelDefinition import (
    DisasterLocationRequest,
    LocationAwareSurvivalResponse,
    SafeDistrictInfo,
    generate_location_aware_guide,
    find_best_safe_district,
)

MODEL_PATH = 'best_fire_model_weight_50.0.joblib'
try:
    fire_model = joblib.load(MODEL_PATH)
    print(" XGBoost Model loaded successfully.")
except Exception as e:
    print(f" Warning: Could not load model. Error: {e}")
    fire_model = None

disaster_cache = {}


async def fetch_weather_and_predict(client: httpx.AsyncClient, district):
    """Fetches weather and predicts fire probability for a specific location."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": district.lat,
        "longitude": district.lng,
        "hourly": ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"],
        "past_days": 30,
        "forecast_days": 1,
        "timezone": "auto"
    }
    try:
        resp = await client.get(url, params=params, timeout=15.0)
        data = resp.json()
        df = pd.DataFrame(data['hourly'])
        df['time'] = pd.to_datetime(df['time'])

        # Forecast (12h from now)
        target_time = datetime.datetime.now() + pd.Timedelta(hours=12)
        idx_12h = (df['time'] - target_time).abs().idxmin()
        temp, hum, wind = df.loc[idx_12h, ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m']]

        # Past Rain (24h)
        now_idx = (df['time'] - datetime.datetime.now()).abs().idxmin()
        rain_24h = df.iloc[now_idx-24 : now_idx]['precipitation'].sum()
        
        # Days Since Rain
        history = df.iloc[:now_idx].copy()
        history['date'] = history['time'].dt.date
        daily_rain = history.groupby('date')['precipitation'].sum()
        days_since_rain = next((i for i, v in enumerate(reversed(daily_rain.values)) if v > 1.0), 30)

        drought_idx = max(0, (temp * 0.5) - (rain_24h * 2))
        fuel_idx = (temp / hum) * (1 + (days_since_rain / 10))

        if fire_model:
            features = [[temp, hum, wind, rain_24h, days_since_rain, drought_idx, fuel_idx]]
            cols = ['temp', 'hum', 'wind', 'rain', 'days_since_rain', 'drought_index', 'fuel_curing_index']
            input_df = pd.DataFrame(features, columns=cols)
            prob = float(fire_model.predict_proba(input_df)[0][1])
        else:
            prob = 0.0
        return str(district.id), prob
    except Exception:
        return str(district.id), 0.0

async def update_disaster_cache():
    print(f" Background Update Started: {datetime.datetime.now()}")
    db = Session(bind=engine)
    try:
        # Assuming your district/village table is 'models.District'
        districts = db.query(models.District).all()
        async with httpx.AsyncClient() as client:
            tasks = [fetch_weather_and_predict(client, d) for d in districts]
            results = await asyncio.gather(*tasks)
            for d_id, prob in results:
                disaster_cache[d_id] = {
                    "probability": prob,
                    "updated_at": datetime.datetime.now().isoformat()
                }
        print("Background Update Complete.")
    finally:
        db.close()

def scheduled_update():
    asyncio.run(update_disaster_cache())

# ---------------------------------------------------------------------------
# 3. FASTAPI LIFESPAN & APP INIT
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    scheduler = BackgroundScheduler()
    scheduler.add_job(scheduled_update, 'interval', minutes=60)
    scheduler.start()
    asyncio.create_task(update_disaster_cache()) # Initial run
    yield
    scheduler.shutdown()

app = FastAPI(title="ResQ Village API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# 4. ENDPOINTS: AUTH & PROFILE
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"message": "ResQ Village API is running", "model": "XGBoost Ready"}

@app.post("/users", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        return {"error": "Email already registered"}
    return crud.create_user(db, user)

@app.post("/login")
def login(user: schemas.LoginRequest, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        return {"error": "Invalid credentials"}
    token = create_access_token({"sub": db_user.email})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/profile")
def get_profile(current_user=Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email}

# ---------------------------------------------------------------------------
# 5. ENDPOINTS: DISASTER STATUS & GEOSPATIAL
# ---------------------------------------------------------------------------

@app.get("/districts/status", response_model=List[DistrictStatus], tags=["Disaster Risk"])
def get_districts_status(db: Session = Depends(get_db)):
    """Instant status from background-calculated cache."""
    db_districts = db.query(models.District).all()
    results = []
    for d in db_districts:
        cached = disaster_cache.get(str(d.id), {"probability": 0.0})
        p = cached["probability"]
        results.append({
            "district_id": str(d.id),
            "district_name": d.name,
            "lat": d.lat, "lng": d.lng,
            "probability": round(p, 4),
            "risk_level": "Extreme" if p > 0.75 else "High" if p > 0.4 else "Low",
            "has_disaster": p > 0.6,
            "disaster_type": "Fire"
        })
    return results

@app.post("/districts/guide", response_model=Optional[LocationAwareSurvivalResponse], tags=["Disaster Risk"])
def get_district_guide(request: DisasterLocationRequest):
    """Generates AI Bulgarian evacuation instructions based on safety scores."""
    return generate_location_aware_guide(request)

@app.get("/safe-location", response_model=dict, tags=["Disaster Risk"])
def get_safe_location(lat: float, lng: float, current_district_id: str = ""):
    """Finds nearest AND safest location using: (1-prob)/sqrt(dist+1)"""
    all_districts = get_districts_status(next(get_db())) # Reuses risk logic
    candidates = []
    for d in all_districts:
        if d["district_id"] == current_district_id: continue
        dist_km = haversine_distance(lat, lng, d["lat"], d["lng"])
        score = round((1.0 - d["probability"]) / (dist_km ** 0.5 + 1), 6)
        candidates.append({**d, "distance_km": dist_km, "safety_score": score})
    
    candidates.sort(key=lambda x: x["safety_score"], reverse=True)
    return {
        "user_location": {"lat": lat, "lng": lng},
        "best_option": candidates[0] if candidates else None,
        "all_options": candidates
    }

@app.post("/districts/refresh", tags=["Admin"])
async def manual_refresh(background_tasks: BackgroundTasks):
    """Trigger manual weather update across all districts."""
    background_tasks.add_task(update_disaster_cache)
    return {"status": "Update triggered"}