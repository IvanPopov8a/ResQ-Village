/* =======================================================
   map.js — ResQ Village | Карта и сигнали
   Секции:
     1. Map init
     2. Report system (state, guards, UI flow)
     3. Content validator
     4. Toast helper
     5. Marker rendering & popup
     6. DOMContentLoaded bootstrap
     7. Modal backdrop close
   ======================================================= */

// ── 1. Map init ─────────────────────────────────────────
const southWest = L.latLng(41.2, 22.3);
const northEast = L.latLng(44.3, 28.7);
const bounds    = L.latLngBounds(southWest, northEast);

const map = L.map('map', {
  maxBounds: bounds,
  maxBoundsViscosity: 1.0,
  zoomControl: false
}).fitBounds(bounds);

L.control.zoom({ position: 'bottomleft' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© CARTO'
}).addTo(map);

// Labels-only layer rendered on top of GeoJSON regions
map.createPane('labels');
map.getPane('labels').style.zIndex = 450;
map.getPane('labels').style.pointerEvents = 'none';
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  pane: 'labels'
}).addTo(map);


// ── 2. Report system ────────────────────────────────────
let reportMode   = false;
let reportLatLng = null;
let tempMarker   = null;
let reports      = [];

try {
  reports = JSON.parse(localStorage.getItem('resq_reports') || '[]');
} catch(e) { console.error("Error loading reports:", e); reports = []; }

const COOLDOWN_MS  = 15 * 60 * 1000;
const BLOCK_RADIUS = 0.018;

function startReport() {
  if (!localStorage.getItem('resq_session')) { openAuth('login'); return; }
  reportMode = true;
  document.getElementById('reportHint').style.display = 'flex';
  document.getElementById('reportBtn').style.display  = 'none';
  document.getElementById('map').style.cursor = 'crosshair';
}

function cancelReport() {
  reportMode   = false;
  reportLatLng = null;
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  document.getElementById('reportHint').style.display = 'none';
  document.getElementById('reportBtn').style.display  = 'flex';
  document.getElementById('map').style.cursor = '';
}

map.on('click', function(e) {
  if (!reportMode) return;
  const user = localStorage.getItem('resq_session') || 'Анонимен';
  
  // Проверка за cooldown
  const key  = 'resq_last_report_' + user;
  const last = parseInt(localStorage.getItem(key) || '0', 10);
  if (Date.now() - last < COOLDOWN_MS) {
    const rem = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60000);
    showToast(`Изчакай още ${rem} мин. преди нов сигнал.`, 'warn');
    cancelReport();
    return;
  }

  // Проверка за близост
  const tooClose = reports.some(d => {
    return Math.sqrt(Math.pow(d.lat - e.latlng.lat, 2) + Math.pow(d.lng - e.latlng.lng, 2)) < BLOCK_RADIUS;
  });
  if (tooClose) {
    showToast('Вече има сигнал в този район!', 'warn');
    cancelReport();
    return;
  }

  reportLatLng = e.latlng;
  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.circleMarker([e.latlng.lat, e.latlng.lng], {
    radius: 12, color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 0.6, weight: 2
  }).addTo(map);

  document.getElementById('reportModal').style.display = 'flex';
  document.getElementById('reportHint').style.display  = 'none';
});

function closeReport() {
  document.getElementById('reportModal').style.display = 'none';
  cancelReport();
}

