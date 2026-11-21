/**
 * evaluation.js
 *
 * Métricas de evaluación de pronósticos. Propósito de Fase 5: pasar de
 * métricas básicas (Brier binario) a métricas rigurosas y comparables
 * (Brier multiclase, LogLoss, curvas de calibración, backtesting).
 *
 * Contrato:
 *   - `calcularBrierMulticlase(muestras)` => number | null
 *   - `calcularLogLossMulticlase(muestras)` => number | null
 *   - `calcularBrierBinario(muestras)` => number | null
 *   - `calcularLogLossBinario(muestras)` => number | null
 *   - `curvaCalibracion(muestras, nBins)` => array de bandas
 *   - `backtestTemporalRollingOrigin(dataset, modeloFunc)` => resultados
 *   - `deteccionSesgo(muestras, segmentos)` => reporte
 *
 * No hay I/O. Usa solo matemáticas.
 */
function calcularBrierMulticlase(muestras) {
  if (!Array.isArray(muestras) || muestras.length === 0) return null;
  let suma = 0;
  let n = 0;
  for (const m of muestras) {
    const pred = m && m.pred && typeof m.pred === 'object' ? m.pred : {};
    const real = m.real;
    if (real == null || !Object.prototype.hasOwnProperty.call(pred, real)) continue;
    const clases = Object.keys(pred);
    let err = 0;
    for (const c of clases) {
      const y = c === real ? 1 : 0;
      err += Math.pow(Number(pred[c] || 0) - y, 2);
    }
    suma += err;
    n++;
  }
  return n === 0 ? null : suma / n;
}

function calcularLogLossMulticlase(muestras) {
  if (!Array.isArray(muestras) || muestras.length === 0) return null;
  let suma = 0;
  let n = 0;
  for (const m of muestras) {
    const pred = m && m.pred && typeof m.pred === 'object' ? m.pred : {};
    const real = m.real;
    if (real == null || !Object.prototype.hasOwnProperty.call(pred, real)) continue;
    const p = Math.max(Number(pred[real] || 0), 1e-12);
    suma += -Math.log(Math.min(p, 1 - 1e-12));
    n++;
  }
  return n === 0 ? null : suma / n;
}

function calcularBrierBinario(muestras) {
  if (!Array.isArray(muestras) || muestras.length === 0) return null;
  const suma = muestras.reduce((s, m) => s + Math.pow(Number(m.p) - Number(m.y), 2), 0);
  return suma / muestras.length;
}

