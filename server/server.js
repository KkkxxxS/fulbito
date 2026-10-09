const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const app = express();

// Carga de .env (raíz del repo primero, luego server/) para desarrollo local.
// En producción (Render/Heroku) se usan las env vars del dashboard.
// dotenv es opcional en deploys mínimos (rootDir/server sin dependencias propias).
try {
  require('dotenv').config({
    path: [path.join(__dirname, '..', '.env'), path.join(__dirname, '.env')],
    quiet: true
  });
} catch (e) { /* dotenv no instalado: ignora y usa process.env */ }

const ORIGENES_PERMITIDOS = new Set([
  'https://kkkxxxs.github.io',
  'https://fulbito-flame.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'null'
]);

// Compresión gzip para todas las respuestas (mejora ~70% el tamaño transferido)
app.use(compression());

// Cabeceras de seguridad y caché
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ORIGENES_PERMITIDOS.has(origin) || origin === 'null') return callback(null, true);
    return callback(new Error('Origen no permitido'));
  }
}));

// La API key se lee de la variable de entorno FOOTBALL_DATA_API_KEY.
// Configúrala en Render -> tu servicio -> Environment. NO la commitees.
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE_URL = "https://api.football-data.org/v4";

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY;
const THE_ODDS_BASE_URL = "https://api.the-odds-api.com/v4";

if (!API_KEY) {
  console.warn("ADVERTENCIA: falta FOOTBALL_DATA_API_KEY. Configúrala en las variables de entorno del servicio.");
}

const HISTORIAL_API_KEY = process.env.HISTORIAL_API_KEY;
if (!HISTORIAL_API_KEY && process.env.NODE_ENV === 'production') { console.warn('ADVERTENCIA: falta HISTORIAL_API_KEY para escrituras de /api/historial'); }
function requireHistorialWriteKey(req, res, next){ const k=req.headers['x-api-key']; if(!k||k!==HISTORIAL_API_KEY) return res.status(401).json({error:'unauthorized',message:'X-Api-Key requerido para escrituras'}); next(); }

// ============ HISTORIAL COMPARTIDO GLOBAL (DB primero, archivo legacy) ============
// El filesystem de Render free es efímero (se pierde en cada redeploy/restart),
// así que la persistencia primaria va a una base de datos:
//   - Postgres gestionada si existe la env DATABASE_URL (recomendado en producción)
//   - SQLite local por defecto (server/data/historial.db)
// server/data/historial.json se mantiene como espejo legacy legible para humanos.
const HISTORIAL_PATH = path.join(__dirname, 'data', 'historial.json');

let storageHistorial = null;
let storageHistorialFallo = null;

function cargarStorageHistorial() {
  if (storageHistorial) return storageHistorial;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 5000,
      max: 3,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
    storageHistorial = {
      tipo: 'postgres',
      async inicializar() {
        await pool.query(
          "CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor JSONB NOT NULL)"
        );
      },
      async leer() {
        const r = await pool.query("SELECT valor FROM kv WHERE clave = 'historial'");
        return r.rows.length ? r.rows[0].valor : null;
      },
      async guardar(valor) {
        await pool.query(
          "INSERT INTO kv (clave, valor) VALUES ('historial', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",
          [JSON.stringify(valor)]
        );
      },
      async leerClave(clave) {
        const r = await pool.query("SELECT valor FROM kv WHERE clave = $1", [clave]);
        return r.rows.length ? r.rows[0].valor : null;
      },
      async guardarClave(clave, valor) {
        await pool.query(
          "INSERT INTO kv (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",
          [clave, JSON.stringify(valor)]
        );
      },
      async borrarClave(clave) {
        await pool.query("DELETE FROM kv WHERE clave = $1", [clave]);
      },
      cerrar: () => pool.end()
    };
  } else {
    const dir = path.dirname(HISTORIAL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'historial.db'));
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    storageHistorial = {
      tipo: 'sqlite',
      leer() {
        const fila = db.prepare("SELECT valor FROM kv WHERE clave = 'historial'").get();
        return fila ? JSON.parse(fila.valor) : null;
      },
      guardar(valor) {
        db.prepare(
          "INSERT INTO kv (clave, valor) VALUES ('historial', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor"
        ).run(JSON.stringify(valor));
      },
      leerClave(clave) {
        const fila = db.prepare("SELECT valor FROM kv WHERE clave = ?").get(clave);
        return fila ? JSON.parse(fila.valor) : null;
      },
      guardarClave(clave, valor) {
        db.prepare(
          "INSERT INTO kv (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor"
        ).run(clave, JSON.stringify(valor));
      },
      borrarClave(clave) {
        db.prepare("DELETE FROM kv WHERE clave = ?").run(clave);
      },
      cerrar: () => db.close()
    };
  }
  return storageHistorial;
}

