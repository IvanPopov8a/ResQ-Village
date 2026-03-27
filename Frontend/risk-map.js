/* =======================================================
   risk-map.js — ResQ Village | Интерактивна карта на риска
   Секции:
     1. Oblast names & threat config
     2. Mock threat data
     3. Region styling & tooltip
     4. GeoJSON loading
     5. Region update logic
     6. Simulated real-time updates
     7. Bootstrap
   ======================================================= */

// ── 1. Oblast names & threat config ─────────────────────

// Имена на областите по NUTS3 код
const OBLAST_NAMES = {
  BLG: 'Благоевград', DOB: 'Добрич', GAB: 'Габрово', HKV: 'Хасково',
  KRZ: 'Кърджали', KNL: 'Кюстендил', LOV: 'Ловеч', MON: 'Монтана',
  PAZ: 'Пазарджик', PER: 'Перник', PDV: 'Пловдив', PVN: 'Плевен',
  RAZ: 'Разград', RSE: 'Русе', SHU: 'Шумен', SLS: 'Силистра',
  SLV: 'Сливен', SML: 'Смолян', SFO: 'София-област', SOF: 'София-град',
  SZR: 'Стара Загора', TGV: 'Търговище', VRC: 'Враца', VID: 'Видин',
  VTR: 'Велико Търново', JAM: 'Ямбол', BGS: 'Бургас', VAR: 'Варна'
};

// Типове заплахи
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

// Нива на риск и техните цветове
const RISK_COLORS = {
  none:   { fill: '#334155', border: '#475569', opacity: 0.25 },
  low:    { fill: '#4ade80', border: '#22c55e', opacity: 0.35 },
  medium: { fill: '#fbbf24', border: '#f59e0b', opacity: 0.4  },
  high:   { fill: '#ef4444', border: '#dc2626', opacity: 0.5  }
};


// ── 2. Mock threat data (симулира backend) ──────────────
let threatData = {
  BLG: { level: 'low',    threat: 'fire'       },
  DOB: { level: 'none',   threat: 'none'       },
  GAB: { level: 'medium', threat: 'storm'      },
  HKV: { level: 'high',   threat: 'heatwave'   },
  KRZ: { level: 'low',    threat: 'landslide'  },
  KNL: { level: 'none',   threat: 'none'       },
  LOV: { level: 'medium', threat: 'flood'      },
  MON: { level: 'none',   threat: 'none'       },
  PAZ: { level: 'low',    threat: 'earthquake' },
  PER: { level: 'none',   threat: 'none'       },
  PDV: { level: 'high',   threat: 'fire'       },
  PVN: { level: 'medium', threat: 'storm'      },
  RAZ: { level: 'none',   threat: 'none'       },
  RSE: { level: 'low',    threat: 'flood'      },
  SHU: { level: 'none',   threat: 'none'       },
  SLS: { level: 'none',   threat: 'none'       },
  SLV: { level: 'medium', threat: 'drought'    },
  SML: { level: 'low',    threat: 'landslide'  },
  SFO: { level: 'none',   threat: 'none'       },
  SOF: { level: 'low',    threat: 'storm'      },
  SZR: { level: 'high',   threat: 'fire'       },
  TGV: { level: 'none',   threat: 'none'       },
  VRC: { level: 'none',   threat: 'none'       },
  VID: { level: 'none',   threat: 'none'       },
  VTR: { level: 'low',    threat: 'earthquake' },
  JAM: { level: 'medium', threat: 'heatwave'   },
  BGS: { level: 'high',   threat: 'fire'       },
  VAR: { level: 'medium', threat: 'storm'      }
};


// ── 3. Region styling & tooltip ─────────────────────────

let riskGeoLayer = null;
const GEOJSON_URL = 'https://raw.githubusercontent.com/yurukov/Bulgaria-geocoding/master/provinces.geojson';

// Стил на регион спрямо нивото на заплаха
function getRegionStyle(nuts3) {
  const data = threatData[nuts3] || { level: 'none' };
  const risk = RISK_COLORS[data.level] || RISK_COLORS.none;
  return {
    fillColor:   risk.fill,
    weight:      2,
    opacity:     0.7,
    color:       risk.border,
    fillOpacity: risk.opacity,
    dashArray:   data.level === 'none' ? '4 4' : ''
  };
}

// Tooltip HTML за регион
function buildRegionTooltip(nuts3) {
  const name   = OBLAST_NAMES[nuts3] || nuts3;
  const data   = threatData[nuts3] || { level: 'none', threat: 'none' };
  const threat = THREAT_TYPES[data.threat] || THREAT_TYPES.none;
  const risk   = RISK_COLORS[data.level] || RISK_COLORS.none;
  const levelLabel = data.level === 'none' ? 'Няма' :
                     data.level === 'low'  ? 'Нисък' :
                     data.level === 'medium' ? 'Среден' : 'Висок';

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

          // Tooltip при hover
          layer.bindTooltip(buildRegionTooltip(nuts3), {
            sticky: true,
            className: '' // CSS се управлява от вътрешния HTML
          });

          // Hover ефекти
          layer.on('mouseover', function(e) {
            const data = threatData[nuts3] || { level: 'none' };
            const risk = RISK_COLORS[data.level] || RISK_COLORS.none;
            this.setStyle({
              weight: 3,
              fillOpacity: Math.min(risk.opacity + 0.15, 0.7),
              opacity: 1
            });
            this.bringToFront();
          });

          layer.on('mouseout', function(e) {
            riskGeoLayer.resetStyle(this);
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


// ── 6. Simulated real-time updates ──────────────────────
function simulateThreatUpdate() {
  const codes   = Object.keys(threatData);
  const levels  = ['none', 'low', 'medium', 'high'];
  const threats = ['none', 'fire', 'flood', 'earthquake', 'storm', 'landslide', 'drought', 'heatwave'];

  // Промени 2-4 случайни области
  const changeCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < changeCount; i++) {
    const code     = codes[Math.floor(Math.random() * codes.length)];
    const newLevel = levels[Math.floor(Math.random() * levels.length)];
    const newThreat = newLevel === 'none' ? 'none' : threats[1 + Math.floor(Math.random() * (threats.length - 1))];
    threatData[code] = { level: newLevel, threat: newThreat };
  }

  updateRiskRegions();

  // Покажи badge за обновяване
  const badge = document.getElementById('riskUpdateBadge');
  if (badge) {
    badge.style.opacity = '1';
    setTimeout(() => { badge.style.opacity = '0'; }, 2500);
  }
}


// ── 7. Bootstrap ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadRiskRegions();
  // Симулирай обновяване на всеки 30 секунди
  setInterval(simulateThreatUpdate, 300000);
});
