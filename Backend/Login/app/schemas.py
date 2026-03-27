from pydantic import BaseModel, EmailStr, field_validator
import re

def validate_password_strength(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not any(char.isupper() for char in password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(char.islower() for char in password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not any(char.isdigit() for char in password):
        raise ValueError("Password must contain at least one number")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        raise ValueError("Password must contain at least one special character")
    return password

class UserCreate(BaseModel):
    email: EmailStr
    password: str

    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        return validate_password_strength(v)

class UserResponse(BaseModel):
    id: int
    email: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        return validate_password_strength(v)