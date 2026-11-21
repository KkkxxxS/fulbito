/**
 * test-evaluation.js
 *
 * Pruebas del servicio de evaluación (Brier multiclase, LogLoss, curvas de
 * calibración, backtesting temporal, detección de sesgo).
 *
 * Ejecutar: npm run test:evaluation
 */
const assert = require('assert');
const {
  calcularBrierMulticlase,
  calcularLogLossMulticlase,
  calcularBrierBinario,
  calcularLogLossBinario,
  curvaCalibracion,
  backtestTemporalRollingOrigin,
  deteccionSesgo,
  compareModelos
} = require('./services/evaluation');

let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) {
    console.log(`  [OK ] ${nombre}`);
  } else {
    fallos++;
    console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`);
  }
}

console.log('=== TEST DE EVALUACIÓN (Fase 5) ===');

console.log('\n1. Brier multiclase (1X2)');
const muestrasMulti = [
  { real: 'local', pred: { local: 0.7, empate: 0.2, visita: 0.1 } },
  { real: 'empate', pred: { local: 0.1, empate: 0.8, visita: 0.1 } },
  { real: 'visita', pred: { local: 0.2, empate: 0.3, visita: 0.5 } }
];
const brierMulti = calcularBrierMulticlase(muestrasMulti);
check('brier multiclase correcto', Math.abs(brierMulti - ((0.7 - 1) ** 2 + 0.2 ** 2 + 0.1 ** 2 + 0.1 ** 2 + 0.04 + 0.01 + 0.2 ** 2 + 0.3 ** 2 + (0.5 - 1) ** 2) / 3) < 1e-9, JSON.stringify(brierMulti));
check('brier multiclase no null', brierMulti !== null);
check('brier multiclase vacío null', calcularBrierMulticlase([]) === null);

console.log('\n2. LogLoss multiclase');
const logLossMulti = calcularLogLossMulticlase(muestrasMulti);
check('logloss multiclase correcto', Math.abs(logLossMulti - (Math.log(0.7) + Math.log(0.8) + Math.log(0.5)) / -3) < 1e-9, JSON.stringify(logLossMulti));
check('logloss multiclase no null', logLossMulti !== null);

console.log('\n3. Brier binario');
const muestrasBin = [
  { p: 0.9, y: 1 },
  { p: 0.6, y: 0 },
  { p: 0.4, y: 0 }
];
check('brier binario correcto', Math.abs(calcularBrierBinario(muestrasBin) - ((0.9 - 1) ** 2 + 0.36 + 0.16) / 3) < 1e-9, JSON.stringify(calcularBrierBinario(muestrasBin)));
check('brier binario vacío null', calcularBrierBinario([]) === null);

console.log('\n4. LogLoss binario');
const logLossBin = calcularLogLossBinario(muestrasBin);
const esperadoBin = (Math.log(0.9) + Math.log(1 - 0.6) + Math.log(1 - 0.4)) / -3;
check('logloss binario correcto', Math.abs(logLossBin - esperadoBin) < 1e-9, JSON.stringify(logLossBin));
check('logloss binario no null', logLossBin !== null);

console.log('\n5. Curva de calibración');
const muestrasCal = Array.from({ length: 30 }, (_, i) => ({
  p: i < 10 ? 0.05 + (i * 0.085) : i < 20 ? 0.2 + ((i - 10) * 0.085) : 0.85 + ((i - 20) * 0.0085),
  y: i % 10 < 3 ? 1 : 0
}));
const bandas = curvaCalibracion(muestrasCal, 3);
check('curva de calibración no vacía', bandas.length > 0);
check('curva de calibración incluye n', bandas.every(b => Number.isFinite(b.n) && b.n > 0));
check('curva de calibración incluye pPromedio/tasaReal', bandas.every(b => 'pPromedio' in b && 'tasaReal' in b));
check('curva de calibración incluye desviaciónStd', bandas.every(b => 'desviacionStd' in b));
check('curva de calibración incluye significativo', bandas.every(b => typeof b.significativo === 'boolean'));

console.log('\n6. Backtest temporal rolling origin');
const dataset = Array.from({ length: 20 }, (_, i) => ({
  fecha: new Date(2026, 0, 1 + i).getTime(),
  p: 0.5,
  y: i % 2
}));
const modeloFunc = (train) => ({
  predict: () => 0.5
});
const backtest = backtestTemporalRollingOrigin(dataset, modeloFunc);
check('backtest existe', backtest.valSize === 6 && backtest.trainSize === 14, JSON.stringify({ train: backtest.trainSize, val: backtest.valSize }));
check('backtest tiene resultados', backtest.resultados.length === backtest.valSize);

console.log('\n7. Detección de sesgo');
const muestrasSesgo = [
  { p: 0.9, y: 1, segmento: 'alto' },
  { p: 0.8, y: 1, segmento: 'alto' },
  { p: 0.6, y: 0, segmento: 'bajo' },
  { p: 0.5, y: 0, segmento: 'bajo' }
];
const sesgo = deteccionSesgo(muestrasSesgo, [{ key: 'alto' }, { key: 'bajo' }]);
check('detección sesgo: n correcto', sesgo.n === 4);
check('detección sesgo: existen grupos', sesgo.sesgos.length === 2);
check('detección sesgo: un grupo tiene n > 0', sesgo.sesgos.some(s => s.n > 0));

console.log('\n8. Comparación OOS de modelos (Fase 5.1)');
const t = (i, dia) => new Date(2026, 0, 1, 12, 0, 0, 0).getTime() + i * dia * 86400000;
const muestrasCmp = Array.from({ length: 20 }, (_, i) => ({ fecha: t(i, 1), p: 0.5, y: i % 2 }));
const modeloBad = { nombre: 'baseline', version: 'v1', fit: () => ({ predict: () => 0.9 }) };
const modeloBuena = { nombre: 'mejorado', version: 'v2', fit: () => ({ predict: () => 0.3 }) };
const cmp = compareModelos(muestrasCmp, [modeloBad, modeloBuena]);
check('compareModelos: n y split correctos', cmp.n === 20 && cmp.trainN > 0 && cmp.valN > 0, JSON.stringify(cmp));
check('compareModelos: dos entradas', cmp.comparacion.length === 2);
check('compareModelos: primer lugar = mejor modelo', cmp.comparacion[0].modelo === 'mejorado', JSON.stringify(cmp.comparacion));
const brierMejor = calcularBrierBinario(muestrasCmp.map(m => ({ p: 0.3, y: m.y })));
check('compareModelos: brier correcto (p=0.3)', Math.abs(cmp.comparacion[0].brier - brierMejor) < 1e-9, JSON.stringify(cmp.comparacion[0].brier));
const modeloFallido = { nombre: 'broken', version: 'vX', fit: () => { throw new Error('boom'); } };
const cmpFallido = compareModelos(muestrasCmp, [modeloBad, modeloFallido]);
check('compareModelos: modelo fallido sin métricas (excluido)', cmpFallido.comparacion.length === 1 && cmpFallido.comparacion[0].modelo === 'baseline', JSON.stringify(cmpFallido.comparacion));
check('compareModelos: vacío', compareModelos([], [modeloBad, modeloBuena]).n === 0);
check('compareModelos: 1 modelo sin comparación', compareModelos(muestrasCmp, [modeloBad]).comparacion.length === 0);

console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
process.exit(fallos === 0 ? 0 : 1);
