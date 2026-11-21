/**
 * models.js
 *
 * Servicio de modelos y odds de Fulbito (The Odds API, vóley, Elo multideporte).
 * Propósito de Fase 4.3: `server/server.js` solo compone rutas; la lógica de
 * consumo de odds, consolidación dePredichos y Elo queda en servicio de aplicación.
 *
 * Contrato:
 *   - `oddsPorDeporte(sport, opciones)` => Promise<partidos>; lanza si no hay servicio.
 *   - `prediccionesPorDeporte(deporte, opciones)` => Promise<salidaPredicciones>
 *   - `listarCatalogo()` => odds del catalogo de deportes
 *
 * Usa `fetch` y variables de entorno. No hay I/O de base de datos; el estado Elo
 * se persiste en `data/elo_state.json` (responsabilidad del processo).
 */
const fs = require('fs');
const path = require('path');

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
const THE_ODDS_BASE_URL = 'https://api.the-odds-api.com/v4';
const ELO_STATE_PATH = path.join(process.env.FULBITO_DATA_DIR || path.join(__dirname, 'data'), 'elo_state.json');
const BASE_ELO = 1500;
const FETCH_TIMEOUT_MS = 12000;

// --- Estado Elo ---
let estadoElo = { basquet: { equipos: {} }, tenis: { jugadores: {} }, entrenamientos: { basquet: 0, tenis: 0 } };

function cargarEstadoElo() {
  try {
    const datos = JSON.parse(fs.readFileSync(ELO_STATE_PATH, 'utf8'));
    estadoElo = {
      basquet: { equipos: datos.basquet?.equipos || {} },
      tenis: { jugadores: datos.tenis?.jugadores || {} },
      entrenamientos: { basquet: 0, tenis: 0, ...(datos.entrenamientos || {}) }
    };
  } catch (e) {}
}
function guardarEstadoElo() {
  try { fs.mkdirSync(path.dirname(ELO_STATE_PATH), { recursive: true }); fs.writeFileSync(ELO_STATE_PATH, JSON.stringify(estadoElo)); } catch (e) {}
}
cargarEstadoElo();

