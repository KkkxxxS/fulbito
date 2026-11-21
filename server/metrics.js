/**
 * metrics.js — Métricas de contadores y latencia (Fase 6.2).
 *
 * Contratos (sin I/O):
 *   - incuirRequest() / incuirError() / incuirCacheHit() / incuirProvider(nombre) / incuirLatencia(ms)
 *   - snapshot() => { totalRequests, totalErrors, cacheHits, providers, latenciaAvgMs, latenciaP95Ms }
 *   - resetMetricas()
 */

let totalRequests = 0;
let totalErrors = 0;
let cacheHits = 0;
const latencias = [];
const providers = new Map();

function incuirRequest() {
  totalRequests++;
}

function incuirError() {
  totalErrors++;
}

function incuirCacheHit() {
  cacheHits++;
}

function incuirProvider(nombre) {
  const key = String(nombre || 'desconocido');
  providers.set(key, (providers.get(key) || 0) + 1);
}

function incuirLatencia(ms) {
  if (Number.isFinite(ms) && ms >= 0) latencias.push(ms);
}

function resetMetricas() {
  totalRequests = 0;
  totalErrors = 0;
  cacheHits = 0;
  latencias.length = 0;
  providers.clear();
}

function snapshot() {
  const ord = [...latencias].sort((a, b) => a - b);
  const suma = ord.reduce((s, x) => s + x, 0);
  const p95index = Math.max(0, Math.ceil(ord.length * 0.95) - 1);
  return {
    totalRequests,
    totalErrors,
    cacheHits,
    providers: Object.fromEntries(providers.entries()),
    latenciaAvgMs: ord.length ? Math.round(suma / ord.length) : 0,
    latenciaP95Ms: ord.length ? ord[Math.min(p95index, ord.length - 1)] : 0
  };
}

module.exports = {
  incuirRequest,
  incuirError,
  incuirCacheHit,
  incuirProvider,
  incuirLatencia,
  resetMetricas,
  snapshot
};
