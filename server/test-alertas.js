/**
 * test-alertas.js — Pruebas del módulo de alertas (Fase 6.3).
 *
 * Ejecutar: npm run test:alertas
 */
let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) console.log(`  [OK ] ${nombre}`);
  else { fallos++; console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`); }
}

console.log('=== TEST DE ALERTAS (Fase 6.3) ===');

const { verificarAlertas, UMBRAL_ERROR_RATE, UMBRAL_LATENCIA_P95_MS, UMBRAL_POOL_ESPERANDO } = require('./alertas');

check('umbrales asignados', UMBRAL_ERROR_RATE === 0.15 && UMBRAL_LATENCIA_P95_MS === 3000 && UMBRAL_POOL_ESPERANDO === 100);

const ok = verificarAlertas({ totalRequests: 100, totalErrors: 5, latenciaP95Ms: 500, poolEsperando: 0 });
check('snapshot saludable sin alertas', ok.length === 0, JSON.stringify(ok));

const errRate = verificarAlertas({ totalRequests: 100, totalErrors: 20, latenciaP95Ms: 500 });
check('error rate >= 15% alerta', errRate.length === 1 && errRate[0].tipo === 'error_rate', JSON.stringify(errRate));

const lat = verificarAlertas({ totalRequests: 100, totalErrors: 0, latenciaP95Ms: 3100 });
check('latencia P95 >= 3000 alerta', lat.length === 1 && lat[0].tipo === 'latencia_p95', JSON.stringify(lat));

const pool = verificarAlertas({ totalRequests: 100, totalErrors: 0, latenciaP95Ms: 500, poolEsperando: 101 });
check('pool esperando >= 100 alerta', pool.length === 1 && pool[0].tipo === 'pool_esperando', JSON.stringify(pool));

const multi = verificarAlertas({ totalRequests: 100, totalErrors: 30, latenciaP95Ms: 3500, poolEsperando: 150 });
check('varios estados -> varias alertas', multi.length === 3, JSON.stringify(multi));

check('sin datos (totalRequests 0) sin alertas', verificarAlertas({}).length === 0);
check('snapshot undefined sin alertas', verificarAlertas(undefined).length === 0);

console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
process.exit(fallos === 0 ? 0 : 1);