// --- Funciones matemáticas ---
function erfAprox(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function eloProbGanar(diff) { return 1 / (1 + Math.pow(10, -diff / 400)); }
function probGanarBasquet(eloL, eloV) { return eloProbGanar(eloL - eloV + 3.5 * 25); }
function probCubreSpread(diff, sd = 11.5) {
  return diff >= 0 ? 1 - 0.5 * (1 + erfAprox(diff / (sd * Math.SQRT2))) : 0.5 * (1 + erfAprox(Math.abs(diff) / (sd * Math.SQRT2)));
}
function equipoBasquet(nombre) {
  const e = estadoElo.basquet.equipos[nombre];
  return e || { elo: BASE_ELO, partidos: 0, ritmo: 100, effOff: 1.1, effDef: 1.1 };
}
function jugadorTenis(nombre) { return estadoElo.tenis.jugadores[nombre] || { eloGeneral: BASE_ELO, partidos: 0 }; }
function puntosEsperadosBasquet(eqL, eqV) {
  const ritmo = (eqL.ritmo + eqV.ritmo) / 2;
  const effL = ((eqL.effOff + eqV.effDef) / 2) * 1.025;
  const effV = ((eqV.effOff + eqL.effDef) / 2) * 0.975;
  return [ritmo * effL, ritmo * effV];
}
function setsEstimadosTenis(pJ1) {
  const p20 = Math.pow(pJ1, 1.6);
  const p21 = Math.max(0, pJ1 - p20);
  const p02 = Math.pow(1 - pJ1, 1.6);
  const p12 = Math.max(0, (1 - pJ1) - p02);
  const tot = p20 + p21 + p02 + p12 || 1;
  return { '2-0': p20 / tot, '2-1': p21 / tot, '0-2': p02 / tot, '1-2': p12 / tot };
}

function entrenarBasquet(local, visita, ptsL, ptsV) {
  const l = estadoElo.basquet.equipos[local] || { elo: BASE_ELO, partidos: 0, ritmo: 100, effOff: 1.1, effDef: 1.1 };
  const v = estadoElo.basquet.equipos[visita] || { elo: BASE_ELO, partidos: 0, ritmo: 100, effOff: 1.1, effDef: 1.1 };
  const cambio = 20 * (ptsL > ptsV ? 1 : 0 - eloProbGanar(l.elo - v.elo + 3.5 * 25));
  l.elo += cambio; v.elo -= cambio;
  const alpha = 0.2;
  l.partidos++; v.partidos++;
  l.ritmo = (1 - alpha) * l.ritmo + alpha * 100;
  v.ritmo = (1 - alpha) * v.ritmo + alpha * 100;
  estadoElo.basquet.equipos[local] = l; estadoElo.basquet.equipos[visita] = v;
}
function entrenarTenis(j1, j2, ganoJ1) {
  const a = estadoElo.tenis.jugadores[j1] || { eloGeneral: BASE_ELO, partidos: 0 };
  const b = estadoElo.tenis.jugadores[j2] || { eloGeneral: BASE_ELO, partidos: 0 };
  const esperado = eloProbGanar(a.eloGeneral - b.eloGeneral);
  const cambio = 32 * ((ganoJ1 ? 1 : 0) - esperado);
  a.eloGeneral += cambio; b.eloGeneral -= cambio;
  a.partidos++; b.partidos++;
  estadoElo.tenis.jugadores[j1] = a; estadoElo.tenis.jugadores[j2] = b;
}

function puntosScores(ev) {
  let l = null, v = null;
  if (Array.isArray(ev.scores)) {
    for (const s of ev.scores) {
      const n = String(s.name || '').toLowerCase();
      if (n.includes('home') || n === 'h') l = s.value;
      else if (n.includes('away') || n === 'a') v = s.value;
    }
  } else if (ev.scores && typeof ev.scores === 'object') {
    l = ev.scores.home != null ? ev.scores.home : ev.scores.home_team;
    v = ev.scores.away != null ? ev.scores.away : ev.scores.away_team;
  }
  if (l == null && ev.home_score != null) l = ev.home_score;
  if (v == null && ev.away_score != null) v = ev.away_score;
  return { l, v };
}

async function entrenarEloDesdeScores(sportKey, deporte) {
  if (!THE_ODDS_API_KEY) return 0;
  const resp = await fetch(`${THE_ODDS_BASE_URL}/sports/${sportKey}/scores/?apiKey=${THE_ODDS_API_KEY}`);
  if (!resp.ok) return 0;
  const datos = await resp.json();
  let n = 0;
  for (const ev of datos) {
    if (!ev.completed) continue;
    const { l, v } = puntosScores(ev);
    if (l == null || v == null || l === v || !ev.home_team || !ev.away_team) continue;
    if (deporte === 'basquet') entrenarBasquet(ev.home_team, ev.away_team, l, v);
    else entrenarTenis(ev.home_team, ev.away_team, l > v ? 1 : 0);
    n++;
  }
  if (n > 0) { estadoElo.entrenamientos[deporte] = (estadoElo.entrenamientos[deporte] || 0) + n; guardarEstadoElo(); }
  return n;
}

function consensoH2H(bookmakers) {
  let suma = [0, 0], n = 0;
  for (const b of bookmakers || []) {
    const m = (b.markets || []).find(mk => mk.key === 'h2h');
    if (!m || (m.outcomes || []).length < 2) continue;
    const [o1, o2] = m.outcomes;
    if (!(o1.price > 1 && o2.price > 1)) continue;
    const p1 = 1 / o1.price, p2 = 1 / o2.price;
    const tot = p1 + p2;
    suma[0] += p1 / tot; suma[1] += p2 / tot; n++;
  }
  return n ? [suma[0] / n, suma[1] / n] : null;
}
function mejorPrecioH2H(bookmakers, idx) {
  let mejor = null;
  for (const b of bookmakers || []) {
    const m = (b.markets || []).find(mk => mk.key === 'h2h');
    if (!m || !(m.outcomes || [])[idx]) continue;
    const o = m.outcomes[idx];
    if (o.price > 1 && (!mejor || o.price > mejor.precio)) mejor = { precio: o.precio, bookie: b.title };
  }
  return mejor;
}
function nivelConfianza(pMax, entrenamientos, cons) {
  if (entrenamientos >= 50 && cons && pMax >= 0.65) return 'Alta';
  if (entrenamientos >= 10 || (cons && pMax >= 0.58)) return 'Media';
  return 'Baja';
}
function prediccionPartido(partido, deporte) {
  const cons = consensoH2H(partido.bookmakers);
  const entrenamientos = estadoElo.entrenamientos[deporte] || 0;
  const wElo = Math.min(0.5, entrenamientos / 200);
  let pEloL, extras = {};
  if (deporte === 'basquet') {
    const eqL = equipoBasquet(partido.home_team);
    const eqV = equipoBasquet(partido.away_team);
    pEloL = probGanarBasquet(eqL.elo, eqV.elo);
    const [pl, pv] = puntosEsperadosBasquet(eqL, eqV);
    extras = {
      spread: { linea: Math.round((pl - pv) * 2) / 2, probLocalCubre: Math.round(probCubreSpread(pl - pv) * 100) },
      total: { linea: Math.round(pl + pv), overProb: 50 },
      elo: { local: Math.round(eqL.elo), visita: Math.round(eqV.elo) }
    };
  } else {
    const j1 = jugadorTenis(partido.home_team);
    const j2 = jugadorTenis(partido.away_team);
    pEloL = eloProbGanar(j1.eloGeneral - j2.eloGeneral);
    extras = { elo: { local: Math.round(j1.eloGeneral), visita: Math.round(j2.eloGeneral) } };
  }
  let pLocal = cons ? wElo * pEloL + (1 - wElo) * cons[0] : pEloL;
  pLocal = Math.min(0.97, Math.max(0.03, pLocal));
  const pVisita = 1 - pLocal;
  const modelo = {
    local: { probabilidad: Math.round(pLocal * 100), cuotaJusta: Math.round((1 / pLocal) * 100) / 100 },
    visita: { probabilidad: Math.round(pVisita * 100), cuotaJusta: Math.round((1 / pVisita) * 100) / 100 }
  };
  const valorL = mejorPrecioH2H(partido.bookmakers, 0);
  const valorV = mejorPrecioH2H(partido.bookmakers, 1);
  let valor = null;
  const cand = [];
  if (valorL) cand.push({ seleccion: 'local', nombre: partido.home_team, precio: valorL.precio, bookie: valorL.bookie, ev: valorL.precio * pLocal - 1 });
  if (valorV) cand.push({ seleccion: 'visita', nombre: partido.away_team, precio: valorV.precio, bookie: valorV.bookie, ev: valorV.precio * pVisita - 1 });
  if (cand.length) {
    cand.sort((a, b) => b.ev - a.ev);
    const mejor = cand[0];
    valor = { seleccion: mejor.seleccion, nombre: mejor.nombre, cuota: mejor.precio, bookie: mejor.bookie, ev: Math.round(mejor.ev * 100), esValor: mejor.ev >= 0.03 };
  }
  const pMax = Math.max(pLocal, pVisita);
  const confianza = nivelConfianza(pMax, entrenamientos, !!cons);
  if (deporte === 'tenis') {
    const sets = setsEstimadosTenis(pLocal);
    extras.sets = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, Math.round(v * 100)]));
  }
  return {
    id: partido.id, local: partido.home_team, visita: partido.away_team,
    fecha: partido.commence_time, liga: partido.sport_title, modelo, confianza, valor,
    extras, origen: cons ? 'elo+consenso' : 'elo'
  };
}

