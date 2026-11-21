/**
 * evaluation-report.js — Agregado de métricas de evaluación (Fase 5.1).
 *
 * Devuelve un resumen ejecutivo de las métricas calculables en
 * services/evaluation.js: Brier/LogLoss globales, bandas de calibración y
 * desglose por `model_version` ligada a cada muestra.
 *
 * Contrato:
 *   - `reporteEvaluacion(muestras, opciones)` =>
 *       { fechaGenerado, n, brierGlobal, logLossGlobal, bandas, porVersion }
 */
const {
  curvaCalibracion,
  calcularBrierBinario,
  calcularLogLossBinario
} = require('./evaluation');

function reporteEvaluacion(muestras, opciones = {}) {
  if (!Array.isArray(muestras)) {
    return {
      fechaGenerado: new Date().toISOString(),
      n: 0,
      brierGlobal: null,
      logLossGlobal: null,
      bandas: [],
      porVersion: []
    };
  }

  const nBins = Number(opciones.nBins || 10);
  const bandas = curvaCalibracion(muestras, nBins);

  const porVersionMap = new Map();
  for (const m of muestras) {
    const version = m && m.model_version !== undefined && m.model_version !== null ? String(m.model_version) : 'sin-version';
    if (!porVersionMap.has(version)) {
      porVersionMap.set(version, { model_version: version, n: 0, s2: 0, s3: 0 });
    }
    const g = porVersionMap.get(version);
    g.n += 1;
    g.s2 += Math.pow(Number(m.p) - Number(m.y), 2);
    g.s3 += -Math.log(Math.max(Number(m.p), 1e-12));
  }

  const porVersion = [...porVersionMap.values()].map(g => ({
    model_version: g.model_version,
    n: g.n,
    brier: g.n > 0 ? g.s2 / g.n : null,
    logLoss: g.n > 0 ? g.s3 / g.n : null
  }));
  porVersion.sort((a, b) => b.n - a.n || a.model_version.localeCompare(b.model_version));

  return {
    fechaGenerado: new Date().toISOString(),
    n: muestras.length,
    brierGlobal: calcularBrierBinario(muestras),
    logLossGlobal: calcularLogLossBinario(muestras),
    bandas,
    porVersion
  };
}

module.exports = { reporteEvaluacion };
