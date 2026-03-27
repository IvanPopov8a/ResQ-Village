from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

from .database import engine, Base, get_db
from . import models, schemas, crud
from Disaster_algorythm.disaster_probability import get_all_districts_status, DistrictStatus

app = FastAPI(title="ResQ Village API", version="1.0.0")


# Allow frontend (e.g. React / Vite dev server) to reach the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


@app.get("/")
def root():
    return {"message": "API is running"}


@app.post("/users", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)

    if db_user:
        return {"error": "Email already registered"}

    return crud.create_user(db, user)

from .auth import verify_password, create_access_token
from .auth import get_current_user


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
def get_profile(current_user = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email
    }


# ---------------------------------------------------------------------------
# District Disaster Status
# ---------------------------------------------------------------------------

@app.get(
    "/districts/status",
    response_model=List[DistrictStatus],
    summary="Get disaster probability for all Bulgarian districts",
    tags=["Disaster Risk"],
)
def get_districts_status():
    """
    Returns the current disaster probability for each of the 28 Bulgarian
    administrative districts.

    Each district entry contains:
    - **district_id**   – short code (e.g. "SOF")
    - **district_name** – Bulgarian name (e.g. "София-град")
    - **probability**   – float in [0.0 – 1.0]
    - **risk_level**    – Low | Medium | High | Critical
    - **disaster_type** – most likely hazard for that region

    > **Note**: The underlying algorithm is currently a *mock*. The production
    > ML model will replace it without changing this endpoint's contract.
    """
    return get_all_districts_status()

@app.post("/refresh")
def refresh_token(refresh_token: str, db: Session = Depends(get_db)):
    # 1. Decode and validate the refresh token
    email = decode_access_token(refresh_token)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    
    # 2. Generate a fresh ACCESS token
    new_access_token = create_access_token({"sub": email})
    return {"access_token": new_access_token, "token_type": "bearer"}



