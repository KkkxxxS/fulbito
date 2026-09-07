const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const app = express();

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

if (!API_KEY) {
  console.warn("ADVERTENCIA: falta FOOTBALL_DATA_API_KEY. Configúrala en las variables de entorno del servicio.");
}

// ============ HISTORIAL COMPARTIDO GLOBAL ============
const HISTORIAL_PATH = path.join(__dirname, 'data', 'historial.json');

function asegurarHistorialGlobal() {
  const dir = path.dirname(HISTORIAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(HISTORIAL_PATH)) {
    fs.writeFileSync(HISTORIAL_PATH, JSON.stringify([], null, 2), 'utf8');
  }
}

let historialCacheMemoria = null;
let historialCacheExpira = 0;
const TTL_HISTORIAL_MEMORIA = 30 * 1000;

function leerHistorialGlobal() {
  const ahora = Date.now();
  if (historialCacheMemoria && ahora < historialCacheExpira) {
    return historialCacheMemoria;
  }
  try {
    asegurarHistorialGlobal();
    const contenido = fs.readFileSync(HISTORIAL_PATH, 'utf8');
    const datos = JSON.parse(contenido);
    historialCacheMemoria = Array.isArray(datos) ? datos : [];
    historialCacheExpira = ahora + TTL_HISTORIAL_MEMORIA;
    return historialCacheMemoria;
  } catch (error) {
    console.warn('No se pudo leer el historial global:', error.message);
    return [];
  }
}

let escrituraPendiente = null;
function guardarHistorialGlobal(historial) {
  try {
    asegurarHistorialGlobal();
    const recortado = Array.isArray(historial) ? historial.slice(-200) : [];
    historialCacheMemoria = recortado;
    historialCacheExpira = Date.now() + TTL_HISTORIAL_MEMORIA;
    // Debounce: si llegan varias escrituras seguidas, esperamos la última.
    if (escrituraPendiente) clearTimeout(escrituraPendiente);
    escrituraPendiente = setTimeout(() => {
      fs.promises.writeFile(HISTORIAL_PATH, JSON.stringify(recortado, null, 2), 'utf8')
        .catch(err => console.warn('No se pudo guardar el historial global:', err.message));
      escrituraPendiente = null;
    }, 500);
    return recortado;
  } catch (error) {
    console.warn('No se pudo guardar el historial global:', error.message);
    return [];
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

app.post('/api/historial', (req, res) => {
  const historial = Array.isArray(req.body?.historial) ? req.body.historial : [];
  const guardado = guardarHistorialGlobal(historial);
  res.json({ ok: true, historial: guardado, total: guardado.length });
});

app.put('/api/historial', (req, res) => {
  const historial = Array.isArray(req.body?.historial) ? req.body.historial : [];
  const guardado = guardarHistorialGlobal(historial);
  res.json({ ok: true, historial: guardado, total: guardado.length });
});

// Helper: responde con ETag para ahorrar ancho de banda cuando el cliente ya tiene la misma versión
const crypto = require('crypto');
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

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: true, mensaje: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 3000;
const servidor = app.listen(PORT, () => {
  console.log(`Servidor de fulbito corriendo en el puerto ${PORT}`);
});

// Graceful shutdown: cerrar limpiamente ante SIGTERM/SIGINT (importante en Render/Railway)
function cerrarServidor(senial) {
  console.log(`\nRecibida señal ${senial}, cerrando servidor limpiamente...`);
  servidor.close(() => {
    console.log('Servidor cerrado.');
    if (escrituraPendiente) {
      clearTimeout(escrituraPendiente);
    }
    process.exit(0);
  });
  // Forzar cierre tras 10s si las conexiones no se cierran
  setTimeout(() => {
    console.warn('Forzando cierre tras timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => cerrarServidor('SIGTERM'));
process.on('SIGINT', () => cerrarServidor('SIGINT'));