/**
 * test-metrics.js — Pruebas del módulo de métricas (Fase 6.2).
 *
 * Ejecutar: npm run test:metrics
 */
let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) console.log(`  [OK ] ${nombre}`);
  else { fallos++; console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`); }
}

console.log('=== TEST DE MÉTRICAS (Fase 6.2) ===');

const metrics = require('./metrics');

metrics.resetMetricas();
check('snapshot inicial', metrics.snapshot().totalRequests === 0 && metrics.snapshot().totalErrors === 0);

metrics.incuirRequest();
metrics.incuirRequest();
metrics.incuirError();
check('totalRequests = 2', metrics.snapshot().totalRequests === 2);
check('totalErrors = 1', metrics.snapshot().totalErrors === 1);

metrics.incuirCacheHit();
metrics.incuirProvider('football-data');
metrics.incuirProvider('the-odds-api');
const snap = metrics.snapshot();
check('cacheHits = 1', snap.cacheHits === 1);
check('providers', JSON.stringify(snap.providers) === JSON.stringify({ 'football-data': 1, 'the-odds-api': 1 }));

metrics.incuirLatencia(10);
metrics.incuirLatencia(20);
metrics.incuirLatencia(30);
const snap2 = metrics.snapshot();
check('latenciaAvgMs = 20', snap2.latenciaAvgMs === 20, JSON.stringify(snap2.latenciaAvgMs));
check('latenciaP95Ms >= 20', snap2.latenciaP95Ms >= 20);

metrics.resetMetricas();
const snap3 = metrics.snapshot();
check('resetMetricas', snap3.totalRequests === 0 && snap3.totalErrors === 0 && snap3.latenciaAvgMs === 0);

console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
process.exit(fallos === 0 ? 0 : 1);
