import os
import sys
import json
import math
from typing import List, Optional

import google.generativeai as genai
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Path setup — ensures disaster_probability is importable from any cwd
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from Disaster_algorythm.disaster_probability import (
    get_unique_districts,
    haversine_distance,
    _probability_to_risk_level,
)

# ---------------------------------------------------------------------------
# Gemini configuration
# ---------------------------------------------------------------------------
load_dotenv(dotenv_path=os.path.join(_HERE, "file.env"))

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY is not set in generateInstructions/file.env")

genai.configure(api_key=api_key)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DisasterAlertRequest(BaseModel):
    """Original request model — kept for backwards compatibility."""
    village_name:       str = Field(..., description="Name of the village or region")
    user_location:      str = Field(..., description="Current location of the user (street / landmark)")
    disaster_type:      str = Field(..., description="Type of disaster: flood, fire, earthquake …")
    severity:           str = Field(..., description="Low | Medium | High | Critical")
    demographic_target: str = Field(default="general", description="children | elderly | general")


class DisasterLocationRequest(BaseModel):
    """
    New request — carries GPS coordinates plus live disaster status.
    Pass this to generate_location_aware_guide().
    """
    district_id:        str   = Field(..., description="District code, e.g. 'SOF'")
    district_name:      str   = Field(..., description="Bulgarian district name")
    user_lat:           float = Field(..., description="User latitude")
    user_lng:           float = Field(..., description="User longitude")
    has_disaster:       bool  = Field(..., description="True when a disaster is currently active")
    probability:        float = Field(..., ge=0.0, le=1.0, description="Disaster probability [0–1]")
    disaster_type:      str   = Field(..., description="E.g. 'flood', 'earthquake', 'wildfire'")
    severity:           str   = Field(..., description="Low | Medium | High | Critical")
    demographic_target: str   = Field(default="general")


class SafeDistrictInfo(BaseModel):
    """Recommended evacuation destination with routing metadata."""
    district_id:   str
    district_name: str
    lat:           float
    lng:           float
    probability:   float
    risk_level:    str
    distance_km:   float
    safety_score:  float   # higher = better (safer + closer)


class SurvivalInstructionsResponse(BaseModel):
    """Original AI response — kept for backwards compatibility."""
    title:                   str
    severity_level:          str
    determined_safe_location: str
    immediate_actions:       List[str]
    what_to_avoid:           List[str]
    emergency_message:       str


class LocationAwareSurvivalResponse(BaseModel):
    """Full AI response including geospatial routing to the safest location."""
    title:                       str
    severity_level:              str
    current_district:            str
    recommended_safe_location:   SafeDistrictInfo
    evacuation_direction:        str
    immediate_actions:           List[str]
    what_to_avoid:               List[str]
    emergency_message:           str


# ---------------------------------------------------------------------------
# Geospatial helpers
# ---------------------------------------------------------------------------

def _compute_safety_score(probability: float, distance_km: float) -> float:
    """
    Balances safety and proximity into a single comparable value.
    Higher = better evacuation destination.

    Formula:  (1 - probability) / sqrt(distance_km + 1)
      • Strongly favours low-risk districts.
      • Penalises distance with diminishing returns (sqrt).
      • +1 inside sqrt prevents division-by-zero for same-location edge cases.
    """
    return round((1.0 - probability) / math.sqrt(distance_km + 1), 6)


def _get_cardinal_direction(lat1: float, lng1: float, lat2: float, lng2: float) -> str:
    """Returns 8-point compass direction in Bulgarian from point 1 → point 2."""
    angle = math.degrees(math.atan2(lng2 - lng1, lat2 - lat1)) % 360
    labels = [
        (22.5,  "на север"),
        (67.5,  "на североизток"),
        (112.5, "на изток"),
        (157.5, "на югоизток"),
        (202.5, "на юг"),
        (247.5, "на югозапад"),
        (292.5, "на запад"),
        (337.5, "на северозапад"),
    ]
    for threshold, label in labels:
        if angle < threshold:
            return label
    return "на север"


def find_best_safe_district(
    origin_lat: float,
    origin_lng: float,
    current_district_id: str,
) -> Optional[SafeDistrictInfo]:
    """
    Scans all 28 districts and returns the one with the highest safety_score,
    excluding the user's current (disaster) district.

    safety_score = (1 - probability) / sqrt(distance_km + 1)
    """
    all_districts = get_unique_districts()
    best: Optional[SafeDistrictInfo] = None
    best_score = -1.0

    for d in all_districts:
        if d["district_id"] == current_district_id:
            continue
        dist_km = haversine_distance(origin_lat, origin_lng, d["lat"], d["lng"])
        score   = _compute_safety_score(d["probability"], dist_km)

        if score > best_score:
            best_score = score
            best = SafeDistrictInfo(
                district_id=d["district_id"],
                district_name=d["district_name"],
                lat=d["lat"],
                lng=d["lng"],
                probability=d["probability"],
                risk_level=d["risk_level"],
                distance_km=dist_km,
                safety_score=score,
            )

    return best


# ---------------------------------------------------------------------------
# Core AI functions
# ---------------------------------------------------------------------------

