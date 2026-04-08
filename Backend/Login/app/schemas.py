from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    class Config:
        from_attributes = True

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class DistrictStatus(BaseModel):
    district_id: str
    district_name: str
    lat: float
    lng: float
    probability: float
    risk_level: str
    has_disaster: bool
    disaster_type: str = "fire"

    class Config:
        from_attributes = True

class VillageResponse(BaseModel):
    id: int
    name: str
    fire_probability: float
    fire_risk_level: int
    risk_updated_at: Optional[datetime]

    class Config:
        from_attributes = True

class DistrictGuideRequest(BaseModel):
    lat: float
    lng: float
    has_disaster: bool = False

class SafeLocationRequest(BaseModel):
    lat: float
    lng: float
    current_district_id: Optional[str] = None
