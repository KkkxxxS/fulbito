/**
 * test-evaluation-report.js
 *
 * Pruebas del agregado de métricas (Fase 5.1): reporteEvaluacion().
 *
 * Ejecutar: npm run test:evaluation-report
 */
const { reporteEvaluacion } = require('./services/evaluation-report');
const { calcularBrierBinario } = require('./services/evaluation');

let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) console.log(`  [OK ] ${nombre}`);
  else { fallos++; console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`); }
}

console.log('=== TEST DE REPORTE DE EVALUACIÓN (Fase 5.1) ===');

const muestras = [
  { p: 0.9, y: 1, model_version: 'v2' },
  { p: 0.8, y: 0, model_version: 'v2' },
  { p: 0.2, y: 1, model_version: 'v1' },
  { p: 0.6, y: 0, model_version: 'v1' }
];

const reporte = reporteEvaluacion(muestras, { nBins: 5 });
check('n = 4', reporte.n === 4, JSON.stringify(reporte.n));
check('brierGlobal correcto', Math.abs(reporte.brierGlobal - calcularBrierBinario(muestras)) < 1e-9);
check('porVersion 2 entradas', reporte.porVersion.length === 2, JSON.stringify(reporte.porVersion));
const v2 = reporte.porVersion.find(v => v.model_version === 'v2');
const v1 = reporte.porVersion.find(v => v.model_version === 'v1');
check('v2 tiene n=2 y brier', v2 && v2.n === 2 && v2.brier !== null);
check('v1 tiene n=2 y brier', v1 && v1.n === 2 && v1.brier !== null);
check('bandas incluyen n>0', reporte.bandas.length > 0 && reporte.bandas.every(b => b.n > 0));

const vacio = reporteEvaluacion([]);
check('vacío: n=0, brier null', vacio.n === 0 && vacio.brierGlobal === null);
check('vacío: porVersion []', Array.isArray(vacio.porVersion) && vacio.porVersion.length === 0);

console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
process.exit(fallos === 0 ? 0 : 1);
