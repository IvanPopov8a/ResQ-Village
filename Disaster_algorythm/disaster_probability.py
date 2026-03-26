"""
disaster_probability.py
-----------------------
Mock algorithm that calculates the disaster probability for each Bulgarian district.

In production this module will be replaced by the real ML model developed by the team.
The function signature and response format are already finalized so the frontend
integration can be done independently.

Algorithm (mock):
  - Each district is pre-seeded with a deterministic base risk score derived from
    known geographical / historical data (flood-prone valleys, seismic zones, etc.)
  - A small pseudo-random delta is added to simulate live sensor noise so that
    repeated calls return slightly different values (as will the real model).
  - The final probability is clamped to [0.0, 1.0].

Response structure per district:
  {
      "district_id":   str   -ISO / internal identifier
      "district_name": str   - Bulgarian name of the district
      "probability":   float - disaster probability [0.0 - 1.0]
      "risk_level":    str   - "Low" | "Medium" | "High" | "Critical"
      "disaster_type": str   - most likely disaster type for this district
  }
"""

import random
import hashlib
import time
from typing import List
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Pydantic schema
# ---------------------------------------------------------------------------

class DistrictStatus(BaseModel):
    district_id: str = Field(..., description="Unique identifier of the district")
    district_name: str = Field(..., description="Bulgarian name of the district")
    probability: float = Field(..., ge=0.0, le=1.0, description="Disaster probability [0.0 – 1.0]")
    risk_level: str = Field(..., description="Risk category: Low | Medium | High | Critical")
    disaster_type: str = Field(..., description="Most likely disaster type for this district")


# ---------------------------------------------------------------------------
# Static district data for all 28 Bulgarian administrative districts.
# base_risk: a hand-tuned value [0.0 – 1.0] reflecting known vulnerability
#   (seismic zones, flood plains, wildfire history, etc.)
# primary_disaster: dominant hazard type for that region
# ---------------------------------------------------------------------------

