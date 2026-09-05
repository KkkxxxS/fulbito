const express = require('express');
const cors = require('cors');
const app = express();
const ORIGENES_PERMITIDOS = new Set([
  'https://kkkxxxs.github.io',
  'https://fulbito-flame.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ORIGENES_PERMITIDOS.has(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido'));
  }
}));

// La API key se lee de la variable de entorno FOOTBALL_DATA_API_KEY (configúrala en
// Render -> tu servicio -> Environment). Se deja un valor de respaldo para que el
// servidor no se rompa si todavía no la configuraste, pero lo ideal es borrar ese
// respaldo una vez que la variable de entorno esté funcionando, y regenerar la key
// en football-data.org si este archivo llegó a subirse a un repo público con la key adentro.
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE_URL = "https://api.football-data.org/v4";

if (!process.env.FOOTBALL_DATA_API_KEY) {
  console.warn("ADVERTENCIA: falta FOOTBALL_DATA_API_KEY. Configúrala en las variables de entorno del servicio.");
}

// ============ CACHE EN MEMORIA ============
// Evita golpear football-data.org (que tiene limite de requests/minuto) cada vez
// que un usuario distinto pide lo mismo. Se pierde al reiniciar el servidor, pero
// eso esta bien para este caso de uso.
const cache = new Map();

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
  cache.set(clave, { datos, guardadoEn: Date.now() });
}

const TTL_PARTIDOS = 5 * 60 * 1000;      // 5 minutos: los partidos programados casi no cambian
const TTL_STATS_EQUIPO = 15 * 60 * 1000; // 15 minutos
const TTL_H2H = 60 * 60 * 1000;          // 1 hora: el historial directo cambia muy poco
const TTL_STANDINGS = 30 * 60 * 1000;    // 30 minutos
const COMPETICIONES_PERMITIDAS = new Set(['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'DED', 'ELC', 'BSA', 'PPL']);

async function fetchFootballData(url) {
  if (!API_KEY) {
    const error = new Error('La fuente de datos no está configurada.');
    error.status = 503;
    throw error;
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 12000);
  try {
    return await fetch(url, {
      headers: { "X-Auth-Token": API_KEY },
      signal: controlador.signal
    });
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
    return res.status(429).json({ error: "Demasiadas peticiones, intenta de nuevo en un momento." });
  }

  registro.cuenta++;
  next();
}

app.use(limitarPeticiones);

// Limpieza periodica del mapa de rate limiting para que no crezca indefinidamente
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, registro] of contadorPorIP.entries()) {
    if (ahora - registro.inicioVentana > VENTANA_MS * 2) contadorPorIP.delete(ip);
  }
}, 5 * 60 * 1000);

// ============ RUTAS DE KEEP-ALIVE / SALUD ============
// Livianas a propósito: no llaman a football-data.org, así un cronjob de keep-alive
// (cron-job.org, UptimeRobot, etc) no gasta nada de la cuota diaria de la API externa.
app.get('/', (req, res) => {
  res.json({ ok: true, servicio: "fulbito-backend", hora: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

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
  if (cacheado) return res.json(cacheado);

  try {
    const url = `${BASE_URL}/matches?competitions=${competitions}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    res.json(datos);
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
  if (cacheado) return res.json(cacheado);

  try {
    const url = `${BASE_URL}/teams/${req.params.id}/matches?status=FINISHED&limit=18`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    res.json(datos);
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
  if (cacheado) return res.json(cacheado);

  try {
    const url = `${BASE_URL}/matches/${req.params.id}/head2head?limit=10`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    res.json(datos);
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
  if (cacheado) return res.json(cacheado);

  try {
    const url = `${BASE_URL}/competitions/${req.params.code}/standings`;
    const resp = await fetchFootballData(url);
    const datos = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, status: resp.status, mensaje: datos.message || "Error de football-data.org" });
    }

    guardarEnCache(claveCache, datos);
    res.json(datos);
  } catch (e) {
    enviarErrorFuente(res, e, '/api/liga/:code/standings');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de fulbito corriendo en el puerto ${PORT}`);
});