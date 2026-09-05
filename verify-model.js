const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('app-model.js', 'utf8');
const sandbox = {
  console,
  Math,
  Date,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: async () => ({ json: async () => ({}) }),
  document: {
    querySelectorAll: () => [],
    getElementById: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      dataset: {},
      value: '',
      textContent: ''
    })
  },
  window: {},
  history: { replaceState() {} },
  setTimeout,
  clearTimeout,
  performance: { now: () => Date.now() },
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

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
const res = sandbox.generarPronosticos(statsLocal, statsVisita, 'Local', 'Visita', { disponible: false }, tabla, 1, 2, 'PL');
console.log(JSON.stringify(res.seleccionados.map(m => ({ categoria: m.categoria, prob: m.probabilidad })), null, 2));
console.log('MARCADOR', res.marcadorProbable, res.probMarcador);