function askConfirmReport() {
  if (!reportLatLng) {
    showToast("Моля, първо изберете място на картата!", "warn");
    return;
  }
  const desc  = document.getElementById('reportDesc').value.trim();
  const error = validateDescription(desc);
  if (error) { showDescError(error); return; }
  document.getElementById('reportModal').style.display  = 'none';
  document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirm() {
  document.getElementById('confirmModal').style.display = 'none';
  document.getElementById('reportModal').style.display  = 'flex';
}

function submitReport() {
  if (!reportLatLng) return;
  const type = document.getElementById('reportType').value;
  const risk = document.getElementById('reportRisk').value;
  const desc = document.getElementById('reportDesc').value.trim();
  const user = localStorage.getItem('resq_session') || 'Анонимен';

  const newReport = {
    lat: reportLatLng.lat, lng: reportLatLng.lng,
    type, risk, desc, user,
    verified: false, confirmations: [],
    time: new Date().toLocaleString('bg-BG')
  };

  reports.push(newReport);
  localStorage.setItem('resq_reports', JSON.stringify(reports));
  localStorage.setItem('resq_last_report_' + user, Date.now().toString());

  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  addMarker(newReport, reports.length - 1);

  document.getElementById('reportDesc').value = '';
  document.getElementById('confirmModal').style.display = 'none';
  cancelReport();
  showToast('Сигналът е изпратен успешно!', 'ok');
}


// ── 3. Content validator ─────────────────────────────────
function validateDescription(text) {
  if (!text) return null;
  if (text.length < 5) return 'Описанието е твърде късо.';
  if (text.length > 300) return 'Описанието е твърде дълго.';
  const BLOCKLIST = ['test', 'asdf', 'fuck', 'shit', 'кур', 'еба'];
  const lower = text.toLowerCase();
  for (const word of BLOCKLIST) {
    if (lower.includes(word)) return 'Неподходящо съдържание.';
  }
  return null;
}

function showDescError(msg) {
  const el = document.getElementById('descError');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('reportDesc').style.borderColor = '#f87171';
}

function clearDescError() {
  document.getElementById('descError').style.display = 'none';
  document.getElementById('reportDesc').style.borderColor = '';
}


// ── 4. Toast helper ──────────────────────────────────────
function showToast(msg, type) {
  let t = document.getElementById('resqToast');
  if (!t) { t = document.createElement('div'); t.id = 'resqToast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className   = 'resq-toast ' + (type === 'ok' ? 'toast-ok' : 'toast-warn');
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 3500);
}


// ── 5. Marker rendering & popup ──────────────────────────
function addMarker(r, index) {
  const color = (r.risk === 'low') ? '#4ade80' : (r.risk === 'medium' ? '#fbbf24' : '#ef4444');
  const marker = L.circleMarker([r.lat, r.lng], {
    radius: 10, color, fillColor: color, fillOpacity: 0.8, weight: 2,
    className: r.risk === 'high' ? 'pulse-marker' : ''
  }).addTo(map);
  
  const emoji = { fire:'🔥', flood:'🌊', earthquake:'🌍', storm:'⛈️', landslide:'🏔️', other:'⚠️' }[r.type] || '⚠️';
  const label = { fire:'Пожар', flood:'Наводнение', earthquake:'Земетресение', storm:'Буря', landslide:'Свлачище', other:'Друго' }[r.type] || r.type;
  
  const currentUser = localStorage.getItem('resq_session');
  // Check if current user has already confirmed
  const hasConfirmed = r.confirmations && currentUser && r.confirmations.includes(currentUser);
  const isAuthor = r.user === currentUser;

  let verifyBtn = '';
  if (r.verified) {
    verifyBtn = '<div class="verified-badge-popup"> ✅ Потвърден</div>';
  } else if (currentUser && !isAuthor && !hasConfirmed) {
    verifyBtn = `
      <div style="margin-top:10px; text-align:center;">
        <button class="btn-verify-report" onclick="verifyReport(${index})">Потвърди сигнала</button>
        <div style="font-size:10px; color:#94a3b8; margin-top:4px;">Потвърждавания: ${r.confirmations ? r.confirmations.length : 0}/3</div>
      </div>
    `;
  } else if (isAuthor) {
    verifyBtn = '<div style="font-size:10px; color:#94a3b8; margin-top:10px;">Ваш сигнал</div>';
  } else if (hasConfirmed) {
    verifyBtn = '<div style="font-size:10px; color:#4ade80; margin-top:10px;">Вие потвърдихте това</div>';
  } else if (!currentUser) {
    verifyBtn = '<div style="font-size:10px; color:#94a3b8; margin-top:10px;"><a href="#" onclick="openAuth(\'login\'); return false;">Влезте</a>, за да потвърдите</div>';
  }

  marker.bindPopup(`
    <div style="font-family:Outfit,sans-serif;min-width:180px">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <strong>${emoji} ${label}</strong>
      </div>
      <span style="color:${color}">● Риск: ${r.risk}</span><br>
      ${r.desc ? `<em>"${r.desc}"</em><br>` : ''}
      <small>👤︎ ${r.user} — ${r.time}</small>
      ${verifyBtn}
    </div>
  `);
  
  return marker;
}

function verifyReport(index) {
  const user = localStorage.getItem('resq_session');
  if (!user) { openAuth('login'); return; }
  
  let reports = JSON.parse(localStorage.getItem('resq_reports') || '[]');
  const r = reports[index];
  
  if (!r.confirmations) r.confirmations = [];
  if (r.confirmations.includes(user)) return; // Already confirmed
  if (r.user === user) return; // Cannot confirm own report
  
  r.confirmations.push(user);
  
  // Rule: 3 confirmations to become verified
  if (r.confirmations.length >= 3) {
    r.verified = true;
  }
  
  localStorage.setItem('resq_reports', JSON.stringify(reports));
  showToast('Благодарим за потвърждението!', 'ok');
  
  // Refresh the page or markers to show updated status
  setTimeout(() => location.reload(), 800);
}


// ── 8. Map Sidebar & Consolidated Logic ──────────────────
let sidebarOpen = false;
let hospitalMarkers = [];

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sidebar = document.getElementById('mapSidebar');
  sidebar.classList.toggle('open', sidebarOpen);
  document.getElementById('sidebarToggle').textContent = sidebarOpen ? '✕' : '☰';
}