async function kvLeer(clave) {
  try { return await cargarStorageHistorial().leerClave(clave); } catch (e) { return null; }
}
async function kvGuardar(clave, valor) {
  return cargarStorageHistorial().guardarClave(clave, valor);
}
async function kvBorrar(clave) {
  return cargarStorageHistorial().borrarClave(clave);
}

async function guardarHistorialEnStorage(historial) {
  try {
    const storage = cargarStorageHistorial();
    await storage.guardar(historial);
    storageHistorialFallo = null;
  } catch (error) {
    // Log una sola vez por fallo sostenido para no spamear, y seguimos con el archivo.
    if (!storageHistorialFallo) {
      storageHistorialFallo = error.message;
      console.warn(`No se pudo escribir el historial en ${storageHistorial ? storageHistorial.tipo : 'storage'} (queda el archivo legacy):`, error.message);
    }
  }
}

function asegurarHistorialGlobal() {
  const dir = path.dirname(HISTORIAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(HISTORIAL_PATH)) {
    fs.writeFileSync(HISTORIAL_PATH, JSON.stringify([], null, 2), 'utf8');
  }
}

let historialCacheMemoria = null;

function leerHistorialGlobal() {
  // El cache se llena en el boot desde la DB (inicializarHistorial) y se mantiene
  // al día en cada escritura. Si no arrancó todavía, cae al archivo legacy.
  if (historialCacheMemoria) return historialCacheMemoria;
  try {
    asegurarHistorialGlobal();
    const contenido = fs.readFileSync(HISTORIAL_PATH, 'utf8');
    const datos = JSON.parse(contenido);
    historialCacheMemoria = Array.isArray(datos) ? datos : [];
    return historialCacheMemoria;
  } catch (error) {
    return [];
  }
}

let escrituraPendiente = null;
function guardarHistorialGlobal(historial) {
  const recortado = Array.isArray(historial) ? historial.slice(-200) : [];
  historialCacheMemoria = recortado;
  // Debounce: si llegan varias escrituras seguidas, esperamos la última.
  if (escrituraPendiente) clearTimeout(escrituraPendiente);
  escrituraPendiente = setTimeout(async () => {
    await guardarHistorialEnStorage(recortado);
    asegurarHistorialGlobal();
    fs.promises.writeFile(HISTORIAL_PATH, JSON.stringify(recortado, null, 2), 'utf8')
      .catch(err => console.warn('No se pudo guardar el historial en archivo:', err.message));
    escrituraPendiente = null;
  }, 500);
  return recortado;
}

async function inicializarHistorial() {
  try {
    const storage = cargarStorageHistorial();
    if (storage.inicializar) await storage.inicializar();
    const previo = await storage.leer();
    if (Array.isArray(previo) && previo.length > 0) {
      historialCacheMemoria = previo.slice(-200);
      // Rehidrata el archivo legacy para que sirva de espejo legible.
      asegurarHistorialGlobal();
      fs.promises.writeFile(HISTORIAL_PATH, JSON.stringify(historialCacheMemoria, null, 2), 'utf8').catch(() => {});
    }
    console.log(`Historial cargado desde ${storage.tipo} (${(historialCacheMemoria || []).length} entradas).`);
  } catch (error) {
    storageHistorialFallo = error.message;
    console.warn('No se pudo inicializar el storage de historial (se usará el archivo legacy):', error.message);
  }
}

