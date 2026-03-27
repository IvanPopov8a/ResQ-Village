import requests
import os

NODE_SERVICE_URL = os.getenv("NODE_SERVICE_URL", "http://localhost:3000")

def trigger_node_alert(disaster_type, level, village_id, lat, lng):
    """
    Tells the Node.js Alert Engine to process a new disaster event.
    """
    payload = {
        "type": disaster_type,
        "level": level,
        "villageId": village_id,
        "lat": lat,
        "lng": lng
    }
    try:
        # Pings the manual alert route in alerts.js
        response = requests.post(f"{NODE_SERVICE_URL}/api/alerts/manual", json=payload)
        return response.json()
    except Exception as e:
        print(f"Failed to reach Node Alert Service: {e}")
        return None