import os
from dotenv import load_dotenv
from google import genai

load_dotenv("generateInstructions/.env")
api_key = os.getenv("GEMINI_API_KEY")
print(f"Key loaded: {bool(api_key)}")

if api_key:
    client = genai.Client(api_key=api_key)
    try:
        models = client.models.list()
        for m in models:
            if hasattr(m, "supported_actions") and "generateContent" in (m.supported_actions or []):
                print(m.name)
            elif hasattr(m, "name"):
                print(m.name)
    except Exception as e:
        print(f"Error: {e}")
