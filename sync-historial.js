/**
 * sync-historial.js
 *
 * Toma `pronosticos.json` (artefacto diario que genera `pronosticos.py`) y
 * registra los partidos futuros en el historial público del backend mediante
 * `POST /api/historial/ingest`.
 *
 * El endpoint es idempotente: solo inserta partidoId que aún no existen y
 * nunca reemplaza un pronóstico ya sellado/liquidado. Por eso se puede correr
 * todos los días sin duplicar ni reescribir el track record.
 *
 * Uso:
 *   FULBITO_BACKEND_URL=https://fulbito-forh.onrender.com \
 *   HISTORIAL_API_KEY=... node sync-historial.js
 *
 * Sin esas variables el script termina con código 0 (se omite el registro),
 * para que el workflow diario no falle en forks o entornos sin secretos.
 */
const fs = require('fs');
const path = require('path');
const { construirEntradasDesdeArtefacto } = require('./historial-artefacto');

const BACKEND_URL = String(process.env.FULBITO_BACKEND_URL || process.env.BACKEND_URL || '')
  .replace(/\/+$/, '');
const API_KEY = String(process.env.HISTORIAL_API_KEY || '');
// Permite pasar otro artefacto como primer argumento (tests o corridas manuales).
const ARCHIVO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'pronosticos.json');
const TAMANO_LOTE = 200;

function log(...args) {
  console.log('[sync-historial]', ...args);
}

async function enviarLote(lote) {
  const resp = await fetch(`${BACKEND_URL}/api/historial/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY
    },
    body: JSON.stringify({ historial: lote })
  });

  const texto = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${texto.slice(0, 300)}`);
  }
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw new Error(`respuesta no JSON: ${texto.slice(0, 300)}`);
  }
}

async function main() {
  if (!BACKEND_URL || !API_KEY) {
    log('Faltan FULBITO_BACKEND_URL o HISTORIAL_API_KEY: se omite el registro.');
    return;
  }

  const artefacto = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  if (artefacto.datosDeEjemplo) {
    log('El artefacto está marcado como datos de ejemplo: no se registra en el historial público.');
    return;
  }
  const entradas = construirEntradasDesdeArtefacto(artefacto);
  if (entradas.length === 0) {
    log(`No hay partidos futuros en el artefacto (${artefacto.generadoEn || 'sin fecha'}).`);
    return;
  }

  let insertados = 0;
  let omitidos = 0;
  let total = 0;

  for (let i = 0; i < entradas.length; i += TAMANO_LOTE) {
    const lote = entradas.slice(i, i + TAMANO_LOTE);
    const datos = await enviarLote(lote);
    insertados += Number(datos.insertados) || 0;
    omitidos += Number(datos.omitidos) || 0;
    total = Number(datos.total) || total;
    log(`lote ${Math.floor(i / TAMANO_LOTE) + 1}: +${datos.insertados || 0} nuevos, ${datos.omitidos || 0} ya existentes`);
  }

  log(`Listo: ${insertados} insertados, ${omitidos} omitidos, ${total} en el historial público (artefacto ${artefacto.generadoEn || 'sin fecha'}).`);
}

main().catch((error) => {
  console.error('[sync-historial] Error:', error.message);
  process.exit(1);
});
