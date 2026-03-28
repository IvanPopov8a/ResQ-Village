/* =======================================================
   risk-map.js — ResQ Village | Интерактивна карта на риска
   Секции:
     1. Oblast names & threat config
     2. Real-time threat data
     3. Region styling & tooltip
     4. GeoJSON loading
     5. Region update logic
     6. Real-time updates & Poll
     7. Bootstrap
   ======================================================= */

// ── 1. Oblast names & threat config ─────────────────────

const OBLAST_NAMES = {
  BLG: 'Благоевград', DOB: 'Добрич', GAB: 'Габрово', HKV: 'Хасково',
  KRZ: 'Кърджали', KNL: 'Кюстендил', LOV: 'Ловеч', MON: 'Монтана',
  PAZ: 'Пазарджик', PER: 'Перник', PDV: 'Пловдив', PVN: 'Плевен',
  RAZ: 'Разград', RSE: 'Русе', SHU: 'Шумен', SLS: 'Силистра',
  SLV: 'Сливен', SML: 'Смолян', SFO: 'София-област', SOF: 'София-град',
  SZR: 'Стара Загора', TGV: 'Търговище', VRC: 'Враца', VID: 'Видин',
  VTR: 'Велико Търново', JAM: 'Ямбол', BGS: 'Бургас', VAR: 'Варна'
};

const THREAT_TYPES = {
  none:       { label: 'Няма заплаха',  emoji: '', color: '#334155' },
  fire:       { label: 'Пожар',         emoji: '', color: '#ef4444' },
  flood:      { label: 'Наводнение',    emoji: '', color: '#ef4444' },
  earthquake: { label: 'Земетресение',  emoji: '', color: '#fbbf24' },
  storm:      { label: 'Буря',          emoji: '', color: '#fbbf24' },
  landslide:  { label: 'Свлачище',      emoji: '', color: '#fbbf24' },
  drought:    { label: 'Суша',          emoji: '', color: '#fbbf24' },
  heatwave:   { label: 'Гореща вълна',  emoji: '', color: '#ef4444' }
};

const RISK_COLORS = {
  none:   { fill: '#334155', border: '#475569', opacity: 0.25 },
  low:    { fill: '#4ade80', border: '#22c55e', opacity: 0.35 },
  medium: { fill: '#fbbf24', border: '#f59e0b', opacity: 0.4  },
  high:   { fill: '#ef4444', border: '#dc2626', opacity: 0.5  },
  critical: { fill: '#b91c1c', border: '#7f1d1d', opacity: 0.6 } // Added critical mapping
};


// ── 2. Real-time threat data ────────────────────────────
let threatData = {}; // Fetched from backend


// ── 3. Region styling & tooltip ─────────────────────────

let riskGeoLayer = null;
const GEOJSON_URL = 'https://raw.githubusercontent.com/yurukov/Bulgaria-geocoding/master/provinces.geojson';

function getRegionStyle(nuts3) {
  const data = threatData[nuts3] || { level: 'none' };
  const risk = RISK_COLORS[data.level?.toLowerCase()] || RISK_COLORS.none;
  return {
    fillColor:   risk.fill,
    weight:      2,
    opacity:     0.7,
    color:       risk.border,
    fillOpacity: risk.opacity,
    dashArray:   data.level === 'none' ? '4 4' : ''
  };
}

function buildRegionTooltip(nuts3) {
  const name   = OBLAST_NAMES[nuts3] || nuts3;
  const data   = threatData[nuts3] || { level: 'none', threat: 'none' };
  const threat = THREAT_TYPES[data.threat] || THREAT_TYPES.none;
  const risk   = RISK_COLORS[data.level?.toLowerCase()] || RISK_COLORS.none;
  
  const levelLabels = { none: 'Няма', low: 'Нисък', medium: 'Среден', high: 'Висок', critical: 'Критичен' };
  const levelLabel = levelLabels[data.level?.toLowerCase()] || 'Няма';

  return `<div class="region-tooltip">
    <span class="region-name">${name}</span>
    <div class="region-threat">
      <span class="threat-dot" style="background:${risk.fill}"></span>
      Риск: ${levelLabel}
    </div>
    ${data.threat !== 'none' ? `<div class="region-threat-type">${threat.emoji} ${threat.label}</div>` : ''}
  </div>`;
}


// ── 4. GeoJSON loading ──────────────────────────────────
function loadRiskRegions() {
  fetch(GEOJSON_URL)
    .then(res => res.json())
    .then(geojson => {
      riskGeoLayer = L.geoJSON(geojson, {
        style: function(feature) {
          return getRegionStyle(feature.properties.nuts3);
        },
        onEachFeature: function(feature, layer) {
          const nuts3 = feature.properties.nuts3;
          layer.bindTooltip(buildRegionTooltip(nuts3), { sticky: true });

          layer.on('mouseover', function() {
            const data = threatData[nuts3] || { level: 'none' };
            const risk = RISK_COLORS[data.level?.toLowerCase()] || RISK_COLORS.none;
            this.setStyle({ weight: 3, fillOpacity: Math.min(risk.opacity + 0.15, 0.7), opacity: 1 });
            this.bringToFront();
          });

          layer.on('mouseout', function() {
            riskGeoLayer.resetStyle(this);
          });

          layer.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            if (window.isResqReportMode && window.isResqReportMode()) return;
            const data = threatData[nuts3] || { threat: 'none' };
            const raw = (data.threat && data.threat !== 'none') ? data.threat : 'other';
            if (typeof window.goToSurvivalGuide === 'function') {
              window.goToSurvivalGuide(raw);
            } else {
              window.location.href = 'guides.html?type=' + encodeURIComponent(raw);
            }
          });
        }
      }).addTo(map);
    })
    .catch(err => console.error('Грешка при зареждане на GeoJSON:', err));
}


// ── 5. Region update logic ──────────────────────────────
function updateRiskRegions() {
  if (!riskGeoLayer) return;
  riskGeoLayer.eachLayer(function(layer) {
    if (layer.feature) {
      const nuts3 = layer.feature.properties.nuts3;
      layer.setStyle(getRegionStyle(nuts3));
      layer.setTooltipContent(buildRegionTooltip(nuts3));
    }
  });
}


// ── 6. Real-time updates & Poll ─────────────────────────

async function fetchRealStatus() {
  console.log('Fetching latest disaster status...');
  const data = await window.api.getStatus();
  
  if (data && !data.error) {
    // Map backend response (Array of DistrictStatus) to threatData object
    const newData = {};
    data.forEach(item => {
        // Backend uses 3-letter codes like 'SOF', 'VAR'
        newData[item.district_id] = {
            level: item.risk_level.toLowerCase(),
            threat: item.disaster_type,
            probability: item.probability
        };
    });
    threatData = newData;
    updateRiskRegions();

    // Show update badge
    const badge = document.getElementById('riskUpdateBadge');
    if (badge) {
      badge.style.opacity = '1';
      setTimeout(() => { badge.style.opacity = '0'; }, 3000);
    }
  }
}


// ── 7. Bootstrap ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadRiskRegions();
  
  // Initial fetch
  fetchRealStatus();

  // Hourly polling (3,600,000 ms)
  setInterval(fetchRealStatus, 3600000);
});
