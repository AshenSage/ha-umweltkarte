/* Umweltkarte for Home Assistant · MIT · https://github.com/AshenSage/ha-umweltkarte */
export const VERSION = '1.0.0';
export const DEFAULT_CONFIG = Object.freeze({
  title: 'Umwelt heute',
  subtitle: 'Aranđelovac',
  air_entity: 'sensor.arandjelovac_luftqualitaet',
  uv_entity: 'sensor.arandjelovac_uv_index',
  pollen_entity: 'sensor.arandjelovac_pollen',
  show_uv_chart: true,
});

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const text = value => typeof value === 'string' ? value.trim().replaceAll('ß', 'ss') : '';
const key = value => text(value).toLowerCase();
export function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const nonnegative = value => { const n = numeric(value); return n !== null && n >= 0 ? n : null; };
const fmt = (value, digits = 1) => new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false,
}).format(value).replace('.', ',');
const hasValue = entity => entity && typeof entity.state === 'string'
  && !['', 'unknown', 'unavailable', 'none', 'null'].includes(key(entity.state));
const current = entity => hasValue(entity) && entity.attributes?.quelle_aktuell === true;
const stamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  ? Date.parse(value) : NaN;
const icon = name => `<ha-icon icon="mdi:${esc(name)}" aria-hidden="true"></ha-icon>`;
const count = value => { const n = numeric(value); return n !== null && Number.isInteger(n) && n >= 0 ? n : null; };

export function dateKey(timestamp, timeZone) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch { return null; }
}

// Resolve a wall-clock hour in the HA timezone; never shift forecast timestamps.
export function zonedHour(day, hour, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const [year, month, date] = day.split('-').map(Number);
  const wallTime = Date.UTC(year, month - 1, date, hour);
  let candidate = wallTime;
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(candidate).map(part => [part.type, part.value]));
    const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
      +parts.hour, +parts.minute, +parts.second);
    const correction = wallTime - represented;
    candidate += correction;
    if (!correction) break;
  }
  return candidate;
}

export function buildRows(states, config = DEFAULT_CONFIG, offline = false) {
  const missing = (kind, entityId, title, symbol) => {
    const entity = states?.[entityId];
    return {
      kind, entityId, title, symbol, tone: 'unknown', status: '—',
      detail: offline ? 'Verbindung unterbrochen'
        : text(entity?.attributes?.datenstatus) || (entity ? 'Keine aktuellen Daten' : 'Sensor nicht gefunden'),
    };
  };
  const air = missing('air', config.air_entity, 'Luftqualität', 'leaf');
  const a = states?.[config.air_entity];
  if (!offline && current(a)) {
    air.status = text(a.state);
    air.detail = text(a.attributes.grund) || 'Aktuelle Einordnung';
    air.tone = ({ gut: 'good', akzeptabel: 'acceptable', 'mässig': 'moderate',
      schlecht: 'high', 'sehr schlecht': 'very-high', 'extrem schlecht': 'extreme' })[key(a.state)] || 'unknown';
  }
  const uv = missing('uv', config.uv_entity, 'UV-Index', 'white-balance-sunny');
  const u = states?.[config.uv_entity];
  if (!offline && current(u)) {
    const value = nonnegative(u.state);
    if (value === null) uv.detail = 'Ungültiger UV-Wert';
    else {
      uv.value = fmt(value);
      uv.status = text(u.attributes.stufe) || (value < 3 ? 'Niedrig' : value < 6 ? 'Mässig'
        : value < 8 ? 'Hoch' : value < 11 ? 'Sehr hoch' : 'Extrem');
      uv.tone = value < 3 ? 'good' : value < 6 ? 'moderate' : value < 8 ? 'high'
        : value < 11 ? 'very-high' : 'extreme';
      const maximum = nonnegative(u.attributes.max_heute);
      uv.detail = maximum !== null ? `Maximum heute ${fmt(maximum)}`
        : text(u.attributes.prognose_status) || 'Keine Prognose';
    }
  }
  const pollen = missing('pollen', config.pollen_entity, 'Pollen', 'flower-pollen');
  const p = states?.[config.pollen_entity];
  if (!offline && current(p)) {
    const level = key(p.state);
    const full = p.attributes.vollstaendig === true;
    pollen.status = text(p.state);
    const strong = ['stark', 'mindestens stark'].includes(level);
    const moderate = ['mässig', 'mindestens mässig'].includes(level);
    pollen.symbol = strong || moderate ? 'allergy' : 'flower-pollen';
    pollen.tone = strong ? 'very-high' : moderate ? 'moderate' : !full ? 'high'
      : ['gering', 'keine pollen gemeldet'].includes(level) ? 'good' : 'unknown';
    const details = [text(p.attributes.grund) || (level === 'gering' ? 'Unter den hinterlegten Schwellen' : '')];
    if (!full) {
      const present = count(p.attributes.arten_vorhanden);
      const expected = count(p.attributes.arten_erwartet);
      details.push(present !== null && expected !== null && expected > 0 && present <= expected
        ? `${present}/${expected} Arten verfügbar · Daten unvollständig` : 'Daten unvollständig');
    }
    pollen.detail = details.filter(Boolean).join(' · ') || 'Aktuelle Einordnung';
  }
  return [air, uv, pollen];
}

