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

// ============ NORMALIZADOR DE APIS (Factory) ============
function normalizarPartidos(partidos, provider) {
  if (provider === 'the-odds') {
    return partidos.map(p => ({
      id: p.id,
      sport: p.sport_key,
      fecha: p.commence_time,
      local: p.home_team,
      visita: p.away_team,
      bookmakers: p.bookmakers.map(b => ({
        titulo: b.title,
        mercados: b.markets.map(m => ({
          tipo: m.key,
          titulo: m.key.toUpperCase(),
          outcomes: m.outcomes.map(o => ({
            nombre: o.name,
            precio: o.price,
            punto: o.point || null
          }))
        }))
      }))
    }));
  }
  return partidos;
}

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

// The Odds API no cubre vóley: la fuente se conecta por RapidAPI con
// env vars del entorno (RAPIDAPI_KEY + RAPIDAPI_VOLLEY_HOST + RAPIDAPI_VOLLEY_PATH).
// Sin configuración responde 503 "sin_cobertura" para mostrar un estado
// amigable en vez de un error crudo.
async function cargarOddsVolley() {
  const host = process.env.RAPIDAPI_VOLLEY_HOST;
  if (!host) return null;
  const apiHost = host.startsWith('http') ? host : `https://${host}`;
  const ruta = process.env.RAPIDAPI_VOLLEY_PATH || '/matches/upcoming';
  const resp = await fetch(`${apiHost}${ruta}`, {
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY || '',
      'x-rapidapi-host': host
    }
  });
  if (!resp.ok) throw new Error(`API de vóley respondió ${resp.status}`);
  const datos = await resp.json();
  // El formato depende del proveedor: buscamos un array de partidos con
  // equipos local/visita en las claves más comunes.
  const lista = Array.isArray(datos) ? datos : (datos.response || datos.data || datos.matches || []);
  return lista.map(m => ({
    id: String(m.id || m.fixture || m.match_id || Math.random()),
    home_team: m.home_team || m.home || m.local || (m.teams && (m.teams.home || m.teams.local)) || 'Local',
    away_team: m.away_team || m.away || m.visitante || m.visit || (m.teams && (m.teams.away || m.teams.visitante)) || 'Visita',
    commence_time: m.commence_time || m.date || m.fecha || m.start_date || new Date().toISOString(),
    sport_key: 'volleyball',
    sport_title: 'Vóley',
    bookmakers: m.bookmakers || []
  }));
}

