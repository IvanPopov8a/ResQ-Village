/* =======================================================
   map.js — ResQ Village | Карта на риска
   Секции:
     1. Map init
     2. Helpers (color / emoji / label)
     3. Report system — anti-spam guards
     4. Report system — UI flow
     5. Content validator
     6. Toast helper
     7. Marker rendering & popup builder
     8. Verification logic
   ======================================================= */

// ── 1. Map init ─────────────────────────────────────────
const southWest = L.latLng(41.2, 22.3);
const northEast = L.latLng(44.3, 28.7);
const bounds    = L.latLngBounds(southWest, northEast);

const map = L.map('map', {
  maxBounds: bounds,
  maxBoundsViscosity: 1.0
}).fitBounds(bounds);

// Забрана за zoom out извън България
map.setMinZoom(map.getZoom());

// Тъмна тема
L.tileLayer('https://{s}.basemaps.cartocdn.com/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors, © CARTO'
}).addTo(map);


// ── 2. Helpers ──────────────────────────────────────────
function getColor(risk) {
  if (risk === 'low')    return '#4ade80';
  if (risk === 'medium') return '#fbbf24';
  return '#ef4444';
}

function getEmoji(type) {
  const icons = { fire:'🔥', flood:'🌊', earthquake:'🌍', storm:'⛈️', landslide:'🏔️', other:'⚠️' };
  return icons[type] || '⚠️';
}

function getLabel(type) {
  const labels = { fire:'Пожар', flood:'Наводнение', earthquake:'Земетресение', storm:'Буря', landslide:'Свлачище', other:'Друго' };
  return labels[type] || type;
}


// ── 3. Report system — anti-spam guards ─────────────────
let reportMode  = false;
let reportLatLng = null;
let tempMarker  = null;
let reports     = JSON.parse(localStorage.getItem('resq_reports') || '[]');

const COOLDOWN_MS  = 15*60*1000; // 15 минути
const BLOCK_RADIUS = 0.018;           // ~2 км в градуси

// Зарежда съществуващите сигнали при стартиране
reports.forEach((r, i) => addMarker(r, i));

function canReport(username) {
  const key      = 'resq_last_report_' + username;
  const last     = parseInt(localStorage.getItem(key) || '0', 10);
  const now      = Date.now();
  if (now - last < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - last)) / 60000);
    showToast(`Изчакай още ${remaining} мин. преди следващ сигнал.`, 'warn');
    return false;
  }
  return true;
}

function stampReport(username) {
  localStorage.setItem('resq_last_report_' + username, Date.now().toString());
}

function isTooClose(lat, lng) {
  return reports.some(d => {
    const dist = Math.sqrt(Math.pow(d.lat - lat, 2) + Math.pow(d.lng - lng, 2));
    return dist < BLOCK_RADIUS;
  });
}