export function buildForecast(entity, timeZone, now = Date.now(), offline = false) {
  const unavailable = reason => ({ available: false, reason, points: [] });
  if (offline) return unavailable('Keine UV-Prognose ohne Verbindung.');
  if (!current(entity)) return unavailable(text(entity?.attributes?.datenstatus) || 'Keine aktuelle UV-Prognose.');
  if (nonnegative(entity.state) === null) return unavailable('Ungültiger UV-Wert.');
  const a = entity.attributes;
  const day = dateKey(now, timeZone);
  if (!day || a.prognose_datum !== day) return unavailable('Keine UV-Prognose für heute.');
  const age = (now - stamp(a.datenzeit)) / 1000;
  const fetchAge = (now - stamp(a.empfangen)) / 1000;
  if (!Number.isFinite(age) || !Number.isFinite(fetchAge)) return unavailable('Zeitangaben der UV-Prognose fehlen oder sind ungültig.');
  if (age < -300 || fetchAge < -60) return unavailable('Zeitangaben der UV-Prognose liegen in der Zukunft.');
  if (age > 7200 || fetchAge > 5400) return unavailable('Die UV-Prognose ist veraltet.');
  if (!Array.isArray(a.stunden_heute)) return unavailable(text(a.prognose_status) || 'Keine Stundenprognose verfügbar.');
  const start = zonedHour(day, 6, timeZone);
  const end = zonedHour(day, 20, timeZone);
  const unique = new Map();
  for (const point of a.stunden_heute) {
    if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number'
      || !Number.isFinite(point[0]) || dateKey(point[0], timeZone) !== day
      || point[0] < start || point[0] > end) continue;
    // Only real numeric forecast values count. Nulls remain explicit gaps.
    unique.set(point[0], typeof point[1] === 'number' && Number.isFinite(point[1]) && point[1] >= 0 ? point[1] : null);
  }
  const points = [...unique].sort((a, b) => a[0] - b[0]);
  if (!points.some(point => point[1] !== null)) return unavailable(text(a.prognose_status) || 'Keine gültigen UV-Stundenwerte verfügbar.');
  const maximum = Math.max(...points.filter(point => point[1] !== null).map(point => point[1]));
  return { available: true, points, start, end, maximum, now, timeZone };
}

