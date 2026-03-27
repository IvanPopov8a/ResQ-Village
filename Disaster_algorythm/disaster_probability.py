"""
disaster_probability.py
-----------------------
Mock algorithm for disaster probability per Bulgarian district.
Tuple format: (district_id, village_name, base_risk, disaster_type, lat, lng)
"""

import random
import hashlib
import time
import math
from typing import List, Dict
from pydantic import BaseModel, Field


class DistrictStatus(BaseModel):
    district_id:   str   = Field(..., description="Short district code")
    district_name: str   = Field(..., description="Bulgarian name")
    probability:   float = Field(..., ge=0.0, le=1.0)
    risk_level:    str   = Field(..., description="Low | Medium | High | Critical")
    disaster_type: str   = Field(..., description="Primary hazard type")
    lat:           float = Field(..., description="District centroid latitude")
    lng:           float = Field(..., description="District centroid longitude")
    has_disaster:  bool  = Field(..., description="True when probability >= 0.50")


# (id, village, base_risk, disaster_type, lat, lng)
_DISTRICTS = [
    ("BLG", "Брезница",          0.45, "wildfire",   41.90, 23.50),
    ("BLG", "Първомай",          0.45, "wildfire",   41.90, 23.50),
    ("BGS", "Равда",             0.55, "flood",      42.50, 27.47),
    ("BGS", "Българово",         0.55, "flood",      42.50, 27.47),
    ("VAR", "Игнатиево",         0.40, "storm",      43.20, 27.90),
    ("VAR", "Тополи",            0.40, "storm",      43.20, 27.90),
    ("VTR", "Леденик",           0.30, "earthquake", 43.07, 25.62),
    ("VTR", "Шемшево",           0.30, "earthquake", 43.07, 25.62),
    ("VID", "Арчар",             0.50, "flood",      43.98, 22.87),
    ("VID", "Покрайна",          0.50, "flood",      43.98, 22.87),
    ("VRC", "Селановци",         0.48, "flood",      43.20, 23.55),
    ("VRC", "Бутан",             0.48, "flood",      43.20, 23.55),
    ("GAB", "Ряховците",         0.25, "flood",      42.87, 25.32),
    ("GAB", "Петко Славейков",   0.25, "flood",      42.87, 25.32),
    ("DOB", "Крупен",            0.20, "drought",    43.57, 27.83),
    ("DOB", "Плачи дол",         0.20, "drought",    43.57, 27.83),
    ("KRZ", "Бенковски",         0.60, "earthquake", 41.64, 25.37),
    ("KRZ", "Бял извор",         0.60, "earthquake", 41.64, 25.37),
    ("KNL", "Жиленци",           0.38, "wildfire",   42.28, 22.69),
    ("KNL", "Слокощица",         0.38, "wildfire",   42.28, 22.69),
    ("LOV", "Дерманци",          0.35, "flood",      43.13, 24.72),
    ("LOV", "Градежница",        0.35, "flood",      43.13, 24.72),
    ("MON", "Лехчево",           0.42, "flood",      43.41, 23.22),
    ("MON", "Медковец",          0.42, "flood",      43.41, 23.22),
    ("PAZ", "Драгиново",         0.52, "flood",      42.19, 24.33),
    ("PAZ", "Мало Конаре",       0.52, "flood",      42.19, 24.33),
    ("PER", "Батановци",         0.33, "earthquake", 42.61, 23.04),
    ("PER", "Студена",           0.33, "earthquake", 42.61, 23.04),
    ("PVN", "Буковлък",          0.40, "flood",      43.41, 24.62),
    ("PVN", "Ясен",              0.40, "flood",      43.41, 24.62),
    ("PDV", "Розино",            0.50, "earthquake", 42.14, 24.75),
    ("PDV", "Труд",              0.50, "earthquake", 42.14, 24.75),
    ("RAZ", "Дянково",           0.28, "drought",    43.53, 26.52),
    ("RAZ", "Ясеновец",          0.28, "drought",    43.53, 26.52),
    ("RSE", "Николово",          0.45, "flood",      43.85, 25.95),
    ("RSE", "Тетово",            0.45, "flood",      43.85, 25.95),
    ("SLS", "Айдемир",           0.38, "flood",      44.12, 27.27),
    ("SLS", "Калипетрово",       0.38, "flood",      44.12, 27.27),
    ("SLV", "Градец",            0.55, "wildfire",   42.68, 26.32),
    ("SLV", "Тополчане",         0.55, "wildfire",   42.68, 26.32),
    ("SML", "Борино",            0.62, "landslide",  41.57, 24.71),
    ("SML", "Старцево",          0.62, "landslide",  41.57, 24.71),
    ("SOF", "Лозен",             0.35, "earthquake", 42.69, 23.32),
    ("SOF", "Бистрица",          0.35, "earthquake", 42.69, 23.32),
    ("SFO", "Казичене",          0.40, "wildfire",   42.73, 23.82),
    ("SFO", "Владая",            0.40, "wildfire",   42.73, 23.82),
    ("SZR", "Михайлово",         0.48, "wildfire",   42.42, 25.63),
    ("SZR", "Братя Даскалови",   0.48, "wildfire",   42.42, 25.63),
    ("TGV", "Лиляк",             0.30, "drought",    43.25, 26.57),
    ("TGV", "Голямо ново",       0.30, "drought",    43.25, 26.57),
    ("HKV", "Узунджово",         0.43, "wildfire",   41.93, 25.55),
    ("HKV", "Войводово",         0.43, "wildfire",   41.93, 25.55),
    ("SHU", "Ивански",           0.32, "drought",    43.27, 26.92),
    ("SHU", "Браничево",         0.32, "drought",    43.27, 26.92),
    ("JAM", "Зимница",           0.38, "wildfire",   42.48, 26.50),
    ("JAM", "Кукорево",          0.38, "wildfire",   42.48, 26.50),
]


