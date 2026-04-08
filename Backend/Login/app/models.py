from sqlalchemy import Column, Integer, String, DECIMAL, TIMESTAMP, Boolean, ForeignKey, JSON
from sqlalchemy.sql import func
from geoalchemy2 import Geography
from .database import Base

class Village(Base):
    __tablename__ = "villages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    oblast = Column(String(255), nullable=False)
    lat = Column(DECIMAL(10, 7), nullable=False)
    lng = Column(DECIMAL(10, 7), nullable=False)
    
    # PostGIS geography column
    location = Column(Geography(geometry_type='POINT', srid=4326))
    
    # AI Prediction Storage (The "Cache")
    fire_probability = Column(DECIMAL(5, 4), default=0.0)
    fire_risk_level = Column(Integer, default=0) # 1=Low, 2=High, 3=Critical
    fire_event_started_at = Column(TIMESTAMP, nullable=True)
    risk_updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    
    created_at = Column(TIMESTAMP, server_default=func.now())

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)

    phone = Column(String(20), unique=True) 
    notify_flood = Column(Boolean, default=True)
    notify_earthquake = Column(Boolean, default=True)
    
    # Location tracking for proximity alerts

    last_lat = Column(DECIMAL(10, 7))
    last_lng = Column(DECIMAL(10, 7))
    village_id = Column(Integer, ForeignKey("villages.id"))
    notify_fire = Column(Boolean, default=True)
    min_level = Column(Integer, default=2)
    last_seen = Column(TIMESTAMP, server_default=func.now())
    created_at = Column(TIMESTAMP, server_default=func.now())

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(50), default="fire")
    level = Column(Integer, nullable=False)

    level_name = Column(String(20), nullable=False) # e.g., "КРИТИЧНО"
    title_bg = Column(String(255))
    body_bg = Column(String(1000))
    active = Column(Boolean, default=True)
    notified_push = Column(Integer, default=0)
    notified_sms = Column(Integer, default=0)

    village_id = Column(Integer, ForeignKey("villages.id"))
    created_at = Column(TIMESTAMP, server_default=func.now())