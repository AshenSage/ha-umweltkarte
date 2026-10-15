import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as config, numeric, buildRows, buildForecast, dateKey,
  zonedHour, forecastSegments, smoothPath } from '../dist/ha-umweltkarte.js';

const zone = 'Europe/Belgrade';
const now = Date.parse('2026-10-15T10:00:00+02:00');
const sensor = (state, attributes = {}) => ({ state, attributes: { quelle_aktuell: true, ...attributes } });
const forecast = overrides => sensor('0.9', {
  datenzeit: '2026-10-15T10:00:00+02:00', empfangen: '2026-10-15T10:00:00+02:00',
  prognose_datum: '2026-10-15',
  stunden_heute: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    .map((hour, i) => [zonedHour('2026-10-15', hour, zone), [0, 0, 0.1, 0.4, 0.9, 1.8, 2.7, 2.6, 2.3, 1.3, 0.7, 0.2, 0, 0, 0][i]]),
  ...overrides,
});

test('numeric input rejects booleans, empty values and non-finite numbers', () => {
  for (const value of [true, false, null, undefined, '', '  ', 'x', Infinity, NaN, {}, []]) assert.equal(numeric(value), null);
  assert.equal(numeric('0'), 0); assert.equal(numeric(0.9), 0.9);
});

test('missing or stale sources never appear green', () => {
  for (const state of ['unknown', 'unavailable', '', 'none']) {
    const states = Object.fromEntries([config.air_entity, config.uv_entity, config.pollen_entity].map(id => [id, sensor(state)]));
    for (const row of buildRows(states)) assert.equal(row.tone, 'unknown');
  }
  for (const source of [undefined, false, 'true', 1]) {
    const states = { [config.air_entity]: sensor('Gut', { quelle_aktuell: source, datenstatus: 'Veraltet' }) };
    assert.equal(buildRows(states)[0].status, '—');
    assert.equal(buildRows(states)[0].detail, 'Veraltet');
  }
  assert.equal(buildRows({})[0].detail, 'Sensor nicht gefunden');
});

test('air states and reason retain the supplied assessment', () => {
  for (const [state, tone] of [['Gut', 'good'], ['Akzeptabel', 'acceptable'], ['Mässig', 'moderate'], ['Mäßig', 'moderate'],
    ['Schlecht', 'high'], ['Sehr schlecht', 'very-high'], ['Extrem schlecht', 'extreme'], ['Unbekannt', 'unknown']]) {
    const row = buildRows({ [config.air_entity]: sensor(state, { grund: 'PM2.5' }) })[0];
    assert.equal(row.tone, tone); assert.equal(row.detail, 'PM2.5');
  }
});

test('UV zero is a valid value, but invalid and negative values are not', () => {
  const row = buildRows({ [config.uv_entity]: sensor('0', { max_heute: 0 }) })[1];
  assert.equal(row.value, '0,0'); assert.equal(row.tone, 'good'); assert.equal(row.detail, 'Maximum heute 0,0');
  for (const value of ['-1', 'NaN', 'Infinity', 'nonsense']) {
    const invalid = buildRows({ [config.uv_entity]: sensor(value) })[1];
    assert.equal(invalid.tone, 'unknown'); assert.equal(invalid.detail, 'Ungültiger UV-Wert');
  }
  assert.equal(buildRows({ [config.uv_entity]: sensor('2', { max_heute: true, prognose_status: 'Keine Prognose' }) })[1].detail, 'Keine Prognose');
});

test('UV thresholds use numeric index and not an arbitrary label', () => {
  for (const [value, tone] of [[0, 'good'], [2.99, 'good'], [3, 'moderate'], [6, 'high'], [8, 'very-high'], [11, 'extreme']]) {
    assert.equal(buildRows({ [config.uv_entity]: sensor(String(value)) })[1].tone, tone);
  }
});

test('incomplete pollen never produces an all-clear colour', () => {
  const partial = buildRows({ [config.pollen_entity]: sensor('Gering', { vollstaendig: false, arten_vorhanden: 3, arten_erwartet: 6 }) })[2];
  assert.equal(partial.tone, 'high'); assert.match(partial.detail, /3\/6 Arten verfügbar · Daten unvollständig/);
  assert.equal(buildRows({ [config.pollen_entity]: sensor('Gering', { vollstaendig: true }) })[2].tone, 'good');
  for (const level of ['Stark', 'Mindestens Stark']) assert.equal(buildRows({ [config.pollen_entity]: sensor(level) })[2].tone, 'very-high');
  for (const level of ['Mässig', 'Mindestens Mässig']) assert.equal(buildRows({ [config.pollen_entity]: sensor(level) })[2].tone, 'moderate');
  const invalidCount = buildRows({ [config.pollen_entity]: sensor('Gering', { arten_vorhanden: true, arten_erwartet: 6 }) })[2];
  assert.doesNotMatch(invalidCount.detail, /true\/6/);
});