// ============ CACHE EN MEMORIA ============
// Evita golpear football-data.org (que tiene limite de requests/minuto) cada vez
// que un usuario distinto pide lo mismo. Se pierde al reiniciar el servidor, pero
// eso esta bien para este caso de uso.
const cache = new Map();
const MAX_CACHE_SIZE = 200; // Límite duro para evitar crecimiento ilimitado

function obtenerDeCache(clave, ttlMs) {
  const entrada = cache.get(clave);
  if (!entrada) return null;
  if (Date.now() - entrada.guardadoEn > ttlMs) {
    cache.delete(clave);
    return null;
  }
  return entrada.datos;
}

function guardarEnCache(clave, datos) {
  // LRU simple: si supera el máximo, eliminamos el más antiguo
  if (cache.size >= MAX_CACHE_SIZE) {
    const primeraClave = cache.keys().next().value;
    if (primeraClave !== undefined) cache.delete(primeraClave);
  }
  cache.set(clave, { datos, guardadoEn: Date.now() });
}

const TTL_PARTIDOS = 5 * 60 * 1000;      // 5 minutos: los partidos programados casi no cambian
const TTL_STATS_EQUIPO = 15 * 60 * 1000; // 15 minutos
const TTL_H2H = 60 * 60 * 1000;          // 1 hora: el historial directo cambia muy poco
const TTL_STANDINGS = 30 * 60 * 1000;    // 30 minutos
const COMPETICIONES_PERMITIDAS = new Set(['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'DED', 'ELC', 'BSA', 'PPL']);

const FETCH_TIMEOUT_MS = 12000;
const agenteHTTPS = require('https').Agent ? new (require('https').Agent)({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 30000
}) : undefined;

async function fetchFootballData(url, intentos = 2) {
  if (!API_KEY) {
    const error = new Error('La fuente de datos no está configurada.');
    error.status = 503;
    throw error;
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "X-Auth-Token": API_KEY, "Accept-Encoding": "gzip" },
      signal: controlador.signal,
      agent: agenteHTTPS
    });
  } catch (e) {
    // Reintento único ante errores de red transitorios
    if (intentos > 1 && (e.name === 'AbortError' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT')) {
      clearTimeout(temporizador);
      return fetchFootballData(url, intentos - 1);
    }
    throw e;
  } finally {
    clearTimeout(temporizador);
  }
}

function enviarErrorFuente(res, error, contexto) {
  console.error(`Error en ${contexto}:`, error.message);
  const status = error.status || (error.name === 'AbortError' ? 504 : 502);
  const mensaje = error.status === 503
    ? error.message
    : error.name === 'AbortError'
      ? 'La fuente de datos tardó demasiado en responder.'
      : 'No se pudo contactar a la fuente de datos.';
  return res.status(status).json({ error: true, mensaje });
}

// ============ RATE LIMITING SIMPLE ============
// Protege la cuota diaria/por-minuto de football-data.org de un uso abusivo
// (bots, loops accidentales del frontend, etc). Sin dependencias externas.
const VENTANA_MS = 60 * 1000;
const MAX_REQUESTS_POR_VENTANA = 60;
const contadorPorIP = new Map();

function limitarPeticiones(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'desconocida';
  const ahora = Date.now();
  const registro = contadorPorIP.get(ip);

  if (!registro || ahora - registro.inicioVentana > VENTANA_MS) {
    contadorPorIP.set(ip, { cuenta: 1, inicioVentana: ahora });
    return next();
  }

  if (registro.cuenta >= MAX_REQUESTS_POR_VENTANA) {
    res.setHeader('Retry-After', Math.ceil((registro.inicioVentana + VENTANA_MS - ahora) / 1000));
    return res.status(429).json({ error: "Demasiadas peticiones, intenta de nuevo en un momento." });
  }

  registro.cuenta++;
  next();
}