function switchSidebarTab(tab) {
  const isAlerts = tab === 'alerts';
  document.getElementById('tabAlerts').classList.toggle('active', isAlerts);
  document.getElementById('tabMedical').classList.toggle('active', !isAlerts);
  document.getElementById('sectionAlerts').classList.toggle('active', isAlerts);
  document.getElementById('sectionMedical').classList.toggle('active', !isAlerts);
  
  if (isAlerts) renderSidebarAlerts();
}

// Demo Alerts (from alerts.html)
const demoAlerts = [
  { type: 'storm', risk: 'low', title: 'Силен вятър', desc: 'Скорост 45-55 км/ч в планинските райони.', time: 'Преди 12 мин.', lat: 42.1354, lng: 24.7453 },
  { type: 'flood', risk: 'medium', title: 'Интензивни валежи', desc: 'Очакват се над 40 л/м² в районите на Варна и Бургас.', time: 'Преди 38 мин.', lat: 43.2141, lng: 27.9147 },
  { type: 'earthquake', risk: 'high', title: 'Земетресение ML 3.2', desc: 'Регистрирано в района на Попово. Афтершокове са възможни.', time: 'Преди 1 ч. 15 мин.', lat: 43.3444, lng: 26.2236 },
  { type: 'fire', risk: 'medium', title: 'Висок риск от пожар', desc: 'В районите на Родопите и Странджа поради суша.', time: 'Днес, 06:30', lat: 41.6667, lng: 25.3667 }
];

function renderSidebarAlerts() {
  const list = document.getElementById('alertsList');
  const icons = { fire:'🔥', flood:'🌊', earthquake:'🌍', storm:'🌬️', other:'⚠️' };
  
  // Combine demo alerts with user reports
  const userReports = reports.map(r => ({
    title: { fire:'Пожар', flood:'Наводнение', earthquake:'Земетресение', storm:'Буря', landslide:'Свлачище', other:'Друго' }[r.type] || 'Сигнал',
    desc: r.desc || 'Няма описание',
    risk: r.risk,
    type: r.type,
    time: r.time,
    lat: r.lat,
    lng: r.lng,
    isUserReport: true
  }));

  const allAlerts = [...demoAlerts, ...userReports];

  list.innerHTML = allAlerts.map(a => `
    <div class="sidebar-alert-card ${a.risk}" onclick="zoomToAlert(${a.lat}, ${a.lng})" style="cursor:pointer;">
      <h4>${icons[a.type] || '⚠️'} ${a.title} ${a.isUserReport ? '<span style="font-size:10px; opacity:0.6;">(Потребителски)</span>' : ''}</h4>
      <p>${a.desc}</p>
      <span class="sidebar-alert-time">${a.time}</span>
    </div>
  `).join('');
}