// ── 4. Report system — UI flow ──────────────────────────
function startReport() {
  if (!localStorage.getItem('resq_session')) {
    openAuth('login');
    return;
  }
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

  // Guard 1: Rate limit
  if (!canReport(user)) { cancelReport(); return; }

  // Guard 2: Location lock
  if (isTooClose(e.latlng.lat, e.latlng.lng)) {
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

// Guard 3: Confirmation step (with content filter)
function askConfirmReport() {
  if (!reportLatLng) return;

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
  document.getElementById('confirmModal').style.display = 'none';
  if (!reportLatLng) return;

  const type = document.getElementById('reportType').value;
  const risk = document.getElementById('reportRisk').value;
  const desc = document.getElementById('reportDesc').value.trim();
  const user = localStorage.getItem('resq_session') || 'Анонимен';

  const report = {
    lat: reportLatLng.lat,
    lng: reportLatLng.lng,
    type, risk, desc, user,
    verified: false,
    confirmations: [],
    time: new Date().toLocaleString('bg-BG')
  };

  reports.push(report);
  localStorage.setItem('resq_reports', JSON.stringify(reports));
  stampReport(user);

  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  addMarker(report, reports.length - 1);

  document.getElementById('reportType').value = 'fire';
  document.getElementById('reportRisk').value = 'low';
  document.getElementById('reportDesc').value = '';
  clearDescError();
  reportMode   = false;
  reportLatLng = null;
  document.getElementById('reportBtn').style.display = 'flex';
  document.getElementById('map').style.cursor = '';
  showToast('Сигналът е изпратен успешно!', 'ok');
}


// ── 5. Content validator ─────────────────────────────────
function validateDescription(text) {
  if (!text) return null; // Описанието е по избор

  if (text.length < 5)
    return 'Описанието е прекалено късо - моля, добави повече детайли.';

  if (text.length > 300)
    return 'Описанието е прекалено дълго (макс. 300 знака).';

  if (/(.)\1{5,}/.test(text))
    return 'Описанието изглежда като спам. Моля, пиши смислено описание.';

  if (/^[^a-zA-Z\u0400-\u04ff]+$/.test(text))
    return 'Описанието трябва да съдържа текст, не само цифри или символи.';

  const letters = text.replace(/[^a-zA-Z\u0400-\u04ff]/g, '');
  if (letters.length > 4) {
    const upperCount = letters.replace(/[^A-Z\u0410-\u042f]/g, '').length;
    if (upperCount / letters.length > 0.7)
      return 'Моля, не пиши цялото с ГЛАВНИ БУКВИ.';
  }

  const BLOCKLIST = [
    'майна','пезда','ебат','курва','боклук','гадно','мамка','пика',
    'боклганак','педераст','шибан','курвачка','ебавам','ядеса','дупе','глупак',
    'кретен','отивъд','проститутка','смашкар','магаре','цицела','скатаеш',
    'fuck','shit','bitch','cunt','dick','pussy','asshole',
    'bastard','idiot','moron','retard','fag','slut','whore','prick','cock',
    'test','asdf','qwerty','zxcv','abcd'
  ];

  const lower = text.toLowerCase();
  for (const word of BLOCKLIST) {
    const re = new RegExp('(^|[^a-z\u0430-\u044f])' + word + '([^a-z\u0430-\u044f]|$)', 'i');
    if (re.test(lower))
      return 'Описанието съдържа неподходящо съдържание. Моля, опишете бедствието адекватно.';
  }

  return null;
}

function showDescError(msg) {
  const el = document.getElementById('descError');
  el.textContent = msg;
  el.style.display = 'block';
  const ta = document.getElementById('reportDesc');
  ta.style.borderColor = '#f87171';
  ta.style.boxShadow   = '0 0 0 3px rgba(248,113,113,0.2)';
  ta.focus();
}

function clearDescError() {
  const el = document.getElementById('descError');
  if (el) el.style.display = 'none';
  const ta = document.getElementById('reportDesc');
  if (ta) { ta.style.borderColor = ''; ta.style.boxShadow = ''; }
}


// ── 6. Toast helper ──────────────────────────────────────
function showToast(msg, type) {
  let t = document.getElementById('resqToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'resqToast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className   = 'resq-toast ' + (type === 'ok' ? 'toast-ok' : 'toast-warn');
  t.style.opacity = '1';
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => { t.style.opacity = '0'; }, 3500);
}


// ── 7. Marker rendering & popup builder ──────────────────
function addMarker(r, index) {
  const color  = getColor(r.risk);
  const marker = L.circleMarker([r.lat, r.lng], {
    radius: 10,
    color, fillColor: color,
    fillOpacity: 0.8,
    weight: 2,
    className: r.risk === 'high' ? 'pulse-marker' : ''
  }).addTo(map);

  r._marker = marker; // Съхрани референция за опресняване на popup
  marker.bindPopup(buildPopup(r, index));
}

function buildPopup(r, index) {
  const color        = getColor(r.risk);
  const confirmCount = (r.confirmations || []).length;
  const currentUser  = localStorage.getItem('resq_session');

  /* --- Status badge --- */
  let statusBadge;
  if (r.verified) {
    statusBadge = `<div style="
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.35);
      border-radius:20px;padding:4px 12px;margin:6px 0;
      font-size:0.82rem;font-weight:700;color:#4ade80
    ">Потвърдено от общността</div>`;
  } else {
    const dots = [1,2,3].map(n => {
      const filled = n <= confirmCount;
      const bg     = filled ? '#6366f1' : 'rgba(255,255,255,0.08)';
      const label  = filled ? '✓' : n;
      return `<div style="
        width:28px;height:28px;border-radius:50%;
        background:${bg};display:inline-flex;
        align-items:center;justify-content:center;
        font-size:0.75rem;font-weight:700;
        color:${filled ? 'white' : '#475569'};
        border:1px solid ${filled ? '#6366f1' : 'rgba(255,255,255,0.1)'};
      ">${label}</div>`;
    }).join('');

    statusBadge = `
      <div style="margin:8px 0 4px">
        <div style="font-size:0.78rem;color:#64748b;margin-bottom:6px">
          Потвърждения: <strong style="color:#94a3b8">${confirmCount}/3</strong>
        </div>
        <div style="display:flex;gap:6px;align-items:center">${dots}</div>
      </div>`;
  }

  /* --- Confirm button --- */
  let confirmBtn = '';
  if (currentUser && currentUser !== r.user && !r.verified) {
    const alreadyConfirmed = (r.confirmations || []).includes(currentUser);
    if (alreadyConfirmed) {
      confirmBtn = `<div style="
        margin-top:10px;padding:8px;
        background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);
        border-radius:8px;font-size:0.8rem;color:#818cf8;text-align:center
      ">✔ Вече потвърди този сигнал</div>`;
    } else {
      confirmBtn = `<button
        onclick="event.stopPropagation(); verifyReport(${index})"
        style="
          margin-top:10px;width:100%;padding:9px;
          background:linear-gradient(135deg,#4f46e5,#818cf8);
          border:none;border-radius:9px;color:white;
          font-family:Outfit,sans-serif;font-size:0.85rem;font-weight:700;
          cursor:pointer;
        "
        onmouseover="this.style.filter='brightness(1.15)'"
        onmouseout="this.style.filter='none'"
      >Потвърди сигнала</button>`;
    }
  } else if (!currentUser && !r.verified) {
    confirmBtn = `<div style="
      margin-top:10px;padding:8px;
      background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
      border-radius:8px;font-size:0.8rem;color:#475569;text-align:center
    ">Влезте, за да потвърдите</div>`;
  }

  return `
    <div style="font-family:Outfit,sans-serif;min-width:210px;padding:2px 0">
      <strong style="font-size:1rem">${getEmoji(r.type)} ${getLabel(r.type)}</strong><br>
      <span style="color:${color}">● Риск: ${
        r.risk === 'low' ? 'Нисък' : r.risk === 'medium' ? 'Среден' : 'Висок'
      }</span>
      ${statusBadge}
      ${r.desc ? `<em style="display:block;margin-top:4px;color:#94a3b8">"${r.desc}"</em>` : ''}
      <small style="color:#475569;display:block;margin-top:6px">👤︎ ${r.user} — ${r.time}</small>
      ${confirmBtn}
    </div>
  `;
}


// ── 8. Verification logic ────────────────────────────────
function verifyReport(index) {
  const currentUser = localStorage.getItem('resq_session');
  if (!currentUser) { openAuth('login'); return; }

  const r = reports[index];
  if (!r) return;

  if (r.user === currentUser) {
    showToast('Не можеш да потвърдиш собствен сигнал.', 'warn');
    return;
  }
  if ((r.confirmations || []).includes(currentUser)) return;

  r.confirmations = r.confirmations || [];
  r.confirmations.push(currentUser);

  const count = r.confirmations.length;

  if (count >= 3) {
    r.verified = true;
    if (r._marker) r._marker.setStyle({ color: '#4ade80', fillColor: '#4ade80' });
    showToast('Сигналът е потвърден от общността!', 'ok');
  } else {
    showToast(`Потвърждение добавено - ${count}/3`, 'ok');
  }

  // Запази (без непериализируемото _marker)
  const toSave = reports.map(rep => {
    const { _marker, ...rest } = rep;
    return rest;
  });
  localStorage.setItem('resq_reports', JSON.stringify(toSave));

  // Опресни popup без затваряне/трептене
  if (r._marker && r._marker.getPopup()) {
    r._marker.getPopup().setContent(buildPopup(r, index));
  }
}