test('offline hides values and forecast', () => {
  const states = { [config.air_entity]: sensor('Gut'), [config.uv_entity]: forecast(), [config.pollen_entity]: sensor('Gering', { vollstaendig: true }) };
  for (const row of buildRows(states, config, true)) {
    assert.equal(row.tone, 'unknown'); assert.equal(row.status, '—'); assert.equal(row.value, undefined);
  }
  assert.equal(buildForecast(forecast(), zone, now, true).available, false);
});

test('valid forecast preserves UTC timestamps and current-day range', () => {
  const input = forecast();
  const model = buildForecast(input, zone, now);
  assert.equal(model.available, true); assert.equal(model.points.length, 15);
  assert.equal(model.points[0][0], input.attributes.stunden_heute[0][0]);
  assert.equal(model.start, Date.parse('2026-10-15T06:00:00+02:00'));
  assert.equal(model.end, Date.parse('2026-10-15T20:00:00+02:00'));
});

test('timezone follows HA rather than device, including both DST transitions', () => {
  assert.equal(dateKey(Date.parse('2026-10-14T22:30:00Z'), zone), '2026-10-15');
  for (const [day, offset] of [['2026-03-29', '+02:00'], ['2026-10-25', '+01:00']]) {
    assert.equal(zonedHour(day, 6, zone), Date.parse(`${day}T06:00:00${offset}`));
    assert.equal(zonedHour(day, 20, zone), Date.parse(`${day}T20:00:00${offset}`));
    const stamp = `${day}T10:00:00${offset}`;
    const entity = forecast({ prognose_datum: day, datenzeit: stamp, empfangen: stamp,
      stunden_heute: [[zonedHour(day, 6, zone), 0], [zonedHour(day, 7, zone), 0.2]] });
    assert.equal(buildForecast(entity, zone, Date.parse(stamp)).available, true);
  }
});

test('forecast rejects old, missing, naive, wrong-day and future timestamps', () => {
  for (const overrides of [
    { datenzeit: '2026-10-15T07:59:59+02:00' },
    { empfangen: '2026-10-15T08:29:59+02:00' },
    { datenzeit: '2026-10-15T10:05:01+02:00' },
    { empfangen: '2026-10-15T10:01:01+02:00' },
    { datenzeit: undefined }, { empfangen: undefined },
    { datenzeit: '2026-10-15T10:00:00' }, { prognose_datum: '2026-10-14' },
    { stunden_heute: [] }, { quelle_aktuell: false },
  ]) assert.equal(buildForecast(forecast(overrides), zone, now).available, false, JSON.stringify(overrides));
  assert.equal(buildForecast(forecast({ datenzeit: '2026-10-15T08:00:00+02:00', empfangen: '2026-10-15T08:30:00+02:00' }), zone, now).available, true);
});

test('null, strings, negative values and booleans remain gaps; duplicates are deterministic', () => {
  const start = zonedHour('2026-10-15', 6, zone), h = 3600000;
  const model = buildForecast(forecast({ stunden_heute: [
    [start + 4 * h, true], [start, 0], [start + h, null], [start + 2 * h, '1.1'],
    [start + 3 * h, -1], [start + 5 * h, 1], [start + 5 * h, 1.2],
    [start - h, 1], ['not-a-timestamp', 2], [start + 24 * h, 2],
  ] }), zone, now);
  assert.deepEqual(model.points.map(point => point[1]), [0, null, null, null, null, 1.2]);
  const segments = forecastSegments(model.points);
  assert.equal(segments.length, 2); assert.equal(segments[0].length, 1);
  assert.equal(forecastSegments([[start, 1], [start + 3 * h, 2]]).length, 2);
});

test('smooth curve control points remain within each adjacent pair', () => {
  const points = [[0, 100], [20, 80], [40, 20], [60, 18], [80, 50], [100, 100]];
  const path = smoothPath(points);
  assert.doesNotMatch(path, /NaN|Infinity/);
  const curves = path.split(' C').slice(1);
  curves.forEach((curve, i) => {
    const nums = curve.split(/[ ,]/).map(Number);
    const low = Math.min(points[i][1], points[i + 1][1]);
    const high = Math.max(points[i][1], points[i + 1][1]);
    assert.ok(nums[1] >= low && nums[1] <= high);
    assert.ok(nums[3] >= low && nums[3] <= high);
  });
});
