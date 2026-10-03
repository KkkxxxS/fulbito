/**
 * Smoke test del motor de pronosticos del frontend (app-model.js).
 *
 * Ejecutar: npm run verify
 *
 * Carga el MISMO archivo que sirve el navegador en produccion y comprueba que el
 * motor corre y devuelve resultados con forma y rangos validos. Antes este
 * script solo imprimia el resultado y siempre salia con codigo 0: no podia
 * fallar aunque el motor estuviera roto.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODELO = path.join(__dirname, 'app-model.js');
const codigo = fs.readFileSync(MODELO, 'utf8');

const elementoFalso = () => ({
  style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  dataset: {},
  value: '',
  textContent: '',
  innerHTML: '',
  addEventListener() {},
  removeEventListener() {},
  appendChild() {},
  querySelector: () => elementoFalso(),
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
});

const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Number,
  Object,
  Array,
  String,
  Set,
  Map,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  document: {
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => elementoFalso(),
    createElement: () => elementoFalso(),
    body: elementoFalso(),
    documentElement: elementoFalso(),
    visibilityState: 'visible'
  },
  window: {},
  history: { replaceState() {} },
  location: { hash: '' },
  navigator: { language: 'es' },
  requestAnimationFrame: (cb) => cb(0),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval,
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox, { filename: MODELO });

let fallos = 0;
function check(nombre, condicion, detalle) {
  if (condicion) {
    console.log(`  [OK ] ${nombre}`);
  } else {
    console.log(`  [FALLA] ${nombre}${detalle ? ` — ${detalle}` : ''}`);
    fallos++;
  }
}

console.log('=== VERIFICACION DEL MOTOR (app-model.js) ===');

check('el motor expone generarPronosticos', typeof sandbox.generarPronosticos === 'function');
check(
  'el motor expone la matriz de marcadores',
  typeof sandbox.matrizMarcadores === 'function' || typeof sandbox.poisson === 'function'
);

if (typeof sandbox.generarPronosticos !== 'function') {
  console.log('\n=== RESULTADO: HAY FALLOS ===');
  process.exit(1);
}

const statsLocal = {
  local: { golesFavor: 1.6, golesContra: 1.1 },
  visita: { golesFavor: 1.1, golesContra: 1.4 },
  tendencia: { direccion: 'subiendo' },
  diasDescansoUltimoPartido: 7,
  partidosJugados: 12
};
const statsVisita = {
  local: { golesFavor: 1.2, golesContra: 1.4 },
  visita: { golesFavor: 1.0, golesContra: 1.3 },
  tendencia: { direccion: 'neutral' },
  diasDescansoUltimoPartido: 6,
  partidosJugados: 11
};
const tabla = {
  mapa: {
    1: { posicion: 1, puntosPorPartido: 2.3, totalEquipos: 20, partidosJugados: 12, golesFavorPorPartido: 1.7, golesContraPorPartido: 0.8 },
    2: { posicion: 2, puntosPorPartido: 2.1, totalEquipos: 20, partidosJugados: 12, golesFavorPorPartido: 1.5, golesContraPorPartido: 0.9 }
  },
  promedioLiga: 1.6,
  promedioLigaGolesFavor: 1.4,
  promedioLigaGolesContra: 1.2,
  contextoLocal: {},
  contextoVisita: {}
};

const correr = () =>
  sandbox.generarPronosticos(
    statsLocal, statsVisita, 'Local', 'Visita',
    { disponible: false }, tabla, 1, 2, 'PL'
  );

const res = correr();

check('devuelve mercados seleccionados', Array.isArray(res.seleccionados) && res.seleccionados.length > 0,
  `seleccionados=${JSON.stringify(res.seleccionados)}`);
check('devuelve un marcador probable con formato x-y',
  /^\d+-\d+$/.test(String(res.marcadorProbable)), `marcadorProbable=${res.marcadorProbable}`);
check('el marcador probable es unico',
  new Set(res.seleccionados.map((m) => m.categoria)).size === res.seleccionados.length);

const probs = res.seleccionados.map((m) => m.probabilidad);
check('todas las probabilidades son numeros finitos', probs.every((p) => typeof p === 'number' && Number.isFinite(p)),
  JSON.stringify(probs));
check('todas las probabilidades estan en el rango 1-100',
  probs.every((p) => p >= 1 && p <= 100), JSON.stringify(probs));
check('ninguna probabilidad esta pegada al techo del clamp (0.92 => 92)',
  probs.every((p) => p < 92), JSON.stringify(probs));
check('cada mercado trae al menos una razon',
  res.seleccionados.every((m) => Array.isArray(m.razones) && m.razones.length > 0),
  JSON.stringify(res.seleccionados.map((m) => m.razones)));
check('cada mercado trae parametros de calculo',
  res.seleccionados.every((m) => m.categoria && m.parametros && typeof m.seleccion === 'string'));
check('los parametros del modelo expone los lambdas',
  Number.isFinite(res.parametrosModelo.lambdaLocal) && Number.isFinite(res.parametrosModelo.lambdaVisita),
  JSON.stringify(res.parametrosModelo));

// Determinismo: mismos insumos => mismo resultado (sin Math.random en el motor).
const res2 = correr();
check('el motor es determinista',
  JSON.stringify(res.seleccionados) === JSON.stringify(res2.seleccionados));

console.log('\n  mercados:', res.seleccionados.map((m) => `${m.categoria}=${m.probabilidad}`).join(' '));
console.log('  MARCADOR', res.marcadorProbable, res.probMarcador);

console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS'} ===`);
process.exit(fallos === 0 ? 0 : 1);