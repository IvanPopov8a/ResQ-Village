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
    
    # Matches the PostGIS geography column in setup.js
    location = Column(Geography(geometry_type='POINT', srid=4326))
    
    # Focused on fire risk as requested
    fire_risk_level = Column(Integer, default=0)
    risk_updated_at = Column(TIMESTAMP)
    
    mayor_phone = Column(String(20))
    created_at = Column(TIMESTAMP, server_default=func.now())

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    hashed_password = Column(String)
    phone = Column(String(20), unique=True) 
    notify_flood = Column(Boolean, default=True)
    notify_earthquake = Column(Boolean, default=True)
    
    # Location tracking for proximity alerts
    last_lat = Column(DECIMAL(10, 7))
    last_lng = Column(DECIMAL(10, 7))
    last_location = Column(Geography(geometry_type='POINT', srid=4326))
    
    # Store WebPush keys
    push_subscription = Column(JSON)
    
    # Link to the user's primary village
    village_id = Column(Integer, ForeignKey("villages.id"))
    
    # Fire-specific notification settings
    notify_fire = Column(Boolean, default=True)
    min_level = Column(Integer, default=2) # 1=Low, 2=Medium, 3=Critical
    sms_fallback = Column(Boolean, default=False)
    
    last_seen = Column(TIMESTAMP, server_default=func.now())
    created_at = Column(TIMESTAMP, server_default=func.now())

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(50), default="fire") # Defaulting to fire as requested
    level = Column(Integer, nullable=False)
    level_name = Column(String(20), nullable=False) # e.g., "КРИТИЧНО"
    title_bg = Column(String(255))
    body_bg = Column(String(1000))
    active = Column(Boolean, default=True)
    notified_push = Column(Integer, default=0)
    notified_sms = Column(Integer, default=0)
    
    village_id = Column(Integer, ForeignKey("villages.id"))
    
    # Origin of the fire
    origin_lat = Column(DECIMAL(10, 7))
    origin_lng = Column(DECIMAL(10, 7))
    radius_meters = Column(Integer)
    
    # Stores raw sensor/model data that triggered the alert
    sensor_data = Column(JSON)
    
    title_bg = Column(String, nullable=False)
    body_bg = Column(String, nullable=False)
    
    notified_push = Column(Integer, default=0)
    notified_sms = Column(Integer, default=0)
    
    active = Column(Boolean, default=True)
    resolved_at = Column(TIMESTAMP)
    created_at = Column(TIMESTAMP, server_default=func.now())