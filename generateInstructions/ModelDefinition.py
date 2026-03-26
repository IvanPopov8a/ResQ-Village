import os
import json
import google.generativeai as genai
from pydantic import BaseModel, Field
from typing import List
from dotenv import load_dotenv

# --- Configuration ---
load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY environment variable is not set.")

genai.configure(api_key=api_key)


# --- 1. Pydantic Models (Data Validation) ---

class DisasterAlertRequest(BaseModel):
    village_name: str = Field(..., description="Name of the village or region")
    user_location: str = Field(..., description="The current exact location of the user (e.g., 'улица Христо Ботев 5')")
    disaster_type: str = Field(..., description="Type of disaster: e.g., flood, fire, earthquake")
    severity: str = Field(..., description="Severity level: Low, Medium, Critical")
    demographic_target: str = Field(default="general", description="Target audience: children, elderly, general")
    

class SurvivalInstructionsResponse(BaseModel):
    title: str = Field(..., description="Clear title of the instruction")
    severity_level: str = Field(..., description="Confirmation of the severity level")
    determined_safe_location: str = Field(..., description="The specific safe location the AI determined they should evacuate to")
    immediate_actions: List[str] = Field(..., description="Step-by-step guide on what to do IMMEDIATELY")
    what_to_avoid: List[str] = Field(..., description="What strictly NOT to do")
    emergency_message: str = Field(..., description="Short calming/motivating message")


# --- 2. The Core AI Integration Function ---

def generate_survival_guide(alert_data: DisasterAlertRequest) -> SurvivalInstructionsResponse:
    """
    Calls the Gemini API to generate real survival instructions based on the input.
    The AI is tasked with determining the safest location dynamically.
    Enforces a strict JSON output to match our Pydantic schema.
    """
    
    print(f"Generating live AI response for {alert_data.village_name}...")

    model = genai.GenerativeModel('gemini-1.5-flash')
    
    # We instruct the AI to ANALYZE the disaster and DETERMINE a logical safe zone
    prompt = f"""
    You are an expert emergency response AI for the 'ResQ Village' platform in Bulgaria.
    Your objective is to provide life-saving, highly practical survival instructions for rural areas.
    
    Context:
    - Disaster Type: {alert_data.disaster_type}
    - Village/Region: {alert_data.village_name}
    - User's Current Location: {alert_data.user_location}
    - Severity: {alert_data.severity}
    - Target Audience: {alert_data.demographic_target}
    
    Rules:
    1. The generated content MUST be written entirely in Bulgarian.
    2. Based on the disaster type (e.g., floods require high ground, earthquakes require open spaces), DETERMINE the most logical type of safe location in a rural setting.
    3. Instruct the user to immediately evacuate from '{alert_data.user_location}' to the safe location you determined.
    4. The language must be simple, direct, and specifically tailored for the target audience.
    5. Include rural-specific advice (e.g., what to do with livestock, well water, power outages).
    
    Format Requirement:
    Return ONLY a valid JSON object exactly matching this structure. Do not use Markdown (like ```json).
    {{
        "title": "Спешни мерки при [Disaster] в [Location]",
        "severity_level": "{alert_data.severity}",
        "determined_safe_location": "The generic or specific safe location you determined",
        "immediate_actions": ["Action 1", "Action 2", "Action 3"],
        "what_to_avoid": ["Avoid 1", "Avoid 2"],
        "emergency_message": "Short reassuring message."
    }}
    """
    
    try:
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.2 
            )
        )
        
        ai_response_dict = json.loads(response.text)
        validated_data = SurvivalInstructionsResponse(**ai_response_dict)
        return validated_data
        
    except json.JSONDecodeError as e:
        print(f"Error parsing AI response to JSON: {e}")
        raise RuntimeError("The AI generated an invalid JSON format.")
    except Exception as e:
        print(f"API communication error: {e}")
        raise RuntimeError(f"Failed to generate survival guide: {str(e)}")

# --- 3. Quick Test (Run this file directly to test) ---
if __name__ == "__main__":
    test_data = DisasterAlertRequest(
        village_name="Бов",
        user_location="ул. Иван Вазов 12",
        disaster_type="наводнение",
        severity="Critical",
        demographic_target="elderly"
    )
    
    try:
        result = generate_survival_guide(test_data)
        print(json.dumps(result.model_dump(), indent=4, ensure_ascii=False))
    except Exception as err:
        print(f"Test failed: {err}")