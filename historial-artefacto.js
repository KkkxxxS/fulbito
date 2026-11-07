/**
 * historial-artefacto.js
 *
 * Convierte el artefacto diario de pronósticos (`pronosticos.json`) en las
 * entradas que se registran en el historial público. Es la única fuente de
 * verdad para esa conversión: la usan tanto `sync-historial.js` (workflow de
 * GitHub Actions) como `server/server.js` (sincronización automática).
 *
 * Reglas deliberadamente conservadoras para que el track record sea honesto:
 *   - Nunca registra artefactos marcados como `datosDeEjemplo`.
 *   - Solo registra partidos que todavía no han comenzado (sin look-ahead).
 *   - Solo acepta estados TIMED/SCHEDULED.
 *   - Una entrada por `partidoId`.
 */
const MARGEN_MS = 5 * 60 * 1000;

function construirEntradasDesdeArtefacto(artefacto, ahora = Date.now()) {
  if (!artefacto || artefacto.datosDeEjemplo === true) return [];

  const pronosticos = artefacto.pronosticos || {};
  const entradas = [];
  const vistos = new Set();

  for (const [id, item] of Object.entries(pronosticos)) {
    const partido = item && item.partido;
    const prediccion = item && item.pronosticos;
    if (!partido || !prediccion || !Array.isArray(prediccion.seleccionados)) continue;

    const partidoId = String(partido.id || id);
    if (vistos.has(partidoId)) continue;

    const fechaMs = Date.parse(partido.utcDate || '');
    if (!Number.isFinite(fechaMs) || fechaMs <= ahora - MARGEN_MS) continue;

    const estado = String(partido.status || '').toUpperCase();
    if (estado && !['TIMED', 'SCHEDULED'].includes(estado)) continue;

    const mercados = prediccion.seleccionados
      .filter(m => m && m.categoria)
      .map(m => ({
        categoria: String(m.categoria),
        parametros: m.parametros && typeof m.parametros === 'object' ? m.parametros : {},
        seleccion: m.seleccion || null,
        probabilidad: Number.isFinite(Number(m.probabilidad)) ? Number(m.probabilidad) : null
      }));
    if (mercados.length === 0) continue;

    vistos.add(partidoId);
    entradas.push({
      partidoId,
      local: (partido.homeTeam && partido.homeTeam.name) || '',
      visita: (partido.awayTeam && partido.awayTeam.name) || '',
      liga: (partido.competition && partido.competition.name) || '',
      fecha: partido.utcDate,
      mercados,
      verificado: false
    });
  }

  return entradas;
}

module.exports = { construirEntradasDesdeArtefacto, MARGEN_MS };