_DISTRICTS = [
    # (id, village name, base_risk, primary_disaster)
    # – 2 largest villages per administrative district –

    # Благоевград (BLG) — wildfire risk, Rhodope/Struma valleys
    ("BLG", "Брезница",     0.45, "wildfire"),   # ~3 377 жит.
    ("BLG", "Първомай",     0.45, "wildfire"),   # ~3 354 жит.

    # Бургас (BGS) — flood / coastal storm risk
    ("BGS", "Равда",        0.55, "flood"),      # ~3 105 жит.
    ("BGS", "Българово",    0.55, "flood"),      # ~1 474 жит.

    # Варна (VAR) — coastal storm risk
    ("VAR", "Игнатиево",    0.40, "storm"),      # ~4 033 жит.
    ("VAR", "Тополи",       0.40, "storm"),      # ~3 154 жит.

    # Велико Търново (VTR) — earthquake risk (Dryanovo fault)
    ("VTR", "Леденик",      0.30, "earthquake"), # ~1 620 жит.
    ("VTR", "Шемшево",      0.30, "earthquake"), # ~1 480 жит.

    # Видин (VID) — Danube flood risk
    ("VID", "Арчар",        0.50, "flood"),      # ~2 296 жит.
    ("VID", "Покрайна",     0.50, "flood"),      # ~1 095 жит.

    # Враца (VRC) — flood risk (Iskar gorge / Danube plain)
    ("VRC", "Селановци",    0.48, "flood"),      # ~3 349 жит.
    ("VRC", "Бутан",        0.48, "flood"),      # ~2 828 жит.

    # Габрово (GAB) — flash-flood risk (Yantra headwaters)
    ("GAB", "Ряховците",    0.25, "flood"),      # ~1 304 жит.
    ("GAB", "Петко Славейков", 0.25, "flood"),   # ~1 037 жит.

    # Добрич (DOB) — drought risk (Dobrudzha plain)
    ("DOB", "Крупен",       0.20, "drought"),    # ~1 350 жит.
    ("DOB", "Плачи дол",    0.20, "drought"),    # ~1 180 жит.

    # Кърджали (KRZ) — earthquake risk (Plovdiv-Haskovo seismic zone)
    ("KRZ", "Бенковски",    0.60, "earthquake"), # ~2 469 жит.
    ("KRZ", "Бял извор",    0.60, "earthquake"), # ~1 351 жит.

    # Кюстендил (KNL) — wildfire risk (Osogovo mountains)
    ("KNL", "Жиленци",      0.38, "wildfire"),   # ~1 490 жит.
    ("KNL", "Слокощица",    0.38, "wildfire"),   # ~1 260 жит.

    # Ловеч (LOV) — flood risk (Osam / Vit rivers)
    ("LOV", "Дерманци",     0.35, "flood"),      # ~2 027 жит.
    ("LOV", "Градежница",   0.35, "flood"),      # ~1 818 жит.

    # Монтана (MON) — flood risk (Ogosta river)
    ("MON", "Лехчево",      0.42, "flood"),      # ~1 721 жит.
    ("MON", "Медковец",     0.42, "flood"),      # ~1 711 жит.

    # Пазарджик (PAZ) — flood risk (Maritsa river)
    ("PAZ", "Драгиново",    0.52, "flood"),      # ~4 872 жит.
    ("PAZ", "Мало Конаре",  0.52, "flood"),      # ~3 984 жит.

    # Перник (PER) — earthquake risk (Sofia seismic zone)
    ("PER", "Батановци",    0.33, "earthquake"), # ~1 680 жит.
    ("PER", "Студена",      0.33, "earthquake"), # ~1 340 жит.

    # Плевен (PVN) — flood risk (Danube tributaries)
    ("PVN", "Буковлък",     0.40, "flood"),      # ~4 407 жит.
    ("PVN", "Ясен",         0.40, "flood"),      # ~2 475 жит.

    # Пловдив (PDV) — earthquake risk (Plovdiv basin)
    ("PDV", "Розино",       0.50, "earthquake"), # ~4 964 жит.
    ("PDV", "Труд",         0.50, "earthquake"), # ~4 070 жит.

    # Разград (RAZ) — drought risk (Ludogorie plateau)
    ("RAZ", "Дянково",      0.28, "drought"),    # ~2 675 жит.
    ("RAZ", "Ясеновец",     0.28, "drought"),    # ~2 375 жит.

    # Русе (RSE) — Danube flood risk
    ("RSE", "Николово",     0.45, "flood"),      # ~2 961 жит.
    ("RSE", "Тетово",       0.45, "flood"),      # ~2 060 жит.

    # Силистра (SLS) — Danube flood risk
    ("SLS", "Айдемир",      0.38, "flood"),      # ~5 914 жит.
    ("SLS", "Калипетрово",  0.38, "flood"),      # ~4 085 жит.

    # Сливен (SLV) — wildfire risk (Balkan mountains)
    ("SLV", "Градец",       0.55, "wildfire"),   # ~4 476 жит.
    ("SLV", "Тополчане",    0.55, "wildfire"),   # ~2 100 жит.

    # Смолян (SML) — landslide risk (central Rhodopes)
    ("SML", "Борино",       0.62, "landslide"),  # ~2 393 жит.
    ("SML", "Старцево",     0.62, "landslide"),  # ~2 212 жит.

    # София-град (SOF) — earthquake risk (Sofia basin)
    ("SOF", "Лозен",        0.35, "earthquake"), # ~6 592 жит.
    ("SOF", "Бистрица",     0.35, "earthquake"), # ~6 018 жит.

    # София-област (SFO) — wildfire risk (Vitosha / Ihtiman)
    ("SFO", "Казичене",     0.40, "wildfire"),   # ~4 627 жит.
    ("SFO", "Владая",       0.40, "wildfire"),   # ~4 023 жит.

    # Стара Загора (SZR) — wildfire risk (Thracian plain)
    ("SZR", "Михайлово",    0.48, "wildfire"),   # ~2 050 жит.
    ("SZR", "Братя Даскалови", 0.48, "wildfire"),# ~1 820 жит.

    # Търговище (TGV) — drought risk (Preslav plain)
    ("TGV", "Лиляк",        0.30, "drought"),    # ~1 027 жит.
    ("TGV", "Голямо ново",  0.30, "drought"),    # ~953  жит.

    # Хасково (HKV) — wildfire risk (Eastern Rhodopes)
    ("HKV", "Узунджово",    0.43, "wildfire"),   # ~1 738 жит.
    ("HKV", "Войводово",    0.43, "wildfire"),   # ~1 181 жит.

    # Шумен (SHU) — drought risk (Shumen plateau)
    ("SHU", "Ивански",      0.32, "drought"),    # ~1 552 жит.
    ("SHU", "Браничево",    0.32, "drought"),    # ~1 299 жит.

    # Ямбол (JAM) — wildfire risk (Sakar mountains)
    ("JAM", "Зимница",      0.38, "wildfire"),   # ~1 745 жит.
    ("JAM", "Кукорево",     0.38, "wildfire"),   # ~1 668 жит.
]


# ---------------------------------------------------------------------------
# Risk level mapping
# ---------------------------------------------------------------------------

def _probability_to_risk_level(probability: float) -> str:
    if probability < 0.25:
        return "Low"
    elif probability < 0.50:
        return "Medium"
    elif probability < 0.75:
        return "High"
    else:
        return "Critical"


# ---------------------------------------------------------------------------
# Mock algorithm
# ---------------------------------------------------------------------------

def _mock_disaster_algorithm(district_id: str, village_name: str, base_risk: float) -> float:
    """
    Simulates the real ML model.

    Deterministic seed = hash of (district_id + village_name + current hour) so
    values are stable within the same hour but differ between villages and change
    each hour, mimicking periodic satellite / sensor updates.

    TODO: Replace the body of this function with the real model call once
          the ML pipeline is integrated.
    """
    hour_bucket = str(int(time.time()) // 3600)
    seed_str = district_id + village_name + hour_bucket
    seed_int = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % (2 ** 32)

    rng = random.Random(seed_int)
    delta = rng.uniform(-0.12, 0.12)          # ±12 % live noise

    probability = base_risk + delta
    return round(max(0.0, min(1.0, probability)), 4)


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def get_all_districts_status() -> List[DistrictStatus]:
    """
    Returns disaster probability status for every Bulgarian district.

    This is the main function called from the FastAPI endpoint.
    Replace `_mock_disaster_algorithm` with the real model to go live.
    """
    results = []
    for district_id, village_name, base_risk, disaster_type in _DISTRICTS:
        prob = _mock_disaster_algorithm(district_id, village_name, base_risk)
        results.append(
            DistrictStatus(
                district_id=district_id,
                district_name=village_name,
                probability=prob,
                risk_level=_probability_to_risk_level(prob),
                disaster_type=disaster_type,
            )
        )
    return results
