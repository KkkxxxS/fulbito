/**
 * auth.js
 *
 * Servicio de autenticación y sesiones para Fulbito.
 * Propósito de Fase 4: `server/server.js` solo compone rutas; validación y
 * lógica de login/register/resolveSession quedan en servicios de aplicación.
 *
 * Contrato:
 *   - `registrarUsuario(input)` => `{ status, ok, error, message, usuario, token }`
 *   - `ingresarUsuario(input)`  => `{ status, ok, error, message, usuario, token }`
 *   - `obtenerSesion(req)`      => `{ usuarioId, usuario, expira } | null`
 *   - `revocarSesionToken(token)` => Promise<void>
 *   - `revocarSesionesUsuario(userId)` => Promise<void>
 *
 * Usa `server/repositories.js`; no hay SQL directo.
 */
const crypto = require('crypto');
const {
  repoUsuarioPorNombre,
  repoCrearUsuarioYSesion,
  repoCrearSesion,
  repoRevocarSesionesUsuario,
  repoRevocarSesionPorTokenHash,
  repoLimpiarSesionesExpiradas,
  repoSesionPorTokenHash
} = require('../repositories');
const { compararSeguro, validarPassword } = require('../seguridad');

const SAL_LONGITUD = 16;
const PROLONGACION_SESION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const USUARIO_RE = /^[a-z0-9_.-]{3,32}$/;
const RESERVA_NOMBRES = new Set(['system', 'admin', 'root', 'fulbito', 'api']);

function normalizarUsuario(u) { return String(u || '').trim().toLowerCase(); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function hashPassword(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function tokenAleatorio() { return crypto.randomBytes(32).toString('hex'); }

async function registrarUsuario(input) {
  const usuario = normalizarUsuario(input && input.usuario);
  const password = String(input && input.password || '');
  if (!USUARIO_RE.test(usuario)) {
    return { status: 400, error: 'bad_usuario', message: 'El usuario debe tener 3-32 caracteres: letras, números, _ . - .' };
  }
  if (RESERVA_NOMBRES.has(usuario)) {
    return { status: 400, error: 'usuario_reservado', message: 'Nombre no disponible.' };
  }
  const errorPassword = validarPassword(password);
  if (errorPassword) return { status: 400, error: 'bad_password', message: errorPassword };

  try {
    await repoLimpiarSesionesExpiradas();
    const existente = await repoUsuarioPorNombre(usuario);
    if (existente && existente.id) {
      return { status: 409, error: 'ya_existe', message: 'Ese usuario ya está registrado. Iniciá sesión en su lugar.' };
    }

    const salt = crypto.randomBytes(SAL_LONGITUD).toString('hex');
    const hash = hashPassword(password, salt);
    const token = tokenAleatorio();
    const ht = hashToken(token);
    const expira = new Date(Date.now() + PROLONGACION_SESION_MS).toISOString();

    const created = await repoCrearUsuarioYSesion(usuario, hash, salt, ht, expira);
    return { ok: true, usuario: created.usuario || usuario, token };
  } catch (e) {
    if (e && e.code === '23505') {
      return { status: 409, error: 'ya_existe', message: 'Ese usuario ya está registrado. Iniciá sesión en su lugar.' };
    }
    throw e;
  }
}

async function ingresarUsuario(input) {
  const usuario = normalizarUsuario(input && input.usuario);
  const password = String(input && input.password || '');
  if (!usuario || !password) {
    return { status: 400, error: 'bad_request', message: 'Faltan usuario y contraseña.' };
  }
  if (password.length > 128) {
    return { status: 401, error: 'invalid_credentials', message: 'Credenciales incorrectas.' };
  }

  try {
    const registro = await repoUsuarioPorNombre(usuario);
    if (!registro) {
      // Mismo coste de scrypt que un usuario real para no filtrar existencia
      // de cuentas por diferencias de tiempo.
      crypto.scryptSync(password, 'fulbito-dummy-salt', 64);
      return { status: 401, error: 'invalid_credentials', message: 'Credenciales incorrectas.' };
    }

    const hash = hashPassword(password, registro.salt);
    if (!compararSeguro(hash, registro.password_hash)) {
      return { status: 401, error: 'invalid_credentials', message: 'Credenciales incorrectas.' };
    }

    await repoLimpiarSesionesExpiradas();
    const token = tokenAleatorio();
    const ht = hashToken(token);
    const expira = new Date(Date.now() + PROLONGACION_SESION_MS).toISOString();
    await repoCrearSesion(ht, registro.id, expira);
    return { ok: true, usuario, token };
  } catch (e) {
    throw e;
  }
}

async function obtenerSesion(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const token = m[1].trim();
  const ht = hashToken(token);
  try {
    const ses = await repoSesionPorTokenHash(ht);
    if (!ses || !ses.expira || new Date(ses.expira).getTime() < Date.now()) {
      if (ses) await repoRevocarSesionPorTokenHash(ht);
      return null;
    }
    return { usuarioId: ses.usuario_id, usuario: ses.username, expira: ses.expira };
  } catch (e) {
    console.error('Error obteniendo sesión:', e);
    return null;
  }
}

async function revocarSesionToken(token) {
  await repoRevocarSesionPorTokenHash(hashToken(token));
}

async function revocarSesionesUsuario(usuarioId) {
  await repoRevocarSesionesUsuario(usuarioId);
}

module.exports = {
  registrarUsuario,
  ingresarUsuario,
  obtenerSesion,
  revocarSesionToken,
  revocarSesionesUsuario,
  hashPassword,
  tokenAleatorio,
  hashToken
};