app.use(limitarPeticiones);

// Limpieza del mapa de rate limiting y de caché cada 5 minutos
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, registro] of contadorPorIP.entries()) {
    if (ahora - registro.inicioVentana > VENTANA_MS * 2) contadorPorIP.delete(ip);
  }
  // Limpieza del caché: borrar entradas vencidas para liberar memoria
  for (const [clave, entrada] of cache.entries()) {
    if (ahora - entrada.guardadoEn > 60 * 60 * 1000) cache.delete(clave);
  }
}, 5 * 60 * 1000);

// ============ RUTAS DE KEEP-ALIVE / SALUD ============
// Livianas a propósito: no llaman a football-data.org, así un cronjob de keep-alive
// (cron-job.org, UptimeRobot, etc) no gasta nada de la cuota diaria de la API externa.
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=10');
  res.json({ ok: true, servicio: "fulbito-backend", hora: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({ ok: true });
});

app.get('/api/historial', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=15');
  res.json({ ok: true, historial: leerHistorialGlobal() });
});
app.get('/api/historial/stats', (req,res)=>{ const h=leerHistorialGlobal(); const ver=h.filter(x=>x&&x.verificado).length; const ult=h.length>0?(h[h.length-1].fecha||h[h.length-1].timestamp||null):null; res.setHeader('Cache-Control','public, max-age=15'); res.json({ok:true,total:h.length,verificados:ver,ultimo:ult,actualizadoEn:new Date().toISOString()}); });

app.post('/api/historial', requireHistorialWriteKey, (req, res) => {
  const c=req.body||{}; const historial=Array.isArray(c.historial)?c.historial:[]; if(historial.length>500)return res.status(400).json({error:'payload_too_large',message:'Máximo 500 entradas'}); const guardado=guardarHistorialGlobal(historial); res.json({ok:true,historial:guardado,total:guardado.length});
});

app.put('/api/historial', requireHistorialWriteKey, (req, res) => {
  const c=req.body||{}; const historial=Array.isArray(c.historial)?c.historial:[]; if(historial.length>500)return res.status(400).json({error:'payload_too_large',message:'Máximo 500 entradas'}); const guardado=guardarHistorialGlobal(historial); res.json({ok:true,historial:guardado,total:guardado.length});
});

// ============ TELEMETRÍA DE ERRORES DEL CLIENTE ============
// Recibe reportes best-effort de errores no capturados del frontend. No persiste
// en DB (solo se registran en el log del servicio) y recorta todo para evitar abuso.
const REPORTES_CLIENTE_MAX = 200;
const reportesCliente = [];
app.post('/api/log', (req, res) => {
  const c = req.body || {};
  const recortar = (v, n) => String(v == null ? '' : v).slice(0, n);
  const registro = {
    mensaje: recortar(c.mensaje, 500),
    origen: recortar(c.origen, 50),
    url: recortar(c.url, 300),
    agente: recortar(c.agente, 300),
    en: new Date().toISOString()
  };
  reportesCliente.push(registro);
  if (reportesCliente.length > REPORTES_CLIENTE_MAX) reportesCliente.shift();
  console.warn('[cliente]', JSON.stringify(registro));
  res.status(202).json({ ok: true });
});

// Helper: responde con ETag para ahorrar ancho de banda cuando el cliente ya tiene la misma versión
const crypto = require('crypto');