function zoomToAlert(lat, lng) {
  if (!lat || !lng) return;
  map.setView([lat, lng], 15);
  showToast('Локализиране на сигнала...', 'ok');
}

// Medical & Zoom Logic
async function searchHospitalsInCity() {
  const query = document.getElementById('medicalSearch').value.trim();
  if (!query) return;

  const list = document.getElementById('hospitalList');
  list.innerHTML = '<div class="list-loading">Търсене на локация...</div>';

  try {
    // 1. Geocode city (Nominatim)
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)},Bulgaria`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (geoData.length === 0) {
      list.innerHTML = '<div class="list-empty">Градът не беше намерен. Опитайте пак.</div>';
      return;
    }

    const { lat, lon, display_name } = geoData[0];
    
    // 2. Zoom map
    map.setView([lat, lon], 13);
    showToast(`Навигация към ${query}...`, 'ok');

    // 3. Fetch hospitals from Overpass API (via medical-api.js)
    list.innerHTML = '<div class="list-loading">Извличане на болници...</div>';
    const allHospitals = await fetchRealHospitals();
    
    // Filter hospitals near the city (or just matching city name for simple demo)
    const filtered = allHospitals.filter(h => 
      h.city.toLowerCase().includes(query.toLowerCase()) ||
      h.name.toLowerCase().includes(query.toLowerCase())
    );

    if (filtered.length === 0) {
      list.innerHTML = '<div class="list-empty">Няма намерени болници в този район.</div>';
    } else {
      renderHospitalList(filtered);
      addHospitalMarkers(filtered);
    }

  } catch (err) {
    console.error("Search error:", err);
    list.innerHTML = '<div class="list-empty">Грешка при търсене.</div>';
  }
}

function renderHospitalList(hospitals) {
  const list = document.getElementById('hospitalList');
  list.innerHTML = hospitals.map(h => `
    <div class="sidebar-hospital-card">
      <h4>${h.name}</h4>
      <span class="sidebar-hospital-city">${h.city}</span>
      <div class="sidebar-hospital-info"><span>📞</span> ${h.phone}</div>
      <div class="sidebar-hospital-info"><span>🏥</span> ${h.type}</div>
      <div class="sidebar-hospital-actions">
        <button class="btn-sidebar-route" onclick="zoomToHospital(${h.lat}, ${h.lon})">Виж на картата</button>
        <button class="btn-sidebar-route" style="background:#10b981" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}', '_blank')">Маршрут</button>
      </div>
    </div>
  `).join('');
}

function addHospitalMarkers(hospitals) {
  // Clear old hospital markers
  hospitalMarkers.forEach(m => map.removeLayer(m));
  hospitalMarkers = [];

  hospitals.forEach(h => {
    const marker = L.marker([h.lat, h.lon], {
      icon: L.divIcon({
        className: 'hospital-marker-div',
        html: '<div style="background:#3b82f6;color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.3)">🏥</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    }).addTo(map);
    
    marker.bindPopup(`<strong>${h.name}</strong><br>${h.type}<br>📞 ${h.phone}`);
    hospitalMarkers.push(marker);
  });
}

function zoomToHospital(lat, lon) {
  map.setView([lat, lon], 16);
  // Find which marker belongs to this lat/lon to open its popup
  hospitalMarkers.forEach(m => {
    if (m.getLatLng().lat === lat && m.getLatLng().lng === lon) {
      m.openPopup();
    }
  });
}

// ── 9. DOMContentLoaded bootstrap ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  reports.forEach((r, i) => addMarker(r, i));
  const s = localStorage.getItem('resq_session');
  if (s) {
    document.getElementById('authButtons').style.display  = 'none';
    document.getElementById('userGreeting').style.display = 'flex';
    document.getElementById('userName').textContent        = s;
    document.getElementById('userAvatar').textContent      = s.charAt(0).toUpperCase();
  }
  
  // Initial render of alerts
  renderSidebarAlerts();
});


// ── 10. Modal backdrop close ─────────────────────────────
window.onclick = function(e) {
  if (e.target.id === 'authModal') closeAuth();
  if (e.target.id === 'reportModal') closeReport();
  if (e.target.id === 'confirmModal') closeConfirm();
};