app.get('/api/odds/:sport', async (req, res) => {
  const { sport } = req.params;
  const { regions = 'us', markets = 'h2h' } = req.query;
  if (sport === 'volleyball' || sport === 'voley') {
    try {
      const datos = await cargarOddsVolley();
      if (datos === null) {
        return res.status(503).json({
          error: 'sin_cobertura',
          mensaje: 'Cobertura de vóley en implementación',
          detalle: 'La API de vóleibol se conecta por RapidAPI. Pide a tu administrador configurar RAPIDAPI_VOLLEY_HOST.'
        });
      }
      return responderConCache(req, res, datos, 300);
    } catch (e) {
      return enviarErrorFuente(res, e, '/api/odds/volleyball');
    }
  }
  if (sport === 'tenis') {
    try {
      const datos = await oddsTenisAgregadas();
      return responderConCache(req, res, datos, 300);
    } catch (e) {
      return enviarErrorFuente(res, e, '/api/odds/tenis');
    }
  }
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

// ============ MOTORES ELO MULTIDEPORTE ============
// Ports a Node de backend_motores/motor_basquet.py y motor_tenis.py.
// Se entrenan con resultados recientes de The Odds API (endpoint /scores)
// y se combinan con el consenso de cuotas (probabilidad implícita sin margen).
const ELO_STATE_PATH = path.join(__dirname, 'data', 'elo_state.json');
const BASE_ELO = 1500;

function erfAprox(x) {
  // Abramowitz-Stegun 7.1.26 (suficiente para la curva de spread del motor)
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

function eloProbGanar(diff) {
  return 1 / (1 + Math.pow(10, -diff / 400));
}

// --- Básquet: Elo con ventaja de localía y ritmo (motor_basquet.py) ---
const BASQUET_CFG = { homeAdvantage: 3.5, k: 20 };
function probGanarBasquet(eloL, eloV) {
  return eloProbGanar(eloL - eloV + BASQUET_CFG.homeAdvantage * 25);
}
function probCubreSpread(diff, sd = 11.5) {
  return diff >= 0
    ? 1 - 0.5 * (1 + erfAprox(diff / (sd * Math.SQRT2)))
    : 0.5 * (1 + erfAprox(Math.abs(diff) / (sd * Math.SQRT2)));
}
function puntosEsperadosBasquet(eqL, eqV) {
  const ritmo = (eqL.ritmo + eqV.ritmo) / 2;
  let effL = (eqL.effOff + eqV.effDef) / 2;
  let effV = (eqV.effOff + eqL.effDef) / 2;
  effL *= 1.025;
  effV *= 0.975;
  return [ritmo * effL, ritmo * effV];
}
function equipoBasquet(nombre) {
  const e = estadoElo.basquet.equipos[nombre];
  return e || { elo: BASE_ELO, partidos: 0, ritmo: 100, effOff: 1.1, effDef: 1.1 };
}

// --- Tenis: Elo (motor_tenis.py). Sin superficie en la fuente, se usa
// el Elo general; el Elo por superficie se activa cuando haya datos de ella.
const TENIS_CFG = { k: 32 };
const MAPA_SUPERFICIE = { dura: 'dura', arcilla: 'arcilla', hierba: 'hierba', hard: 'dura', clay: 'arcilla', grass: 'hierba', indoor: 'dura' };
function jugadorTenis(nombre) {
  const j = estadoElo.tenis.jugadores[nombre];
  return j || { eloGeneral: BASE_ELO, partidos: 0 };
}

// --- Estado persistente (el FS de Render es efímero, pero el Elo sobrevive
// a reinicios del dyno y se reentrena con resultados recientes al arrancar) ---
let estadoElo = { basquet: { equipos: {} }, tenis: { jugadores: {} }, entrenamientos: { basquet: 0, tenis: 0 } };
function cargarEstadoElo() {
  try {
    const crudo = fs.readFileSync(ELO_STATE_PATH, 'utf8');
    const datos = JSON.parse(crudo);
    estadoElo = {
      basquet: { equipos: (datos.basquet && datos.basquet.equipos) || {} },
      tenis: { jugadores: (datos.tenis && datos.tenis.jugadores) || {} },
      entrenamientos: { basquet: 0, tenis: 0, ...(datos.entrenamientos || {}) }
    };
  } catch (e) { /* sin estado previo: todos arrancan en Elo 1500 */ }
}
function guardarEstadoElo() {
  try {
    fs.mkdirSync(path.dirname(ELO_STATE_PATH), { recursive: true });
    fs.writeFileSync(ELO_STATE_PATH, JSON.stringify(estadoElo));
  } catch (e) { /* escritura best-effort */ }
}
cargarEstadoElo();

function entrenarBasquet(local, visita, ptsL, ptsV) {
  const l = estadoElo.basquet.equipos[local] || { elo: BASE_ELO, partidos: 0, ritmo: 100, effOff: 1.1, effDef: 1.1 };
  const v = estadoElo.basquet.equipos[visita] || { elo: BASE_ELO, partidos: 0, ritmo: 100, effOff: 1.1, effDef: 1.1 };
  const prob = probGanarBasquet(l.elo, v.elo);
  const resultado = ptsL > ptsV ? 1 : 0;
  const cambio = BASQUET_CFG.k * (resultado - prob);
  l.elo += cambio;
  v.elo -= cambio;
  const alpha = 0.2;
  l.partidos++; v.partidos++;
  l.ritmo = (1 - alpha) * l.ritmo + alpha * 100;
  v.ritmo = (1 - alpha) * v.ritmo + alpha * 100;
  estadoElo.basquet.equipos[local] = l;
  estadoElo.basquet.equipos[visita] = v;
}

function entrenarTenis(j1, j2, ganoJ1) {
  const a = estadoElo.tenis.jugadores[j1] || { eloGeneral: BASE_ELO, partidos: 0 };
  const b = estadoElo.tenis.jugadores[j2] || { eloGeneral: BASE_ELO, partidos: 0 };
  const esperado = eloProbGanar(a.eloGeneral - b.eloGeneral);
  const cambio = TENIS_CFG.k * ((ganoJ1 ? 1 : 0) - esperado);
  a.eloGeneral += cambio;
  b.eloGeneral -= cambio;
  a.partidos++; b.partidos++;
  estadoElo.tenis.jugadores[j1] = a;
  estadoElo.tenis.jugadores[j2] = b;
}

// Resultados de The Odds API (endpoint /scores). Formato tolerante:
// "scores" puede ser array [{name,value}] u objeto {home,away}.
function puntosScores(ev) {
  let l = null, v = null;
  if (Array.isArray(ev.scores)) {
    for (const s of ev.scores) {
      const n = String(s.name || '').toLowerCase();
      if (n.includes('home') || n === 'h') l = s.value;
      else if (n.includes('away') || n === 'a') v = s.value;
    }
  } else if (ev.scores && typeof ev.scores === 'object') {
    l = ev.scores.home != null ? ev.scores.home : ev.scores.home_team;
    v = ev.scores.away != null ? ev.scores.away : ev.scores.away_team;
  }
  if (l == null && ev.home_score != null) l = ev.home_score;
  if (v == null && ev.away_score != null) v = ev.away_score;
  return { l, v };
}

async function entrenarEloDesdeScores(sportKey, deporte) {
  if (!THE_ODDS_API_KEY) return 0;
  try {
    const url = `${THE_ODDS_BASE_URL}/sports/${sportKey}/scores/?apiKey=${THE_ODDS_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return 0;
    const datos = await resp.json();
    let n = 0;
    for (const ev of datos) {
      if (!ev.completed) continue;
      const { l, v } = puntosScores(ev);
      if (l == null || v == null || l === v || !ev.home_team || !ev.away_team) continue;
      if (deporte === 'basquet') entrenarBasquet(ev.home_team, ev.away_team, l, v);
      else entrenarTenis(ev.home_team, ev.away_team, l > v ? 1 : 0);
      n++;
    }
    if (n > 0) {
      estadoElo.entrenamientos[deporte] = (estadoElo.entrenamientos[deporte] || 0) + n;
      guardarEstadoElo();
    }
    return n;
  } catch (e) {
    return 0;
  }
}

// Consenso de mercado: probabilidad implícita sin margen, promediada
// entre todos los bookies del partido.
function consensoH2H(bookmakers) {
  let suma = [0, 0], n = 0;
  for (const b of bookmakers || []) {
    const m = (b.markets || []).find(mk => mk.key === 'h2h');
    if (!m || (m.outcomes || []).length < 2) continue;
    const [o1, o2] = m.outcomes;
    if (!(o1.price > 1 && o2.price > 1)) continue;
    const p1 = 1 / o1.price, p2 = 1 / o2.price;
    const tot = p1 + p2;
    suma[0] += p1 / tot;
    suma[1] += p2 / tot;
    n++;
  }
  if (!n) return null;
  return [suma[0] / n, suma[1] / n];
}

function mejorPrecioH2H(bookmakers, idx) {
  let mejor = null;
  for (const b of bookmakers || []) {
    const m = (b.markets || []).find(mk => mk.key === 'h2h');
    if (!m || !(m.outcomes || [])[idx]) continue;
    const o = m.outcomes[idx];
    if (o.price > 1 && (!mejor || o.price > mejor.precio)) mejor = { precio: o.price, bookie: b.title };
  }
  return mejor;
}

function nivelConfianza(pMax, entrenamientos, cons) {
  if (entrenamientos >= 50 && cons && pMax >= 0.65) return 'Alta';
  if (entrenamientos >= 10 || (cons && pMax >= 0.58)) return 'Media';
  return 'Baja';
}

function setsEstimadosTenis(pJ1) {
  const p20 = Math.pow(pJ1, 1.6);
  const p21 = Math.max(0, pJ1 - p20);
  const p02 = Math.pow(1 - pJ1, 1.6);
  const p12 = Math.max(0, (1 - pJ1) - p02);
  const tot = p20 + p21 + p02 + p12 || 1;
  return { '2-0': p20 / tot, '2-1': p21 / tot, '0-2': p02 / tot, '1-2': p12 / tot };
}

function prediccionPartido(partido, deporte) {
  const cons = consensoH2H(partido.bookmakers);
  const entrenamientos = estadoElo.entrenamientos[deporte] || 0;
  // El Elo pesa hasta 50% y solo crece con partidos entrenados: con poca
  // historia manda el consenso del mercado; con más, el modelo propio.
  const wElo = Math.min(0.5, entrenamientos / 200);

  let pEloL, extras = {};
  if (deporte === 'basquet') {
    const eqL = equipoBasquet(partido.home_team);
    const eqV = equipoBasquet(partido.away_team);
    pEloL = probGanarBasquet(eqL.elo, eqV.elo);
    const [pl, pv] = puntosEsperadosBasquet(eqL, eqV);
    const diff = pl - pv;
    extras = {
      spread: { linea: Math.round(diff * 2) / 2, probLocalCubre: Math.round(probCubreSpread(diff) * 100) },
      total: { linea: Math.round(pl + pv), overProb: 50 },
      elo: { local: Math.round(eqL.elo), visita: Math.round(eqV.elo) }
    };
  } else {
    const j1 = jugadorTenis(partido.home_team);
    const j2 = jugadorTenis(partido.away_team);
    pEloL = eloProbGanar(j1.eloGeneral - j2.eloGeneral);
    extras = { elo: { local: Math.round(j1.eloGeneral), visita: Math.round(j2.eloGeneral) } };
  }

  let pLocal;
  if (cons) pLocal = wElo * pEloL + (1 - wElo) * cons[0];
  else pLocal = pEloL;
  pLocal = Math.min(0.97, Math.max(0.03, pLocal));
  const pVisita = 1 - pLocal;

  const modelo = {
    local: { probabilidad: Math.round(pLocal * 100), cuotaJusta: Math.round((1 / pLocal) * 100) / 100 },
    visita: { probabilidad: Math.round(pVisita * 100), cuotaJusta: Math.round((1 / pVisita) * 100) / 100 }
  };

  // Valor: la mejor cuota de mercado vs la cuota justa del modelo
  const valorL = mejorPrecioH2H(partido.bookmakers, 0);
  const valorV = mejorPrecioH2H(partido.bookmakers, 1);
  let valor = null;
  const cand = [];
  if (valorL) cand.push({ seleccion: 'local', nombre: partido.home_team, precio: valorL.precio, bookie: valorL.bookie, ev: valorL.precio * pLocal - 1 });
  if (valorV) cand.push({ seleccion: 'visita', nombre: partido.away_team, precio: valorV.precio, bookie: valorV.bookie, ev: valorV.precio * pVisita - 1 });
  if (cand.length) {
    cand.sort((a, b) => b.ev - a.ev);
    const mejor = cand[0];
    valor = {
      seleccion: mejor.seleccion,
      nombre: mejor.nombre,
      cuota: mejor.precio,
      bookie: mejor.bookie,
      ev: Math.round(mejor.ev * 100),
      esValor: mejor.ev >= 0.03
    };
  }

  const pMax = Math.max(pLocal, pVisita);
  const confianza = nivelConfianza(pMax, entrenamientos, !!cons);

  if (deporte === 'tenis') {
    const sets = setsEstimadosTenis(pLocal);
    extras.sets = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, Math.round(v * 100)]));
  }

  return {
    id: partido.id,
    local: partido.home_team,
    visita: partido.away_team,
    fecha: partido.commence_time,
    liga: partido.sport_title,
    modelo,
    confianza,
    valor,
    extras,
    origen: cons ? 'elo+consenso' : 'elo'
  };
}

// Tenis: The Odds API publica por torneo (tennis_atp_xxx). Agregamos los
// torneos ATP/WTA activos para mostrar todo el tenis en una sola vista.
async function listarTorneosTenis() {
  const cacheado = obtenerDeCache('odds-tenis-torneos', 6 * 60 * 60 * 1000);
  if (cacheado) return cacheado;
  const url = `${THE_ODDS_BASE_URL}/sports/?apiKey=${THE_ODDS_API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('No se pudo listar deportes');
  const datos = await resp.json();
  // La lista de /sports expone el identificador en "key".
  const torneos = datos
    .filter(s => s.key && s.key.startsWith('tennis_') && s.active)
    .map(s => s.key)
    .slice(0, 4);
  guardarEnCache('odds-tenis-torneos', torneos);
  return torneos;
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function oddsTenisAgregadas() {
  const cacheado = obtenerDeCache('odds-tenis-all', 15 * 60 * 1000);
  if (cacheado) return cacheado;
  const torneos = await listarTorneosTenis();
  const partidos = [];
  for (const t of torneos) {
    try {
      const url = `${THE_ODDS_BASE_URL}/sports/${t}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=h2h`;
      const resp = await fetch(url);
      if (resp.ok) {
        const datos = await resp.json();
        partidos.push(...datos);
      }
      await entrenarEloDesdeScores(t, 'tenis');
    } catch (e) { /* torneo fallido: seguimos con los demás */ }
    await dormir(1050); // límite de 1 req/s de The Odds API
  }
  guardarEnCache('odds-tenis-all', partidos);
  return partidos;
}

// ============ PREDICCIONES MULTIDEPORTE (Fulbito IA) ============
// Devuelve, por partido: probabilidad del modelo, cuota justa, confianza,
// valor vs el mejor precio de mercado y extras del deporte.
app.get('/api/predicciones/:deporte', async (req, res) => {
  const { deporte } = req.params;
  const mapa = { basquet: 'basketball_nba', tenis: 'tenis' };
  const sportKey = mapa[deporte];
  if (!sportKey) {
    return res.status(404).json({ error: 'deporte_no_soportado', mensaje: `Sin motor para "${deporte}". Soportados: basquet, tenis.` });
  }
  const claveCache = `predicciones-${deporte}`;
  const cacheado = obtenerDeCache(claveCache, 5 * 60 * 1000);
  if (cacheado) return responderConCache(req, res, cacheado, 300);

  try {
    let partidos;
    if (deporte === 'tenis') {
      partidos = await oddsTenisAgregadas();
    } else {
      const url = `${THE_ODDS_BASE_URL}/sports/${sportKey}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const datos = await resp.json().catch(() => ({}));
        throw new Error(datos.message || 'Error de The Odds API');
      }
      partidos = await resp.json();
      await entrenarEloDesdeScores(sportKey, 'basquet');
    }

    const predicciones = (partidos || []).map(p => prediccionPartido(p, deporte));
    const salida = {
      deporte,
      generadoEn: new Date().toISOString(),
      partidosEntrenamiento: estadoElo.entrenamientos[deporte] || 0,
      partidos: predicciones
    };
    guardarEnCache(claveCache, salida);
    responderConCache(req, res, salida, 300);
  } catch (e) {
    enviarErrorFuente(res, e, `/api/predicciones/${deporte}`);
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