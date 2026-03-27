/**
 * medical-api.js - Скрипт за извличане на реални данни за болници в България
 * чрез Overpass API (OpenStreetMap).
 */

const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_QUERY = `
[out:json][timeout:25];
area["name:en"="Bulgaria"]->.searchArea;
(
  node["amenity"="hospital"](area.searchArea);
  way["amenity"="hospital"](area.searchArea);
  relation["amenity"="hospital"](area.searchArea);
);
out center;`;

async function fetchRealHospitals() {
    // Проверка за кеширани данни (валидни 24 часа)
    const cached = localStorage.getItem('resq_hospitals_cache');
    const cacheTime = localStorage.getItem('resq_hospitals_time');
    
    if (cached && cacheTime && (Date.now() - cacheTime < 24 * 60 * 60 * 1000)) {
        console.log("Using cached hospital data");
        return JSON.parse(cached);
    }

    try {
        const response = await fetch(OVERPASS_API_URL, {
            method: "POST",
            body: OVERPASS_QUERY
        });

        if (!response.ok) throw new Error("Failed to fetch data from Overpass API");

        const data = await response.json();
        const hospitals = data.elements.map(el => {
            const tags = el.tags || {};
            return {
                id: el.id,
                name: tags.name || tags["name:en"] || "Болница (неизвестно име)",
                city: tags["addr:city"] || tags["is_in:city"] || "България",
                phone: tags.phone || tags["contact:phone"] || "няма данни",
                website: tags.website || tags["contact:website"] || null,
                lat: el.lat || (el.center ? el.center.lat : 0),
                lon: el.lon || (el.center ? el.center.lon : 0),
                type: tags.healthcare === 'hospital' ? 'Болница' : (tags.amenity === 'hospital' ? 'Болница' : 'Медицински център'),
                speciality: tags["healthcare:speciality"] || "Общопрофилна болница"
            };
        });

        // Сортиране по име
        hospitals.sort((a, b) => a.name.localeCompare(b.name, 'bg'));

        localStorage.setItem('resq_hospitals_cache', JSON.stringify(hospitals));
        localStorage.setItem('resq_hospitals_time', Date.now());

        return hospitals;
    } catch (error) {
        console.error("Error fetching hospitals:", error);
        return [];
    }
}
