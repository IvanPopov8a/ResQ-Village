from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from .services import trigger_node_fire_alert
from Disaster_algorythm.disaster_probability import get_all_districts_status

from .database import engine, Base, get_db
from . import models, schemas, crud
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

app = FastAPI(title="ResQ Village API", version="1.0.0")


# Allow frontend (e.g. React / Vite dev server) to reach the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"message": "ResQ Village API is running"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.post("/users", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        return {"error": "Email already registered"}
    return crud.create_user(db, user)


from .auth import verify_password, create_access_token, get_current_user


@app.post("/login")
def login(user: schemas.LoginRequest, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if not db_user:
        return {"error": "Invalid credentials"}
    if not verify_password(user.password, db_user.hashed_password):
        return {"error": "Invalid credentials"}
    token = create_access_token({"sub": db_user.email})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/profile")
def get_profile(current_user=Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email}


# ---------------------------------------------------------------------------
# District Disaster Status
# ---------------------------------------------------------------------------

@app.get(
    "/districts/status",
    response_model=List[DistrictStatus],
    summary="Disaster probability for all Bulgarian districts",
    tags=["Disaster Risk"],
)
def get_districts_status():
    """
    Returns the current disaster probability for each of the 28 Bulgarian
    administrative districts (2 villages per district).

    Each entry includes:
    - **district_id**   – short code (e.g. \"SOF\")
    - **district_name** – village name
    - **probability**   – float [0.0 – 1.0]
    - **risk_level**    – Low | Medium | High | Critical
    - **disaster_type** – primary hazard
    - **lat / lng**     – district centroid GPS coordinates
    - **has_disaster**  – True when probability ≥ 0.50
    """
    return get_all_districts_status()


# ---------------------------------------------------------------------------
# AI Survival Guide — triggered for a specific district with active disaster
# ---------------------------------------------------------------------------

@app.post(
    "/districts/guide",
    response_model=Optional[LocationAwareSurvivalResponse],
    summary="Generate AI survival guide for a disaster district",
    tags=["Disaster Risk"],
)
def get_district_guide(request: DisasterLocationRequest):
    """
    Accepts the GPS coordinates and disaster status of a district.

    - If **has_disaster** is False → returns `null` (area is safe).
    - If **has_disaster** is True:
        1. Scans all 28 districts to find the **nearest + safest** destination.
        2. Calls the Gemini AI to generate Bulgarian evacuation instructions
           directing the user to that destination.

    The safety score formula used to rank destinations:

        safety_score = (1 - probability) / sqrt(distance_km + 1)

    This balances safety (low disaster risk) and proximity simultaneously.
    """
    return generate_location_aware_guide(request)


# ---------------------------------------------------------------------------
# Safe Location — pure geospatial routing (no AI, instant response)
# ---------------------------------------------------------------------------

@app.get(
    "/safe-location",
    response_model=dict,
    summary="Find the nearest AND safest district from given GPS coordinates",
    tags=["Disaster Risk"],
)
def get_safe_location(lat: float, lng: float, current_district_id: str = ""):
    """
    Given a user's GPS coordinates, returns a ranked list of the safest
    evacuation destinations across all Bulgarian districts.

    Query params:
    - **lat** – user latitude
    - **lng** – user longitude
    - **current_district_id** – (optional) district to exclude (the disaster zone)

    The best option is computed as:

        safety_score = (1 - probability) / sqrt(distance_km + 1)
    """
    all_districts = get_unique_districts()

    candidates = []
    for d in all_districts:
        if d["district_id"] == current_district_id:
            continue
        dist_km = haversine_distance(lat, lng, d["lat"], d["lng"])
        score   = round((1.0 - d["probability"]) / (dist_km ** 0.5 + 1), 6)
        candidates.append({
            "district_id":   d["district_id"],
            "district_name": d["district_name"],
            "lat":           d["lat"],
            "lng":           d["lng"],
            "probability":   d["probability"],
            "risk_level":    d["risk_level"],
            "disaster_type": d["disaster_type"],
            "has_disaster":  d["has_disaster"],
            "distance_km":   dist_km,
            "safety_score":  score,
        })

    # Sort by safety_score descending
    candidates.sort(key=lambda x: x["safety_score"], reverse=True)

    return {
        "user_location":      {"lat": lat, "lng": lng},
        "excluded_district":  current_district_id or None,
        "best_option":        candidates[0] if candidates else None,
        "all_options":        candidates,
    }

@app.get("/check-fire-risks")
def check_and_trigger_alerts(db: Session = Depends(get_db)):
    # 1. Get status from your ML/Mock algorithm
    statuses = get_all_districts_status() #
    
    triggered = []
    for status in statuses:
        # 2. If the risk is 'Critical' or 'High' (e.g., > 0.7)
        if status.probability >= 0.7 and status.disaster_type == "fire":
            # 3. Find the corresponding village in your Postgres DB
            village = db.query(models.Village).filter(models.Village.name == status.district_name).first()
            
            if village:
                # 4. Trigger the Node.js Alert Engine
                node_resp = trigger_node_fire_alert(
                    level=3 if status.risk_level == "Critical" else 2,
                    village_id=village.id,
                    lat=float(village.lat),
                    lng=float(village.lng)
                )
                triggered.append({"village": village.name, "node_status": node_resp})
                
    return {"status": "Processing complete", "alerts_sent": triggered}