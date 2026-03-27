import requests
import pandas as pd
import numpy as np
import time
import urllib3
import warnings
from datetime import datetime, timedelta
from io import StringIO
import ssl
import os

# --- SSL FIX FOR PYTHON 3.14 ---
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore")

# =============================================================================
# CONFIGURATION - TUNED FOR QUICK HISTORICAL TESTING
# =============================================================================
NASA_FIRMS_API_KEY = os.getenv("NASA_FIRMS_API_KEY")
BG_BBOX      = "22.4,41.3,28.6,44.2" 
YEARS        = list(range(2014, 2025))

# SETTINGS FOR 2,500 ROW TEST DATASET
TARGET_FIRES = 100    # 4%
TARGET_SAFE  = 2400   # 96%
OUTPUT_CSV   = "bulgaria_real_test_history.csv"

# =============================================================================
# DATA FETCHING LOGIC
# =============================================================================

def fetch_firms_fires(year):
    print(f"  🛰️  Checking NASA Archive for {year}...")
    # Use Standard Processing for historical reliability
    sensor = "VIIRS_SNPP_SP" if year < 2024 else "VIIRS_SNPP_NRT"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{NASA_FIRMS_API_KEY}/{sensor}/{BG_BBOX}/5/{year}-08-10"
    
    try:
        r = requests.get(url, timeout=30, verify=False)
        if r.status_code == 200 and len(r.text) > 150:
            df = pd.read_csv(StringIO(r.text))
            df.columns = [c.lower().strip() for c in df.columns]
            df['acq_date'] = pd.to_datetime(df['acq_date'])
            return df[['latitude', 'longitude', 'acq_date']]
    except: pass
    return pd.DataFrame()

def fetch_weather_for_location(lat, lon, date_str):
    url = "https://archive-api.open-meteo.com/v1/archive"
    target = datetime.strptime(date_str, "%Y-%m-%d")
    start = (target - timedelta(days=60)).strftime("%Y-%m-%d")
    
    params = {
        "latitude": round(lat, 3), "longitude": round(lon, 3),
        "start_date": start, "end_date": date_str,
        "daily": ["temperature_2m_max", "relative_humidity_2m_min", "wind_speed_10m_max", "precipitation_sum"],
        "timezone": "GMT"
    }
    try:
        r = requests.get(url, params=params, timeout=15, verify=False)
        if r.status_code == 200:
            return pd.DataFrame(r.json()['daily'])
    except: pass
    return None

def compute_derived_features(weather_df):
    # This remains the same to keep your model's required inputs
    dsr = 0
    kbdi = 50.0
    for _, row in weather_df.iterrows():
        rain = float(row.get('precipitation_sum') or 0)
        temp = float(row.get('temperature_2m_max') or 25)
        dsr = 0 if rain > 1.0 else dsr + 1
        net_rain = max(0.0, rain - 5.0)
        daily_drying = ((800 - kbdi) * (0.968 * np.exp(0.0486 * temp) - 8.3)) / 1000
        kbdi = float(np.clip(kbdi + daily_drying - net_rain * 3.94, 0, 800))
    
    last = weather_df.iloc[-1]
    hum = float(last.get('relative_humidity_2m_min') or 40)
    fuel_curing = float(np.clip(0.3 + (kbdi/800)*0.4 + max(0,(50-hum)/50)*0.3, 0.3, 1.0))
    
    return {
        'temp': last.get('temperature_2m_max'), 'hum': hum,
        'wind': last.get('wind_speed_10m_max'), 'rain': last.get('precipitation_sum'),
        'days_since_rain': int(dsr), 'drought_index': round(kbdi, 2),
        'fuel_curing_index': round(fuel_curing, 3)
    }

# =============================================================================
# EXECUTION
# =============================================================================

def run_historical_build():
    fire_records = []
    fire_keys = set()

    print(f"🚀 BUILDING REAL HISTORY DATASET: {TARGET_FIRES} Fires / {TARGET_SAFE} Safe")
    
    # 1. Real Fires
    for year in YEARS:
        if len(fire_records) >= TARGET_FIRES: break
        df = fetch_firms_fires(year)
        if df.empty: continue

        for _, row in df.iterrows():
            if len(fire_records) >= TARGET_FIRES: break
            w = fetch_weather_for_location(row['latitude'], row['longitude'], row['acq_date'].strftime("%Y-%m-%d"))
            time.sleep(0.2)
            if w is not None:
                feat = compute_derived_features(w)
                feat['label'] = 1
                fire_records.append(feat)
                fire_keys.add((round(row['latitude'], 1), round(row['longitude'], 1), row['acq_date'].strftime("%Y-%m-%d")))
        print(f"   Progress: {len(fire_records)} fires collected...")

    # 2. Real Safe Days
    print(f"\n🌿 Collecting {TARGET_SAFE} Real Safe Days...")
    safe_records = []
    while len(safe_records) < TARGET_SAFE:
        y, m, d = int(np.random.choice(YEARS)), int(np.random.choice([6,7,8,9])), int(np.random.randint(1,28))
        ds = f"{y}-{m:02d}-{d:02d}"
        lt, ln = round(np.random.uniform(41.4, 44.1), 2), round(np.random.uniform(22.5, 28.5), 2)
        
        if (round(lt, 1), round(ln, 1), ds) in fire_keys: continue
        
        w = fetch_weather_for_location(lt, ln, ds)
        time.sleep(0.2)
        if w is not None:
            feat = compute_derived_features(w)
            feat['label'] = 0
            safe_records.append(feat)
            if len(safe_records) % 100 == 0:
                print(f"   Progress: {len(safe_records)}/{TARGET_SAFE} safe days...")

    # 3. Finalize
    final = pd.concat([pd.DataFrame(fire_records), pd.DataFrame(safe_records)]).sample(frac=1).reset_index(drop=True)
    final.to_csv(OUTPUT_CSV, index=False)
    print(f"\n✅ SUCCESS: {OUTPUT_CSV} created with 100% real historical data.")

if __name__ == "__main__":
    run_historical_build()
    