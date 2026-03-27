import os
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv("generateInstructions/file.env")
api_key = os.getenv("GEMINI_API_KEY")
print(f"Key loaded: {bool(api_key)}")

if api_key:
    genai.configure(api_key=api_key)
    try:
        models = genai.list_models()
        for m in models:
            if "generateContent" in m.supported_generation_methods:
                print(m.name)
    except Exception as e:
        print(f"Error: {e}")