// Monotone cubic interpolation: smooth curves without invented peaks or negative UV.
export function smoothPath(points) {
  const n = points.length;
  if (!n) return '';
  const r = n => Number(n.toFixed(2));
  let path = `M${r(points[0][0])},${r(points[0][1])}`;
  if (n === 1) return path;
  const delta = points.slice(1).map((point, i) => (point[1] - points[i][1]) / (point[0] - points[i][0]));
  const slopes = points.map((_, i) => i === 0 ? delta[0] : i === n - 1 ? delta[n - 2]
    : delta[i - 1] * delta[i] <= 0 ? 0 : 2 / (1 / delta[i - 1] + 1 / delta[i]));
  delta.forEach((d, i) => {
    if (d === 0) { slopes[i] = 0; slopes[i + 1] = 0; return; }
    const a = slopes[i] / d, b = slopes[i + 1] / d;
    const length = Math.hypot(a, b);
    if (length > 3) { slopes[i] = 3 * a * d / length; slopes[i + 1] = 3 * b * d / length; }
  });
  for (let i = 1; i < n; i += 1) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const third = (x1 - x0) / 3;
    path += ` C${r(x0 + third)},${r(y0 + slopes[i - 1] * third)} ${r(x1 - third)},${r(y1 - slopes[i] * third)} ${r(x1)},${r(y1)}`;
  }
  return path;
}

