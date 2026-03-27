from sqlalchemy.orm import Session
from . import models, schemas
from .auth import hash_password
from sqlalchemy import func
from geoalchemy2.functions import ST_SetSRID, ST_MakePoint


def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()


def create_user(db: Session, user: schemas.UserCreate):
    hashed_password = hash_password(user.password)

    db_user = models.User(
        email=user.email,
        hashed_password=hashed_password
        notify_fire=True,
        min_level=2
    )

    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    return db_user