async function fetchJSON(url) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: control.signal });
    if (!resp.ok) throw new Error(`The Odds API respondió ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(temporizador);
  }
}

function cargarOddsVolley() {
  const host = process.env.RAPIDAPI_VOLLEY_HOST;
  if (!host) return null;
  const apiHost = host.startsWith('http') ? host : `https://${host}`;
  const ruta = process.env.RAPIDAPI_VOLLEY_PATH || '/matches/upcoming';
  return fetch(`${apiHost}${ruta}`, { headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY || '', 'x-rapidapi-host': host } })
    .then(async resp => {
      if (!resp.ok) throw new Error(`API de vóley respondió ${resp.status}`);
      const datos = await resp.json();
      const lista = Array.isArray(datos) ? datos : (datos.response || datos.data || datos.matches || []);
      return lista.map(m => ({
        id: String(m.id || m.fixture || m.match_id || Math.random()),
        home_team: m.home_team || m.home || m.local || (m.teams && (m.teams.home || m.teams.local)) || 'Local',
        away_team: m.away_team || m.away || m.visitante || m.visit || (m.teams && (m.teams.away || m.teams.visitante)) || 'Visita',
        commence_time: m.commence_time || m.date || m.fecha || m.start_date || new Date().toISOString(),
        sport_key: 'volleyball', sport_title: 'Vóley', bookmakers: m.bookmakers || []
      }));
    });
}

