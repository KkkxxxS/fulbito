/**
 * audit.js — Auditoría de decisiones (Fase 9).
 *
 * Registro en PostgreSQL de decisiones hechas por personas: aprobaciones de
 * propuestas (gobernanza), eventos de autenticación (login, restablecer).
 *
 * El registro es inmutable (solo INSERT; sin UPDATE/DELETE).
 *
 * Contratos (sin I/O fuera de DB):
 *   - hashStable(objeto) => sha256 hex de JSON con claves ordenadas
 *   - registrarAprobacion(accion, actor, descripcion?, ip?) => { ok, id?, hash } | null
 *   - listarAuditoria(limite = 50) => Array<{ id, accion, actor, descripcion, ip, hash, creado }>
 */
const crypto = require('crypto');
const db = require('../db');

function hashStable(objeto) {
  const texto = JSON.stringify(objeto, Object.keys(objeto).sort());
  return crypto.createHash('sha256').update(texto).digest('hex');
}

async function registrarAprobacion(accion, actor, descripcion = null, ip = null) {
  if (!db.disponible()) return null;
  const input = {
    accion: String(accion || ''),
    actor: String(actor || ''),
    descripcion: descripcion ? String(descripcion) : '',
    ip: ip ? String(ip) : ''
  };
  const hash = hashStable(input);
  try {
    const r = await db.query(
      'INSERT INTO auditoria_aprobaciones (accion, actor, descripcion, ip, hash, hash_input) ' +
      'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [input.accion, input.actor, input.descripcion, input.ip, hash, JSON.stringify(input)]);
    return { ok: true, id: r.rows && r.rows[0] ? r.rows[0].id : r.rowCount, hash };
  } catch (e) {
    console.error('audit: insert falló:', e.message);
    return null;
  }
}

async function listarAuditoria(limite = 50) {
  if (!db.disponible()) return [];
  const n = Math.min(Math.max(Number(limite) || 50, 1), 500);
  const r = await db.query(
    'SELECT id, accion, actor, descripcion, ip, hash, creado FROM auditoria_aprobaciones ' +
    'ORDER BY creado DESC LIMIT $1',
    [n]);
  return r.rows;
}

module.exports = { registrarAprobacion, listarAuditoria, hashStable };
