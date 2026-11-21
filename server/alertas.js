/**
 * alertas.js — Alertas automáticas de salud del servicio (Fase 6.3).
 *
 * Contratos (sin I/O):
 *   - verificarAlertas(snapshot) => array de { tipo, severidad, mensaje, valor }
 *       · error_rate >= 15%
 *       · latencia P95 >= 3000ms
 *       · pool esperando >= 100 (campo opcional `poolEsperando`)
 *   - iniciarAlertas({ intervaloMs, getSnapshot, onAlertas }) => setInterval activo
 */

const UMBRAL_ERROR_RATE = 0.15;
const UMBRAL_LATENCIA_P95_MS = 3000;
const UMBRAL_POOL_ESPERANDO = 100;

function _excede(snapshot) {
  const s = snapshot || {};
  const requests = Number(s.totalRequests) || 0;
  const errores = Number(s.totalErrors) || 0;
  return {
    errorRate: requests ? errores / requests : 0,
    latenciaP95Ms: Number(s.latenciaP95Ms) || 0,
    poolEsperando: Number(s.poolEsperando) || 0,
    totalRequests: requests
  };
}

function verificarAlertas(snapshot) {
  const d = _excede(snapshot);
  if (d.totalRequests === 0) return [];
  const alertas = [];
  if (d.errorRate >= UMBRAL_ERROR_RATE) {
    alertas.push({
      tipo: 'error_rate',
      severidad: 'alta',
      mensaje: `Error rate ${(d.errorRate * 100).toFixed(1)}% >= ${UMBRAL_ERROR_RATE * 100}%`,
      valor: Number((d.errorRate * 100).toFixed(1))
    });
  }
  if (d.latenciaP95Ms >= UMBRAL_LATENCIA_P95_MS) {
    alertas.push({
      tipo: 'latencia_p95',
      severidad: 'alta',
      mensaje: `Latencia P95 ${d.latenciaP95Ms}ms >= ${UMBRAL_LATENCIA_P95_MS}ms`,
      valor: d.latenciaP95Ms
    });
  }
  if (d.poolEsperando >= UMBRAL_POOL_ESPERANDO) {
    alertas.push({
      tipo: 'pool_esperando',
      severidad: 'media',
      mensaje: `Pool esperando ${d.poolEsperando} >= ${UMBRAL_POOL_ESPERANDO}`,
      valor: d.poolEsperando
    });
  }
  return alertas;
}

function iniciarAlertas(opciones = {}) {
  const intervaloMs = Number(opciones.intervaloMs || 60 * 1000);
  const getSnapshot = typeof opciones.getSnapshot === 'function' ? opciones.getSnapshot : () => ({});
  const onAlertas = typeof opciones.onAlertas === 'function' ? opciones.onAlertas : () => {};
  const verificar = () => {
    let alertas = [];
    try {
      alertas = verificarAlertas(getSnapshot());
    } catch (e) {
      return;
    }
    if (alertas.length > 0) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), alertas }));
      onAlertas(alertas);
    }
  };
  verificar();
  const id = setInterval(verificar, intervaloMs);
  if (id && typeof id.unref === 'function') id.unref();
  return id;
}

module.exports = { verificarAlertas, iniciarAlertas, UMBRAL_ERROR_RATE, UMBRAL_LATENCIA_P95_MS, UMBRAL_POOL_ESPERANDO };