export function forecastSegments(points) {
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point[1] === null || (segment.length && point[0] - segment.at(-1)[0] > 90 * 60 * 1000)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (point[1] !== null) segment.push(point);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

const STYLES = `
  :host{display:block;min-width:0;container-type:inline-size;font-family:var(--ha-font-family-body,Roboto,Arial,sans-serif);--uc-text:var(--primary-text-color,#202c25);--uc-muted:var(--secondary-text-color,#67756c);--uc-line:color-mix(in srgb,var(--uc-text) 12%,transparent);--uc-good:var(--umweltkarte-good-color,var(--success-color,#388454));--uc-acceptable:var(--umweltkarte-acceptable-color,#739f42);--uc-moderate:var(--umweltkarte-moderate-color,var(--warning-color,#ba810d));--uc-high:var(--umweltkarte-high-color,#dc7b2c);--uc-very-high:var(--umweltkarte-very-high-color,var(--error-color,#cf5454));--uc-extreme:var(--umweltkarte-extreme-color,#a66ad1);--uc-chart:var(--umweltkarte-chart-color,var(--weather-card-accent,#6fa582))}
  *{box-sizing:border-box}[hidden]{display:none!important}
  ha-card{display:block;overflow:hidden;padding:18px 18px 13px;background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--uc-text);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--uc-line));border-radius:var(--ha-card-border-radius,20px);box-shadow:var(--ha-card-box-shadow,none)}
  header{padding-bottom:9px;min-width:0}.subtitle{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--uc-muted);overflow-wrap:anywhere}h2{font-size:18px;line-height:1.4;font-weight:500;margin:3px 0 0;overflow-wrap:anywhere}
  button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}button:focus-visible,svg:focus-visible{outline:2px solid var(--uc-chart);outline-offset:3px;border-radius:8px}
  .row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:12px;width:100%;min-height:65px;padding:11px 0;background:none;border:0;text-align:left;line-height:1.4}.row+.row{border-top:1px solid var(--uc-line)}.row:hover{background:color-mix(in srgb,var(--uc-text) 3%,transparent)}
  .symbol{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:color-mix(in srgb,var(--uc-text) 6%,transparent);color:var(--tone,var(--uc-muted))}ha-icon{display:inline-flex;--mdc-icon-size:20px;width:20px;height:20px;flex-shrink:0}
  .copy{min-width:0}.label{font-size:14px;display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 9px}.value{font-weight:500;font-variant-numeric:tabular-nums}.detail{display:block;font-size:12px;color:var(--uc-muted);margin-top:2px;overflow-wrap:anywhere}.status{font-size:13px;max-width:112px;text-align:right;font-weight:500;color:var(--tone,var(--uc-muted));overflow-wrap:anywhere}
  [data-tone="good"]{--tone:var(--uc-good)}[data-tone="acceptable"]{--tone:var(--uc-acceptable)}[data-tone="moderate"]{--tone:var(--uc-moderate)}[data-tone="high"]{--tone:var(--uc-high)}[data-tone="very-high"]{--tone:var(--uc-very-high)}[data-tone="extreme"]{--tone:var(--uc-extreme)}[data-tone="unknown"]{--tone:var(--uc-muted)}
  .chart-section{border-top:1px solid var(--uc-line);margin-top:4px;padding-top:13px}.chart-heading{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}.chart-title{font-size:13px;font-weight:500}.model-label{font-size:11px;color:var(--uc-muted)}.chart{height:116px;margin-top:5px}.chart svg{display:block;width:100%;height:100%;touch-action:pan-y;overflow:visible}.axis{fill:var(--uc-muted);font:11px var(--ha-font-family-body,Roboto,Arial,sans-serif)}.grid{stroke:var(--uc-line);stroke-width:1}.forecast-line{fill:none;stroke:var(--uc-chart);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.forecast-dot{fill:var(--uc-chart)}.now-line{stroke:var(--uc-muted);stroke-width:1;stroke-dasharray:3 4}.selection-line{stroke:var(--uc-chart);stroke-width:1}.selection-point{fill:var(--uc-chart);stroke:var(--ha-card-background,var(--card-background-color,#fff));stroke-width:2}
  .chart-foot{display:flex;justify-content:space-between;flex-wrap:wrap;align-items:center;gap:4px 12px;min-height:23px;font-size:11px;color:var(--uc-muted)}.chart-readout{font:inherit;font-variant-numeric:tabular-nums;color:var(--uc-text)}.chart-empty{font-size:12px;color:var(--uc-muted);line-height:1.5;padding:14px 0 5px;overflow-wrap:anywhere}.connection{display:flex;align-items:center;gap:7px;font-size:12px;line-height:1.4;color:var(--uc-muted);padding:7px 0 0}.connection ha-icon{--mdc-icon-size:16px;width:16px;height:16px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @container(max-width:340px){ha-card{padding:15px 12px 11px}.row{gap:9px;grid-template-columns:34px minmax(0,1fr) auto}.symbol{width:34px;height:34px}.status{max-width:96px}.model-label{font-size:11px}}
`;

const ElementBase = globalThis.HTMLElement || class {};
export class Umweltkarte extends ElementBase {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._selected = null;
    this._pinned = false;
    this._offline = false;
    this.shadowRoot.addEventListener('click', event => {
      const row = event.composedPath().find(el => el?.dataset?.entity);
      if (row) this.dispatchEvent(new CustomEvent('hass-more-info', {
        bubbles: true, composed: true, detail: { entityId: row.dataset.entity },
      }));
    });
    this.shadowRoot.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch' && !this._pinned) this._inspectPointer(event);
    });
    this.shadowRoot.addEventListener('pointerdown', event => {
      if (event.composedPath().some(el => el?.hasAttribute?.('data-plot'))) {
        this._pinned = true; this._inspectPointer(event); this._announceInspection();
      }
    });
    this.shadowRoot.addEventListener('pointerout', event => {
      if (!this._pinned && event.composedPath().some(el => el?.hasAttribute?.('data-plot'))
        && !this.shadowRoot.querySelector('[data-plot]')?.contains(event.relatedTarget)) {
        this._selected = null; this._showInspection();
      }
    });
    this.shadowRoot.addEventListener('keydown', event => this._onKey(event));
    this._onReady = () => { this._offline = false; this._render(); };
    this._onDisconnected = () => { this._offline = true; this._render(); };
  }
  setConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Eine Kartenkonfiguration ist erforderlich.');
    const next = { ...DEFAULT_CONFIG, ...config };
    for (const name of ['air_entity', 'uv_entity', 'pollen_entity']) {
      if (typeof next[name] !== 'string' || !/^sensor\.[a-z0-9_]+$/.test(next[name])) throw new Error(`${name}: Bitte eine gültige Sensor-Entität angeben.`);
    }
    for (const name of ['title', 'subtitle']) if (typeof next[name] !== 'string') throw new Error(`${name} muss Text sein.`);
    if (typeof next.show_uv_chart !== 'boolean') throw new Error('show_uv_chart muss true oder false sein.');
    if (next.time_zone !== undefined && (typeof next.time_zone !== 'string' || !dateKey(Date.now(), next.time_zone))) throw new Error('time_zone muss eine gültige Zeitzone sein, zum Beispiel Europe/Belgrade.');
    if (this._config?.uv_entity !== next.uv_entity) { this._selected = null; this._pinned = false; }
    this._config = next;
    this._render();
  }
  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (previous?.connected === false && hass?.connected === true) this._offline = false;
    const connectionChanged = this._connection !== hass?.connection;
    this._syncConnection();
    const changed = !previous || ['air_entity', 'uv_entity', 'pollen_entity'].some(name =>
      previous.states?.[this._config?.[name]] !== hass?.states?.[this._config?.[name]])
      || previous.config?.time_zone !== hass?.config?.time_zone || previous.connected !== hass?.connected;
    if (changed || connectionChanged) this._render();
  }
  get hass() { return this._hass; }
  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._render(), 60000);
    if (globalThis.ResizeObserver) {
      this._observer?.disconnect();
      this._observer = new ResizeObserver(entries => {
        const width = Math.round(entries[0]?.contentRect.width || 0);
        if (width && width !== this._width) { this._width = width; this._renderGraph(); }
      });
      this._observer.observe(this);
    }
    this._syncConnection(); this._render();
  }
  disconnectedCallback() {
    clearInterval(this._timer); this._timer = null;
    this._observer?.disconnect(); this._observer = null;
    this._unbindConnection();
  }
  getCardSize() { return this._config?.show_uv_chart === false ? 6 : 9; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  static getStubConfig() { return { ...DEFAULT_CONFIG }; }
  _unbindConnection() {
    this._connection?.removeEventListener?.('ready', this._onReady);
    this._connection?.removeEventListener?.('disconnected', this._onDisconnected);
    this._connection = null;
  }
  _syncConnection() {
    if (!this.isConnected) return;
    if (this._connection !== this._hass?.connection) {
      this._unbindConnection(); this._connection = this._hass?.connection;
      this._connection?.addEventListener?.('ready', this._onReady);
      this._connection?.addEventListener?.('disconnected', this._onDisconnected);
      this._offline = this._hass?.connected === false;
    } else if (this._hass?.connected === false) this._offline = true;
  }
  _timeZone() {
    const zone = this._config?.time_zone || this._hass?.config?.time_zone;
    return zone && dateKey(Date.now(), zone) ? zone : 'Europe/Belgrade';
  }
  _time(timestamp) {
    return new Intl.DateTimeFormat('de-CH', { timeZone: this._timeZone(),
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp);
  }
  _render() {
    if (!this._config) return;
    const focus = this.shadowRoot.activeElement?.getAttribute('data-focus');
    const rows = buildRows(this._hass?.states, this._config, this._offline);
    this._forecast = buildForecast(this._hass?.states?.[this._config.uv_entity], this._timeZone(), Date.now(), this._offline);
    if (this._selected !== null && !this._forecast.points.some(point => point[0] === this._selected)) {
      this._selected = null; this._pinned = false;
    }
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><ha-card>
      ${this._config.title || this._config.subtitle ? `<header>${this._config.subtitle ? `<div class="subtitle">${esc(this._config.subtitle)}</div>` : ''}${this._config.title ? `<h2>${esc(this._config.title)}</h2>` : ''}</header>` : ''}
      ${this._offline ? `<div class="connection" role="status">${icon('wifi-off')}<span>Verbindung zu Home Assistant unterbrochen</span></div>` : ''}
      <div class="rows">${rows.map(row => `<button type="button" class="row" data-kind="${row.kind}" data-tone="${row.tone}" data-entity="${esc(row.entityId)}" data-focus="${row.kind}" aria-label="${esc(`${row.title}${row.value ? ` ${row.value}` : ''}: ${row.status}. ${row.detail}. Sensordetails öffnen.`)}">
        <span class="symbol">${icon(row.symbol)}</span><span class="copy"><span class="label">${esc(row.title)}${row.value ? `<span class="value">${esc(row.value)}</span>` : ''}</span><span class="detail">${esc(row.detail)}</span></span><span class="status">${esc(row.status)}</span>
      </button>`).join('')}</div>
      ${this._config.show_uv_chart ? `<section class="chart-section" aria-label="UV-Prognose heute"><div class="chart-heading"><span class="chart-title">UV im Tagesverlauf</span><span class="model-label">Modellprognose</span></div>
        ${this._forecast.available ? `<div class="chart"></div><div class="chart-foot"><output class="chart-readout" aria-live="off"></output><span>06:00–20:00</span></div><span class="chart-announcement sr-only" aria-live="polite"></span>` : `<div class="chart-empty">${esc(this._forecast.reason)}</div>`}
      </section>` : ''}
    </ha-card>`;
    this._renderGraph();
    if (focus) this.shadowRoot.querySelector(`[data-focus="${focus}"]`)?.focus({ preventScroll: true });
  }
  _renderGraph() {
    const host = this.shadowRoot.querySelector('.chart');
    const f = this._forecast;
    if (!host || !f?.available) return;
    const focus = this.shadowRoot.activeElement?.hasAttribute('data-plot');
    const width = host.clientWidth || 320, height = 116;
    const left = 24, right = width - 7, top = 13, bottom = height - 23;
    const upper = Math.max(3, Math.ceil(f.maximum));
    const x = timestamp => left + (timestamp - f.start) / (f.end - f.start) * (right - left);
    const y = value => bottom - value / upper * (bottom - top);
    this._plot = { width, left, right, top, bottom, x, y };
    const segments = forecastSegments(f.points);
    const paths = segments.map(segment => {
      const coordinates = segment.map(point => [x(point[0]), y(point[1])]);
      const line = smoothPath(coordinates);
      return coordinates.length === 1 ? `<circle class="forecast-dot" cx="${coordinates[0][0]}" cy="${coordinates[0][1]}" r="3"></circle>`
        : `<path d="${line} L${coordinates.at(-1)[0]},${bottom} L${coordinates[0][0]},${bottom} Z" fill="url(#uv-area)"></path><path class="forecast-line" d="${line}"></path>`;
    }).join('');
    const nowVisible = f.now >= f.start && f.now <= f.end;
    const nowX = x(f.now);
    const ticks = [6, 10, 14, 20].map(hour => `<text class="axis" x="${x(zonedHour(dateKey(f.now, f.timeZone), hour, f.timeZone))}" y="${height - 5}" text-anchor="${hour === 6 ? 'start' : hour === 20 ? 'end' : 'middle'}">${String(hour).padStart(2, '0')}:00</text>`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" tabindex="0" data-plot data-focus="plot" aria-label="UV-Modellprognose heute von 06 bis 20 Uhr. Maximum im sichtbaren Verlauf ${esc(fmt(f.maximum))}. Mit Pfeiltasten Stundenwerte erkunden; Escape setzt die Auswahl zurück.">
      <defs><linearGradient id="uv-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--uc-chart)" stop-opacity=".24"></stop><stop offset="100%" stop-color="var(--uc-chart)" stop-opacity=".035"></stop></linearGradient></defs>
      <text class="axis" x="0" y="${top + 4}">${upper}</text><text class="axis" x="0" y="${bottom + 4}">0</text>
      <line class="grid" x1="${left}" x2="${right}" y1="${top}" y2="${top}" stroke-dasharray="2 5"></line><line class="grid" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"></line>
      ${paths}${nowVisible ? `<line class="now-line" x1="${nowX}" x2="${nowX}" y1="${top}" y2="${bottom}"></line><text class="axis" x="${Math.max(left + 2, Math.min(right - 2, nowX + (nowX > right - 40 ? -5 : 5)))}" y="${top - 4}" text-anchor="${nowX > right - 40 ? 'end' : 'start'}">Jetzt</text>` : ''}
      ${ticks}<g class="inspection" visibility="hidden"><line class="selection-line" y1="${top}" y2="${bottom}"></line><circle class="selection-point" r="4"></circle></g>
    </svg>`;
    this._showInspection();
    if (focus) host.querySelector('svg')?.focus({ preventScroll: true });
  }
  _inspectPointer(event) {
    const svg = event.composedPath().find(el => el?.hasAttribute?.('data-plot'));
    if (!svg || !this._plot || !this._forecast?.available) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const px = (event.clientX - bounds.left) / bounds.width * this._plot.width;
    const fraction = Math.max(0, Math.min(1, (px - this._plot.left) / (this._plot.right - this._plot.left)));
    const timestamp = this._forecast.start + fraction * (this._forecast.end - this._forecast.start);
    this._selected = this._forecast.points.reduce((nearest, point) => Math.abs(point[0] - timestamp) < Math.abs(nearest[0] - timestamp) ? point : nearest)[0];
    this._showInspection();
  }
  _showInspection() {
    const group = this.shadowRoot.querySelector('.inspection');
    const output = this.shadowRoot.querySelector('.chart-readout');
    const f = this._forecast;
    if (!group || !output || !f?.available) return;
    const point = this._selected === null ? null : f.points.find(point => point[0] === this._selected);
    if (!point) {
      group.setAttribute('visibility', 'hidden');
      output.textContent = 'UV-Prognose heute';
      return;
    }
    const px = this._plot.x(point[0]);
    group.setAttribute('visibility', 'visible');
    const line = group.querySelector('line');
    line.setAttribute('x1', px); line.setAttribute('x2', px);
    const dot = group.querySelector('circle');
    dot.setAttribute('visibility', point[1] === null ? 'hidden' : 'visible');
    if (point[1] !== null) { dot.setAttribute('cx', px); dot.setAttribute('cy', this._plot.y(point[1])); }
    output.textContent = `${this._time(point[0])} · ${point[1] === null ? 'Keine Prognose' : `UV ${fmt(point[1])}`}`;
  }
  _announceInspection() {
    const region = this.shadowRoot.querySelector('.chart-announcement');
    if (region) region.textContent = this.shadowRoot.querySelector('.chart-readout')?.textContent || '';
  }
  _onKey(event) {
    if (!event.composedPath().some(el => el?.hasAttribute?.('data-plot')) || !this._forecast?.available) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') { this._selected = null; this._pinned = false; this._showInspection(); this._announceInspection(); return; }
    const points = this._forecast.points;
    let index = this._selected === null ? points.findIndex(point => point[0] >= this._forecast.now)
      : points.findIndex(point => point[0] === this._selected);
    if (index < 0) index = points.length - 1;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = points.length - 1;
    else index = Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
    this._selected = points[index][0]; this._pinned = true;
    this._showInspection(); this._announceInspection();
  }
}

if (globalThis.customElements && !customElements.get('ha-umweltkarte')) customElements.define('ha-umweltkarte', Umweltkarte);
if (globalThis.window) {
  window.customCards = window.customCards || [];
  if (!window.customCards.some(card => card.type === 'ha-umweltkarte')) window.customCards.push({
    type: 'ha-umweltkarte', name: 'Umweltkarte', preview: false,
    description: 'Luftqualität, UV und Pollen in lesbaren Zeilen mit UV-Tagesprognose.',
    documentationURL: 'https://github.com/AshenSage/ha-umweltkarte',
  });
}
