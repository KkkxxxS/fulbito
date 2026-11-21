/**
 * recovery.js — Recuperación de contraseña y restablecimiento (Fase 9).
 *
 * Contrato:
 *   - crearTokenRecuperacion(email) => { ok, token?, motivo? }
 *   - validarToken(token) => { ok, email?, id?, motivo? }
 *   - consumirToken(token) => { ok }
 *   - restablecerContrasena(email, password) => { ok, usuario?, usuarioId?, motivo? }
 *
 * Notas:
 *   - Tokens: 256-bit aleatorios, hashes SHA-256 en DB (nunca raw tokens).
 *   - La DB es opcional: sin DATABASE_URL devuelve motivo `db_no_disponible`.
 */
const crypto = require('crypto');
const db = require('../db');
const { hashPassword } = require('./auth');
const { repoUsuarioPorNombre, repoCambiarContrasena } = require('../repositories');

const DIAS_EXPIRACION = 1;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function crearTokenRecuperacion(email) {
  const normalizado = String(email || '').trim().toLowerCase();
  if (!normalizado) return { ok: false, motivo: 'email_requerido' };
  if (!db.disponible()) return { ok: false, motivo: 'db_no_disponible' };
  const token = generarToken();
  const expira = new Date(Date.now() + DIAS_EXPIRACION * 24 * 3600 * 1000).toISOString();
  await db.query(
    `INSERT INTO password_reset_tokens (email, token_hash, expira)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       token_hash = EXCLUDED.token_hash,
       expira = EXCLUDED.expira,
       usado = false`,
    [normalizado, hashToken(token), expira]);
  return { ok: true, token };
}

async function validarToken(token) {
  if (!db.disponible()) return { ok: false, motivo: 'db_no_disponible' };
  const hash = hashToken(token);
  const { rows } = await db.query(
    'SELECT id, email, expira, usado FROM password_reset_tokens WHERE token_hash = $1',
    [hash]);
  if (!rows.length) return { ok: false, motivo: 'token_invalido' };
  const f = rows[0];
  if (f.usado) return { ok: false, motivo: 'token_usado' };
  if (new Date(f.expira) < new Date()) return { ok: false, motivo: 'token_expirado' };
  return { ok: true, email: f.email, id: f.id };
}

async function consumirToken(token) {
  if (!db.disponible()) return { ok: false, motivo: 'db_no_disponible' };
  const hash = hashToken(token);
  await db.query('UPDATE password_reset_tokens SET usado = true WHERE token_hash = $1', [hash]);
  return { ok: true };
}

async function restablecerContrasena(email, password) {
  const normalizado = String(email || '').trim().toLowerCase();
  const pwd = String(password || '');
  if (!db.disponible()) return { ok: false, motivo: 'db_no_disponible' };
  if (!normalizado || pwd.length < 8) return { ok: false, motivo: 'datos_invalidos' };
  const registro = await repoUsuarioPorNombre(normalizado);
  if (!registro) return { ok: false, motivo: 'usuario_no_encontrado' };
  const cambio = await repoCambiarContrasena(registro.id, hashPassword(pwd, registro.salt));
  if (!cambio) return { ok: false, motivo: 'error_db' };
  return { ok: true, usuario: registro.usuario, usuarioId: registro.id };
}

module.exports = {
  crearTokenRecuperacion,
  validarToken,
  consumirToken,
  restablecerContrasena,
  hashToken,
  generarToken
};
