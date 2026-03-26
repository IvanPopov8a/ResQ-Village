from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session

from .database import engine, Base, get_db
from . import models, schemas, crud

app = FastAPI()

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



