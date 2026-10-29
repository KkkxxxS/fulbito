'use strict';

/**
 * Utilidades de seguridad para autenticación.
 *
 * Sin dependencias externas: el objetivo es endurecer el flujo de cuentas que
 * ya vive en server.js sin cambiar su contrato (tokens opacos + Postgres).
 */

const crypto = require('crypto');

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/**
 * Limitador de ventana fija por clave (IP, IP+usuario, etc.).
 * Devuelve una función `consumir(clave)` con el estado del cupo.
 */
function crearLimitador({ max = 10, ventanaMs = 15 * 60 * 1000, ahora = () => Date.now() } = {}) {
  const limite = Number(max);
  const ventana = Number(ventanaMs);
  if (!Number.isInteger(limite) || limite < 1) throw new Error('max inválido');
  if (!Number.isFinite(ventana) || ventana < 1000) throw new Error('ventanaMs inválida');

  const cubos = new Map();
  let ultimaLimpieza = 0;

  function limpiar(ahora) {
    // La limpieza es oportunista: evita que el Map crezca sin límite en un
    // proceso de larga vida (Render) sin recorrerlo en cada request.
    if (ahora - ultimaLimpieza < ventana) return;
    ultimaLimpieza = ahora;
    for (const [clave, cubo] of cubos) {
      if (ahora - cubo.inicio >= ventana) cubos.delete(clave);
    }
  }

  function consumir(clave) {
    const t = ahora();
    limpiar(t);
    const k = String(clave || 'desconocida');

    const cubo = cubos.get(k);
    if (!cubo || t - cubo.inicio >= ventana) {
      const nuevo = { inicio: t, cuenta: 1 };
      cubos.set(k, nuevo);
      return {
        permitido: true,
        restantes: limite - 1,
        limite,
        reinicio: nuevo.inicio + ventana,
        retryAfterSegundos: 0
      };
    }

    cubo.cuenta += 1;
    if (cubo.cuenta > limite) {
      return {
        permitido: false,
        restantes: 0,
        limite,
        reinicio: cubo.inicio + ventana,
        retryAfterSegundos: Math.max(1, Math.ceil((cubo.inicio + ventana - t) / 1000))
      };
    }

    return {
      permitido: true,
      restantes: limite - cubo.cuenta,
      limite,
      reinicio: cubo.inicio + ventana,
      retryAfterSegundos: 0
    };
  }

  consumir.reiniciar = () => cubos.clear();
  consumir.tamano = () => cubos.size;
  return consumir;
}

/** Comparación de strings en tiempo constante (evita filtrar el hash por timing). */
function compararSeguro(a, b) {
  if (a == null || b == null) return false;
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** IP del cliente: req.ip ya respeta `trust proxy`; XFF solo como fallback. */
function ipDe(req) {
  const directa = (req && (req.ip || (req.socket && req.socket.remoteAddress))) || '';
  if (directa) return String(directa).replace(/^::ffff:/, '');
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim().replace(/^::ffff:/, '');
  }
  return 'desconocida';
}

/** Devuelve un mensaje de error o null si la contraseña cumple la política. */
function validarPassword(password) {
  const p = String(password == null ? '' : password);
  if (p.length < PASSWORD_MIN) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  }
  if (p.length > PASSWORD_MAX) {
    return `La contraseña no puede superar ${PASSWORD_MAX} caracteres.`;
  }
  return null;
}

/** Cabeceras para respuestas de autenticación: nunca cachear tokens. */
function aplicarNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Middleware de límite de intentos. La clave puede incluir el usuario para
 * que un atacante no bloquee a toda una IP compartida (NAT) con una sola
 * cuenta, ni fuerce cuentas distintas desde la misma IP sin límite global.
 */
function limitarAuth(limitador, { incluirUsuario = false } = {}) {
  return function (req, res, next) {
    const ip = ipDe(req);
    const usuario = String((req.body && req.body.usuario) || '').trim().toLowerCase();
    const clave = incluirUsuario && usuario ? `${ip}|${usuario}` : ip;
    const estado = limitador(clave);

    res.setHeader('X-RateLimit-Limit', String(estado.limite));
    res.setHeader('X-RateLimit-Remaining', String(estado.restantes));
    if (!estado.permitido) {
      res.setHeader('Retry-After', String(estado.retryAfterSegundos));
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.'
      });
    }
    return next();
  };
}

module.exports = {
  PASSWORD_MIN,
  PASSWORD_MAX,
  crearLimitador,
  compararSeguro,
  ipDe,
  validarPassword,
  aplicarNoCache,
  limitarAuth
};
