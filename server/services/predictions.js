/**
 * predictions.js
 *
 * Servicio de pronósticos oficiales de Fulbito ( artefacto `pronosticos.json` ).
 * Propósito de Fase 4.2: `server/server.js` solo compone rutas; la lógica de
 * descarga/validación del artefacto queda en servicio de aplicación.
 *
 * Contrato:
 *   - `obtenerPronosticosOficiales({ obtenerDeCache, guardarEnCache, timeoutMs })`
 *       => Promise<{ datos, fuente: 'release' | 'cache' | 'local' }>
 *   - `leerPronosticosLocales()` => null | objeto
 *
 * Usa solo `fs`/`path`/`fetch`. No hay I/O de base de datos.
 */
const fs = require('fs');
const path = require('path');

const PRONOSTICOS_ARTIFACT_URL = process.env.FULBITO_ARTIFACT_URL
  || 'https://github.com/KkkxxxS/fulbito/releases/download/artifacts-daily/pronosticos.json';
const TTL_PRONOSTICOS_OFICIALES = 15 * 60 * 1000;

function leerPronosticosLocales() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'pronosticos.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

async function obtenerPronosticosOficiales(opciones = {}) {
  const {
    obtenerDeCache,
    guardarEnCache,
    timeoutMs = 12000
  } = opciones;

  const cacheKey = 'pronosticos-oficiales';
  if (obtenerDeCache) {
    const cacheado = obtenerDeCache(cacheKey, TTL_PRONOSTICOS_OFICIALES);
    if (cacheado) return { datos: cacheado, fuente: 'cache' };
  }

  try {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(PRONOSTICOS_ARTIFACT_URL, {
        headers: { Accept: 'application/json', 'User-Agent': 'Fulbito/1.0' },
        signal: control.signal
      });
    } finally {
      clearTimeout(temporizador);
    }
    if (!resp.ok) throw new Error(`el artefacto respondió ${resp.status}`);
    const datos = await resp.json();
    if (!datos || typeof datos !== 'object' || !datos.pronosticos) {
      throw new Error('el artefacto no tiene el formato esperado');
    }
    // Un artefacto de ejemplo nunca debe mostrarse como pronóstico oficial.
    if (datos.datosDeEjemplo === true) {
      throw new Error('el artefacto está marcado como datos de ejemplo');
    }
    if (guardarEnCache) guardarEnCache(cacheKey, datos);
    return { datos, fuente: 'release' };
  } catch (error) {
    console.warn('No se pudo descargar el artefacto oficial (se usa la copia local):', error.message);
  }

  const local = leerPronosticosLocales();
  if (local && local.pronosticos && local.datosDeEjemplo !== true) {
    if (guardarEnCache) guardarEnCache(cacheKey, local);
    return { datos: local, fuente: 'local' };
  }

  const error = new Error('No hay artefacto de pronósticos disponible.');
  error.status = 503;
  throw error;
}

module.exports = {
  obtenerPronosticosOficiales,
  leerPronosticosLocales
};