// ============ AUTH LIGERA POR SESIÓN (sin dependencias externas) ============
// Usuarios persistentes en la misma kv-store, tokens opacos. El flujo anónimo
// localStorage sigue funcionando; esto es un complemento opcional que permite
// que el historial personal sobreviva al cambio de navegador/dispositivo.
const SAL_LONGITUD = 16;
const PROLONGACION_SESION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const USUARIO_RE = /^[a-z0-9_.-]{3,32}$/;
function claveUsuario(u) { return `usuario:${normalizarUsuario(u)}`; }
function claveSesion(hashToken) { return `sesion:${hashToken}`; }
function normalizarUsuario(u) { return String(u || '').trim().toLowerCase(); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function hashPassword(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function tokenAleatorio() { return crypto.randomBytes(32).toString('hex'); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

async function obtenerSesion(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const ht = hashToken(m[1].trim());
  const ses = await kvLeer(claveSesion(ht));
  if (!ses || !ses.expira || ses.expira < Date.now()) {
    if (ses) await kvBorrar(claveSesion(ht));
    return null;
  }
  return ses;
}
function requerirSesion(handler) {
  return async (req, res, next) => {
    try {
      const ses = await obtenerSesion(req);
      if (!ses) return res.status(401).json({ error: 'unauthorized', message: 'Sesión requerida (Bearer <token>)' });
      req.sesion = ses;
      return handler(req, res, next);
    } catch (e) { return res.status(500).json({ error: true, message: 'Error interno' }); }
  };
}

const RESERVA_NOMBRES = new Set(['system', 'admin', 'root', 'fulbito', 'api']);

app.post('/api/auth/register', async (req, res) => {
  const usuario = normalizarUsuario(req.body && req.body.usuario);
  const password = String(req.body && req.body.password || '');
  if (!USUARIO_RE.test(usuario)) return res.status(400).json({ error: 'bad_usuario', message: 'El usuario debe tener 3-32 caracteres: letras, números, _ . - .' });
  if (RESERVA_NOMBRES.has(usuario)) return res.status(400).json({ error: 'usuario_reservado', message: 'Nombre no disponible.' });
  if (password.length < 8) return res.status(400).json({ error: 'bad_password', message: 'La contraseña debe tener al menos 8 caracteres.' });
  const existente = await kvLeer(claveUsuario(usuario));
  if (existente) return res.status(409).json({ error: 'ya_existe', message: 'Ese usuario ya está registrado. Iniciá sesión en su lugar.' });
  const salt = crypto.randomBytes(SAL_LONGITUD).toString('hex');
  const hash = hashPassword(password, salt);
  const id = uuid();
  const registro = { id, usuario, salt, hash, creado: new Date().toISOString() };
  await kvGuardar(claveUsuario(usuario), registro);
  await kvGuardar(`usuario_id:${id}`, { usuario, id });
  const token = tokenAleatorio(); const ht = hashToken(token);
  await kvGuardar(claveSesion(ht), { usuarioId: id, usuario, expira: Date.now() + PROLONGACION_SESION_MS });
  res.json({ ok: true, usuario, token });
});
app.post('/api/auth/login', async (req, res) => {
  const usuario = normalizarUsuario(req.body && req.body.usuario);
  const password = String(req.body && req.body.password || '');
  if (!usuario || !password) return res.status(400).json({ error: 'bad_request', message: 'Faltan usuario y contraseña.' });
  const registro = await kvLeer(claveUsuario(usuario));
  if (!registro) return res.status(401).json({ error: 'invalid_credentials', message: 'Credenciales incorrectas.' });
  const hash = hashPassword(password, registro.salt);
  if (hash !== registro.hash) return res.status(401).json({ error: 'invalid_credentials', message: 'Credenciales incorrectas.' });
  const token = tokenAleatorio(); const ht = hashToken(token);
  await kvGuardar(claveSesion(ht), { usuarioId: registro.id, usuario: registro.usuario, expira: Date.now() + PROLONGACION_SESION_MS });
  res.json({ ok: true, usuario: registro.usuario, token });
});
app.post('/api/auth/logout', async (req, res) => {
  const auth = req.headers['authorization'] || ''; const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) await kvBorrar(claveSesion(hashToken(m[1].trim())));
  res.json({ ok: true });
});
app.get('/api/auth/me', async (req, res) => {
  const ses = await obtenerSesion(req);
  if (!ses) return res.status(401).json({ error: 'unauthorized', message: 'Sesión requerida' });
  res.json({ ok: true, usuario: ses.usuario, usuarioId: ses.usuarioId, expira: ses.expira });
});
function claveHistorialUsuario(usuarioId) { return `historial:${usuarioId}`; }
app.get('/api/mi-historial', requerirSesion(async (req, res) => {
  const historial = await kvLeer(claveHistorialUsuario(req.sesion.usuarioId));
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.json({ ok: true, historial: Array.isArray(historial) ? historial : [] });
}));
app.put('/api/mi-historial', requerirSesion(async (req, res) => {
  const historial = Array.isArray(req.body && req.body.historial) ? req.body.historial : [];
  if (historial.length > 500) return res.status(400).json({ error: 'payload_too_large', message: 'Máximo 500 entradas' });
  const usuarioHistorial = historial.slice(-500);
  await kvGuardar(claveHistorialUsuario(req.sesion.usuarioId), usuarioHistorial);
  res.json({ ok: true, historial: usuarioHistorial, total: usuarioHistorial.length });
}));

function generarETag(datos) {
  return crypto.createHash('md5').update(JSON.stringify(datos)).digest('hex').slice(0, 16);
}

function responderConCache(req, res, datos, maxAgeSegundos = 60) {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSegundos}`);
  const etag = `"${generarETag(datos)}"`;
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  res.setHeader('ETag', etag);
  res.json(datos);
}

// Endpoint: partidos por rango de fechas
app.get('/api/partidos', async (req, res) => {
  const { dateFrom, dateTo, competitions } = req.query;

  if (!dateFrom || !dateTo || !competitions) {
    return res.status(400).json({ error: true, mensaje: "Faltan parámetros: dateFrom, dateTo y competitions son requeridos." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return res.status(400).json({ error: true, mensaje: "Las fechas deben tener formato YYYY-MM-DD." });
  }
  const codigos = competitions.split(',').map(c => c.trim()).filter(Boolean);
  if (codigos.length === 0 || codigos.some(c => !COMPETICIONES_PERMITIDAS.has(c))) {
    return res.status(400).json({ error: true, mensaje: "La competición solicitada no está disponible." });
  }

  const claveCache = `partidos-${competitions}-${dateFrom}-${dateTo}`;
  const cacheado = obtenerDeCache(claveCache, TTL_PARTIDOS);
  if (cacheado) return responderConCache(req, res, cacheado, 300);

  try {
    const url = `${BASE_URL}/matches?competitions=${competitions}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    responderConCache(req, res, datos, 300);
  } catch (e) {
    enviarErrorFuente(res, e, '/api/partidos');
  }
});