async function oddsVolleyPredictions() {
  const datos = await cargarOddsVolley();
  if (datos && datos.length) {
    return datos.map(p => ({ id: p.id, home_team: p.home_team, away_team: p.away_team, commence_time: p.commence_time, sport_key: p.sport_key, sport_title: p.sport_title, bookmakers: p.bookmakers || [] }));
  }
  return [{ id: 'voley-placeholder', home_team: 'Local', away_team: 'Visita', commence_time: new Date().toISOString(), sport_key: 'volleyball', sport_title: 'Vóley', bookmakers: [] }];
}

async function listarTorneosTenis(opciones = {}) {
  const cacheado = opciones.obtenerDeCache?.('odds-tenis-torneos', 6 * 60 * 60 * 1000);
  if (cacheado) return cacheado;
  const datos = await fetchJSON(`${THE_ODDS_BASE_URL}/sports/?apiKey=${THE_ODDS_API_KEY}`);
  const torneos = datos.filter(s => s.key && s.key.startsWith('tennis_') && s.active).map(s => s.key).slice(0, 4);
  opciones.guardarEnCache?.('odds-tenis-torneos', torneos);
  return torneos;
}

async function oddsTenisAgregadas(opciones = {}) {
  const cacheado = opciones.obtenerDeCache?.('odds-tenis-all', 15 * 60 * 1000);
  if (cacheado) return cacheado;
  const torneos = await listarTorneosTenis(opciones);
  const partidos = [];
  for (const t of torneos) {
    try {
      const datos = await fetchJSON(`${THE_ODDS_BASE_URL}/sports/${t}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=h2h`);
      partidos.push(...(datos || []));
      await entrenarEloDesdeScores(t, 'tenis');
    } catch (e) { /* continuar */ }
    await new Promise(r => setTimeout(r, 1050));
  }
  opciones.guardarEnCache?.('odds-tenis-all', partidos);
  return partidos;
}

async function oddsPorDeporte(sport, opciones = {}) {
  if (sport === 'volleyball' || sport === 'voley') return cargarOddsVolley();
  if (sport === 'tennis') return oddsTenisAgregadas(opciones);
  const claveCache = `odds-${sport}`;
  const cacheado = opciones.obtenerDeCache?.(claveCache, 15 * 60 * 1000);
  if (cacheado) return cacheado;
  const datos = await fetchJSON(`${THE_ODDS_BASE_URL}/sports/${sport}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals`);
  await entrenarEloDesdeScores(sport, 'basquet');
  opciones.guardarEnCache?.(claveCache, datos);
  return datos;
}

async function prediccionesPorDeporte(deporte, opciones = {}) {
  const claveCache = `predicciones-${deporte}`;
  const cacheado = opciones.obtenerDeCache?.(claveCache, 5 * 60 * 1000);
  if (cacheado) return { partidos: cacheado, generadoEn: null, entrenamientos: estadoElo.entrenamientos[deporte] || 0 };
  let partidos;
  if (deporte === 'tenis') partidos = await oddsTenisAgregadas(opciones);
  else if (deporte === 'voley') partidos = await oddsVolleyPredictions();
  else partidos = await oddsPorDeporte('basketball_nba', opciones);
  const predicciones = (partidos || []).map(p => {
    const pred = prediccionPartido(p, deporte);
    return pred;
  });
  const salida = { deporte: undefined, partidos: predicciones, generadoEn: new Date().toISOString(), partidosEntrenamiento: estadoElo.entrenamientos[deporte] || 0 };
  opciones.guardarEnCache?.(claveCache, salida);
  return salida;
}

const { MODEL_VERSION } = require('../../packages/domain/version');

function versionModelo() {
  return MODEL_VERSION;
}

module.exports = { oddsPorDeporte, prediccionesPorDeporte, cargarOddsVolley, oddsVolleyPredictions, listarTorneosTenis, oddsTenisAgregadas, oddsCatalogo, versionModelo };

async function oddsCatalogo(opciones = {}) {
  const claveCache = 'odds-sports';
  const cacheado = opciones.obtenerDeCache?.(claveCache, 24 * 60 * 60 * 1000);
  if (cacheado) return cacheado;
  const datos = await fetchJSON(`${THE_ODDS_BASE_URL}/sports/?apiKey=${THE_ODDS_API_KEY}`);
  opciones.guardarEnCache?.(claveCache, datos);
  return datos;
}