function calcularLogLossBinario(muestras) {
  if (!Array.isArray(muestras) || muestras.length === 0) return null;
  let suma = 0;
  for (const m of muestras) {
    const p = Math.min(Math.max(Number(m.p) || 0, 1e-12), 1 - 1e-12);
    const y = m.y ? 1 : 0;
    suma += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return suma / muestras.length;
}

function curvaCalibracion(muestras, nBins = 10) {
  if (!Array.isArray(muestras) || muestras.length === 0) return [];
  const bandas = [];
  for (let i = 0; i < nBins; i++) {
    const lo = i / nBins;
    const hi = (i + 1) / nBins;
    const grupo = muestras.filter(m => Number(m.p) >= lo && Number(m.p) < hi);
    if (grupo.length === 0) continue;
    const n = grupo.length;
    const pPromedio = grupo.reduce((s, m) => s + Number(m.p), 0) / n;
    const tasaReal = grupo.reduce((s, m) => s + Number(m.y), 0) / n;
    const se = Math.sqrt(Math.max(pPromedio * (1 - pPromedio), 1e-9) / n);
    const desv = se > 0 ? (tasaReal - pPromedio) / se : 0;
    bandas.push({
      banda: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      n,
      pPromedio: Math.round(pPromedio * 10000) / 10000,
      tasaReal: Math.round(tasaReal * 10000) / 10000,
      sesgo: Math.round((tasaReal - pPromedio) * 10000) / 10000,
      desviacionStd: Math.round(desv * 100) / 100,
      significativo: Math.abs(desv) > 2
    });
  }
  return bandas;
}

function backtestTemporalRollingOrigin(dataset, modeloFunc, opciones = {}) {
  if (!Array.isArray(dataset) || dataset.length === 0) {
    return { trainSize: 0, valSize: 0, resultados: [] };
  }
  const orden = [...dataset].sort((a, b) => (Number(a.fecha) - Number(b.fecha)));
  const fraccionTrain = Number(opciones.fraccionTrain || 0.7);
  const corte = Math.max(1, Math.min(orden.length - 1, Math.floor(orden.length * fraccionTrain)));
  const train = orden.slice(0, corte);
  const val = orden.slice(corte);
  let resultados = [];
  if (val.length > 0 && typeof modeloFunc === 'function') {
    const modelo = modeloFunc(train);
    resultados = val.map((m, i) => ({
      ...m,
      pred: modelo.predict ? modelo.predict(m) : m.pred,
      index: i,
      orden: i
    }));
  }
  return { trainSize: train.length, valSize: val.length, resultados };
}

function deteccionSesgo(muestras, segmentos = []) {
  if (!Array.isArray(muestras) || muestras.length === 0) {
    return { brierGlobal: null, sesgos: [], n: 0 };
  }
  const brierGlobal = calcularBrierBinario(muestras);
  const sesgos = [];
  for (const seg of segmentos) {
    const grupo = muestras.filter(m => m.segmento === seg.key);
    sesgos.push({
      segmento: seg.key,
      n: grupo.length,
      brier: calcularBrierBinario(grupo),
      pctAgresiva: seg.pctAgresiva ?? null
    });
  }
  return { brierGlobal, sesgos, n: muestras.length };
}

function _brierBinario(resultados) {
  // Brier binario sobre valores ya predichos ({p, y}), sin usar calcularBrierBinario
  // para mantener una semántica clara: media de (p - y)^2.
  if (!Array.isArray(resultados) || resultados.length === 0) return null;
  const suma = resultados.reduce((s, m) => s + Math.pow(Number(m.p) - Number(m.y), 2), 0);
  return suma / resultados.length;
}

function _logLossBinario(resultados) {
  if (!Array.isArray(resultados) || resultados.length === 0) return null;
  let suma = 0;
  for (const m of resultados) {
    const p = Math.min(Math.max(Number(m.p) || 0, 1e-12), 1 - 1e-12);
    const y = m.y ? 1 : 0;
    suma += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return suma / resultados.length;
}

/**
 * Comparación OOS de modelos sobre el mismo split temporal (Fase 5.1).
 *
 * `modelos`: array de {nombre, version, fit(train) => {predict(muestra)}}.
 * Sin fechas válidas, el split 70/30 se aplica en orden de entrada.
 */
function compareModelos(muestras, modelos, opciones = {}) {
  if (!Array.isArray(muestras) || muestras.length === 0) {
    return { n: 0, trainN: 0, valN: 0, comparacion: [] };
  }
  if (!Array.isArray(modelos) || modelos.length < 2) {
    return { n: muestras.length, trainN: 0, valN: 0, comparacion: [] };
  }
  const orden = [...muestras].sort((a, b) => Number(a.fecha) - Number(b.fecha));
  const fraccionTrain = Number(opciones.fraccionTrain || 0.7);
  const corte = Math.max(1, Math.min(orden.length - 1, Math.floor(orden.length * fraccionTrain)));
  const train = orden.slice(0, corte);
  const val = orden.slice(corte);

  const comparacion = modelos
    .map((m, i) => {
      let brier = null;
      let logLoss = null;
      if (m && typeof m.fit === 'function') {
        try {
          const fit = m.fit(train) || {};
          if (typeof fit.predict === 'function') {
            const resultados = val.map(mm => ({ ...mm, p: fit.predict(mm) }));
            brier = _brierBinario(resultados);
            logLoss = _logLossBinario(resultados);
          }
        } catch (e) { /* modelo inválido: sin métricas */ }
      }
      return {
        modelo: m && m.nombre ? m.nombre : `modelo-${i}`,
        version: m && m.version ? m.version : null,
        brier,
        logLoss
      };
    })
    .filter(c => c.brier !== null)
    .sort((a, b) => (a.brier - b.brier) || (a.logLoss || Infinity) - (b.logLoss || Infinity));

  return { n: orden.length, trainN: train.length, valN: val.length, comparacion };
}

module.exports = {
  calcularBrierMulticlase,
  calcularLogLossMulticlase,
  calcularBrierBinario,
  calcularLogLossBinario,
  curvaCalibracion,
  backtestTemporalRollingOrigin,
  deteccionSesgo,
  compareModelos
};