// Endpoint: estadisticas (ultimos partidos) de un equipo
app.get('/api/equipo/:id/stats', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: true, mensaje: "El identificador del equipo no es válido." });
  }
  const claveCache = `stats-${req.params.id}`;
  const cacheado = obtenerDeCache(claveCache, TTL_STATS_EQUIPO);
  if (cacheado) return responderConCache(req, res, cacheado, 900);

  try {
    const url = `${BASE_URL}/teams/${req.params.id}/matches?status=FINISHED&limit=18`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    responderConCache(req, res, datos, 900);
  } catch (e) {
    enviarErrorFuente(res, e, '/api/equipo/:id/stats');
  }
});

// Endpoint: historial de enfrentamientos directos (head-to-head)
app.get('/api/partido/:id/h2h', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: true, mensaje: "El identificador del partido no es válido." });
  }
  const claveCache = `h2h-${req.params.id}`;
  const cacheado = obtenerDeCache(claveCache, TTL_H2H);
  if (cacheado) return responderConCache(req, res, cacheado, 3600);

  try {
    const url = `${BASE_URL}/matches/${req.params.id}/head2head?limit=10`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    responderConCache(req, res, datos, 3600);
  } catch (e) {
    enviarErrorFuente(res, e, '/api/partido/:id/h2h');
  }
});