def _probability_to_risk_level(probability: float) -> str:
    if probability < 0.25:   return "Low"
    elif probability < 0.50: return "Medium"
    elif probability < 0.75: return "High"
    else:                    return "Critical"


def _mock_disaster_algorithm(district_id: str, village_name: str, base_risk: float) -> float:
    """Deterministic mock — stable within the same hour, changes each hour."""
    hour_bucket = str(int(time.time()) // 3600)
    seed_str = district_id + village_name + hour_bucket
    seed_int = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % (2 ** 32)
    rng = random.Random(seed_int)
    delta = rng.uniform(-0.12, 0.12)
    return round(max(0.0, min(1.0, base_risk + delta)), 4)


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Returns distance in km between two GPS points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return round(R * 2 * math.asin(math.sqrt(a)), 2)


def get_all_districts_status() -> List[DistrictStatus]:
    """Returns live disaster probability status for every district entry."""
    results = []
    for district_id, village_name, base_risk, disaster_type, lat, lng in _DISTRICTS:
        prob = _mock_disaster_algorithm(district_id, village_name, base_risk)
        results.append(DistrictStatus(
            district_id=district_id,
            district_name=village_name,
            probability=prob,
            risk_level=_probability_to_risk_level(prob),
            disaster_type=disaster_type,
            lat=lat,
            lng=lng,
            has_disaster=prob >= 0.50,
        ))
    return results


def get_unique_districts() -> List[Dict]:
    """
    Returns one representative entry per district (deduped).
    Used by the safe-location routing and AI guide logic.
    """
    seen: set = set()
    result = []
    for district_id, village_name, base_risk, disaster_type, lat, lng in _DISTRICTS:
        if district_id in seen:
            continue
        seen.add(district_id)
        prob = _mock_disaster_algorithm(district_id, village_name, base_risk)
        result.append({
            "district_id":   district_id,
            "district_name": village_name,
            "disaster_type": disaster_type,
            "lat":           lat,
            "lng":           lng,
            "probability":   prob,
            "risk_level":    _probability_to_risk_level(prob),
            "has_disaster":  prob >= 0.50,
        })
    return result