def generate_survival_guide(alert_data: DisasterAlertRequest) -> SurvivalInstructionsResponse:
    """
    Original function — calls Gemini to produce Bulgarian survival instructions.
    Kept for backwards compatibility.
    """
    print(f"[AI] Generating guide for {alert_data.village_name}…")
    model = genai.GenerativeModel("gemini-2.5-flash")

    prompt = f"""
You are an expert emergency response AI for the 'ResQ Village' platform in Bulgaria.
Provide life-saving, practical survival instructions for rural areas.

Context:
- Disaster Type   : {alert_data.disaster_type}
- Village/Region  : {alert_data.village_name}
- User Location   : {alert_data.user_location}
- Severity        : {alert_data.severity}
- Target Audience : {alert_data.demographic_target}

Rules:
1. Write ENTIRELY in Bulgarian.
2. Determine the most logical safe location based on the disaster type.
3. Instruct the user to evacuate from '{alert_data.user_location}' to that safe location.
4. Include rural-specific advice (livestock, well water, power outages).
5. Keep language simple and direct for the target audience.

Return ONLY valid JSON (no Markdown):
{{
    "title": "Спешни мерки при [Disaster] в [Location]",
    "severity_level": "{alert_data.severity}",
    "determined_safe_location": "...",
    "immediate_actions": ["...", "..."],
    "what_to_avoid": ["...", "..."],
    "emergency_message": "..."
}}
"""
    try:
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        data = json.loads(response.text)
        return SurvivalInstructionsResponse(**data)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise RuntimeError(f"Gemini API error: {e}")


def generate_location_aware_guide(
    request: DisasterLocationRequest,
) -> Optional[LocationAwareSurvivalResponse]:
    """
    Main function — combines geospatial routing with AI-generated survival instructions.

    Flow:
      1. If has_disaster is False  →  returns None (area is safe).
      2. If has_disaster is True:
         a. Calls find_best_safe_district() to locate the optimal evacuation zone.
         b. Builds a rich prompt including exact GPS data, distances, and direction.
         c. Calls Gemini to produce Bulgarian evacuation instructions pointing to
            the best safe district.

    Args:
        request: DisasterLocationRequest with user GPS, district metadata,
                 disaster status, and probability.

    Returns:
        LocationAwareSurvivalResponse with AI instructions + routing data,
        or None if no disaster is active.
    """
    if not request.has_disaster:
        return None  # Area is safe — no action needed

    # ── Step 1: Find safest + closest destination ──────────────────────────
    safe_dest = find_best_safe_district(
        origin_lat=request.user_lat,
        origin_lng=request.user_lng,
        current_district_id=request.district_id,
    )
    if not safe_dest:
        raise RuntimeError("Could not determine a safe evacuation destination.")

    direction = _get_cardinal_direction(
        request.user_lat, request.user_lng,
        safe_dest.lat, safe_dest.lng,
    )
    evacuation_str = (
        f"Насочете се {direction} към {safe_dest.district_name} "
        f"({safe_dest.distance_km:.0f} км)"
    )

    print(
        f"[AI] {request.district_name} → {safe_dest.district_name} | "
        f"{safe_dest.distance_km:.0f} km {direction} | "
        f"safety_score={safe_dest.safety_score:.4f}"
    )

    # ── Step 2: Call Gemini with full geospatial context ───────────────────
    model = genai.GenerativeModel("gemini-2.5-flash")

    prompt = f"""
You are an expert emergency response AI for the 'ResQ Village' platform in Bulgaria.
Generate clear, life-saving evacuation instructions for people in Bulgarian rural areas.

=== CURRENT SITUATION ===
Disaster Type      : {request.disaster_type}
Affected District  : {request.district_name} (ID: {request.district_id})
Severity           : {request.severity}
Disaster Probability: {request.probability:.0%}
User GPS           : ({request.user_lat:.4f}, {request.user_lng:.4f})
Target Audience    : {request.demographic_target}

=== RECOMMENDED EVACUATION DESTINATION ===
District           : {safe_dest.district_name} (ID: {safe_dest.district_id})
Direction & Distance: {safe_dest.distance_km:.0f} km {direction}
Safety Level       : {safe_dest.risk_level} (probability: {safe_dest.probability:.0%})
Destination GPS    : ({safe_dest.lat}, {safe_dest.lng})

=== RULES ===
1. ALL output MUST be in Bulgarian.
2. Give disaster-specific actions (flood→high ground; earthquake→open spaces; wildfire→against wind).
3. Explicitly tell the user to evacuate to {safe_dest.district_name}, {safe_dest.distance_km:.0f} км {direction}.
4. Include rural advice: livestock, well water, power outages.
5. Simple language tailored for: {request.demographic_target}.
6. 5–7 immediate actions ordered by priority.

Return ONLY valid JSON (no Markdown):
{{
    "title": "Спешни мерки при {request.disaster_type} в {request.district_name}",
    "severity_level": "{request.severity}",
    "current_district": "{request.district_name}",
    "evacuation_direction": "{evacuation_str}",
    "immediate_actions": ["Действие 1", "Действие 2"],
    "what_to_avoid": ["Избягвайте 1", "Избягвайте 2"],
    "emergency_message": "Кратко успокояващо послание."
}}
"""

    try:
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        ai = json.loads(response.text)

        return LocationAwareSurvivalResponse(
            title=ai["title"],
            severity_level=ai["severity_level"],
            current_district=ai["current_district"],
            recommended_safe_location=safe_dest,
            evacuation_direction=ai.get("evacuation_direction", evacuation_str),
            immediate_actions=ai["immediate_actions"],
            what_to_avoid=ai["what_to_avoid"],
            emergency_message=ai["emergency_message"],
        )

    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise RuntimeError(f"Gemini API error: {e}")


# ---------------------------------------------------------------------------
# Quick smoke-test (run this file directly)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    test = DisasterLocationRequest(
        district_id="SOF",
        district_name="София-град",
        user_lat=42.69,
        user_lng=23.32,
        has_disaster=True,
        probability=0.72,
        disaster_type="earthquake",
        severity="High",
        demographic_target="general",
    )
    try:
        result = generate_location_aware_guide(test)
        if result:
            print(json.dumps(result.model_dump(), indent=4, ensure_ascii=False))
    except Exception as err:
        print(f"Test failed: {err}")