// Endpoint: tabla de posiciones de una liga
app.get('/api/liga/:code/standings', async (req, res) => {
  if (!COMPETICIONES_PERMITIDAS.has(req.params.code)) {
    return res.status(400).json({ error: true, mensaje: "La competición solicitada no está disponible." });
  }
  const claveCache = `standings-${req.params.code}`;
  const cacheado = obtenerDeCache(claveCache, TTL_STANDINGS);
  if (cacheado) return responderConCache(req, res, cacheado, 1800);

  try {
    const url = `${BASE_URL}/competitions/${req.params.code}/standings`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    responderConCache(req, res, datos, 1800);
  } catch (e) {
    enviarErrorFuente(res, e, '/api/liga/:code/standings');
  }
});

// ============ MULTISPORT (The Odds API) ============

app.get('/api/sports', async (req, res) => {
  const claveCache = 'odds-sports';
  const cacheado = obtenerDeCache(claveCache, 24 * 60 * 60 * 1000);
  if (cacheado) return responderConCache(req, res, cacheado, 3600);

  try {
    const url = `${THE_ODDS_BASE_URL}/sports/?apiKey=${THE_ODDS_API_KEY}`;
    const resp = await fetch(url);
    const datos = await resp.json();
    if (!resp.ok) throw new Error(datos.message || 'Error de The Odds API');
    
    guardarEnCache(claveCache, datos);
    responderConCache(req, res, datos, 3600);
  } catch (e) {
    enviarErrorFuente(res, e, '/api/sports');
  }
});

app.get('/api/odds/:sport', async (req, res) => {
  const { sport } = req.params;
  const { regions = 'us', markets = 'h2h' } = req.query;
  const claveCache = `odds-${sport}-${regions}-${markets}`;
  const cacheado = obtenerDeCache(claveCache, 15 * 60 * 1000);
  if (cacheado) return responderConCache(req, res, cacheado, 300);

  try {
    const url = `${THE_ODDS_BASE_URL}/sports/${sport}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=${regions}&markets=${markets}`;
    const resp = await fetch(url);
    const datos = await resp.json();
    if (!resp.ok) throw new Error(datos.message || 'Error de The Odds API');

    guardarEnCache(claveCache, datos);
    responderConCache(req, res, datos, 300);
  } catch (e) {
    enviarErrorFuente(res, e, `/api/odds/${sport}`);
  }
});

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: true, mensaje: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 3000;
let servidor = null;

inicializarHistorial().finally(() => {
  servidor = app.listen(PORT, () => {
    console.log(`Servidor de fulbito corriendo en el puerto ${PORT}`);
  });
});

// Graceful shutdown: cerrar limpiamente ante SIGTERM/SIGINT (importante en Render/Railway)
function cerrarServidor(senial) {
  console.log(`\nRecibida señal ${senial}, cerrando servidor limpiamente...`);
  // Flush: si hay una escritura pendiente por el debounce, forzarla antes de salir.
  const flushPendiente = () => {
    if (!escrituraPendiente) return Promise.resolve();
    clearTimeout(escrituraPendiente);
    escrituraPendiente = null;
    if (historialCacheMemoria) {
      return guardarHistorialEnStorage(historialCacheMemoria).catch(() => {});
    }
    return Promise.resolve();
  };
  const cerrarStorage = () => {
    if (storageHistorial && storageHistorial.cerrar) {
      try {
        const r = storageHistorial.cerrar();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (e) { /* el storage ya puede estar cerrado */ }
    }
  };
  if (!servidor) {
    flushPendiente().then(() => { cerrarStorage(); process.exit(0); });
    return;
  }
  servidor.close(() => {
    flushPendiente().then(() => {
      console.log('Servidor cerrado.');
      cerrarStorage();
      process.exit(0);
    });
  });
  // Forzar cierre tras 10s si las conexiones no se cierran
  setTimeout(() => {
    console.warn('Forzando cierre tras timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => cerrarServidor('SIGTERM'));
process.on('SIGINT', () => cerrarServidor('SIGINT'));