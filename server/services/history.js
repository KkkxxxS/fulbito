/**
 * history.js
 *
 * Servicio de historial compartido global (DB primero, legacy local).
 * Propósito de Fase 4.1: `server/server.js` solo compone rutas; la lógica de
 * guardado/ lectura/ingesta/inicialización queda en servicio de aplicación.
 *
 * No hay I/O de proveedor; usa `db` y `fs` como infraestructura. Fase 4.7: repositorio global.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { repoGetHistorialGlobal, repoGuardarHistorialGlobal } = require('../repositories');

const DATA_DIR = process.env.FULBITO_DATA_DIR
  ? path.resolve(process.env.FULBITO_DATA_DIR)
  : path.join(__dirname, 'data');

const HISTORIAL_PATH = path.join(DATA_DIR, 'historial.json');

let storageHistorial = null;
let storageHistorialFallo = null;
let historialCacheMemoria = null;
let escrituraPendiente = null;

const HISTORIAL_MAX_ENTRIES = (() => {
  const n = parseInt(process.env.HISTORIAL_MAX_ENTRIES || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

function cargarStorageHistorial() {
  if (storageHistorial) return storageHistorial;
  const url = process.env.DATABASE_URL;
  if (url) {
    storageHistorial = {
      tipo: 'postgres',
      async inicializar() {
        await db.pool.query("CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor JSONB NOT NULL)");
      },
      async leer() {
        const r = await db.pool.query("SELECT valor FROM kv WHERE clave = 'historial'");
        return r.rows.length ? r.rows[0].valor : null;
      },
      async guardar(valor) {
        await db.pool.query(
          "INSERT INTO kv (clave, valor) VALUES ('historial', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",
          [JSON.stringify(valor)]
        );
      },
      async leerClave(clave) {
        const r = await db.pool.query("SELECT valor FROM kv WHERE clave = $1", [clave]);
        return r.rows.length ? r.rows[0].valor : null;
      },
      async guardarClave(clave, valor) {
        await db.pool.query(
          "INSERT INTO kv (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",
          [clave, JSON.stringify(valor)]
        );
      },
      async borrarClave(clave) {
        await db.pool.query("DELETE FROM kv WHERE clave = $1", [clave]);
      },
      cerrar: () => db.pool.end()
    };
  } else {
    const dir = path.dirname(HISTORIAL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const Database = require('better-sqlite3');
    const dbSqlite = new Database(path.join(dir, 'historial.db'));
    dbSqlite.pragma('journal_mode = WAL');
    dbSqlite.exec('CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    storageHistorial = {
      tipo: 'sqlite',
      leer() {
        const fila = dbSqlite.prepare("SELECT valor FROM kv WHERE clave = 'historial'").get();
        return fila ? JSON.parse(fila.valor) : null;
      },
      guardar(valor) {
        dbSqlite.prepare(
          "INSERT INTO kv (clave, valor) VALUES ('historial', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor"
        ).run(JSON.stringify(valor));
      },
      leerClave(clave) {
        const fila = dbSqlite.prepare("SELECT valor FROM kv WHERE clave = ?").get(clave);
        return fila ? JSON.parse(fila.valor) : null;
      },
      guardarClave(clave, valor) {
        dbSqlite.prepare(
          "INSERT INTO kv (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor"
        ).run(clave, JSON.stringify(valor));
      },
      borrarClave(clave) {
        dbSqlite.prepare("DELETE FROM kv WHERE clave = ?").run(clave);
      },
      cerrar: () => dbSqlite.close()
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

function leerHistorialLegacy() {
  if (historialCacheMemoria) return historialCacheMemoria;
  try {
    asegurarHistorialGlobal();
    const datos = JSON.parse(fs.readFileSync(HISTORIAL_PATH, 'utf8'));
    historialCacheMemoria = Array.isArray(datos) ? datos : [];
    return historialCacheMemoria;
  } catch (error) {
    return [];
  }
}

async function leerHistorialGlobal() {
  if (db.disponible()) {
    try {
      return await repoGetHistorialGlobal();
    } catch (e) {
      console.error('Error leyendo historial global (se usa el storage local):', e.message);
    }
  }
  return leerHistorialLegacy();
}
function recortarHistorial(historial) {
  if (!Array.isArray(historial)) return [];
  return HISTORIAL_MAX_ENTRIES > 0 ? historial.slice(-HISTORIAL_MAX_ENTRIES) : historial;
}

function guardarHistorialLegacy(recortado) {
  historialCacheMemoria = recortado;
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

async function guardarHistorialGlobal(historial, opciones = {}) {
  if (!Array.isArray(historial)) return [];
  const recortado = recortarHistorial(historial);
  const completo = Array.isArray(opciones.espejo) ? recortarHistorial(opciones.espejo) : recortado;

  if (!db.disponible()) return guardarHistorialLegacy(completo);

  try {
    await repoGuardarHistorialGlobal(completo, opciones);
    historialCacheMemoria = completo;
    fs.promises.writeFile(HISTORIAL_PATH, JSON.stringify(completo, null, 2), 'utf8').catch(() => {});
    return recortado;
  } catch (e) {
    console.error('Error guardando historial global (se usa el storage local):', e.message);
    return guardarHistorialLegacy(completo);
  }
}

function normalizarEntradaHistorial(entrada) {
  if (!entrada || !entrada.partidoId) return null;
  const mercados = (Array.isArray(entrada.mercados) ? entrada.mercados : [])
    .filter(m => m && m.categoria)
    .map(m => ({
      categoria: String(m.categoria).slice(0, 40),
      parametros: m.parametros && typeof m.parametros === 'object' ? m.parametros : {},
      seleccion: m.seleccion == null ? null : String(m.seleccion).slice(0, 200),
      probabilidad: Number.isFinite(Number(m.probabilidad)) ? Number(m.probabilidad) : null,
      acierto: typeof m.acierto === 'boolean' ? m.acierto : null
    }));
  return {
    partidoId: String(entrada.partidoId).slice(0, 64),
    local: entrada.local ? String(entrada.local).slice(0, 120) : null,
    visita: entrada.visita ? String(entrada.visita).slice(0, 120) : null,
    liga: entrada.liga ? String(entrada.liga).slice(0, 120) : null,
    fecha: entrada.fecha || entrada.timestamp || new Date().toISOString(),
    mercados,
    verificado: false,
    marcadorFinal: null,
    liquidadoEn: null
  };
}

async function ingestarHistorialGlobal(entradas) {
  const lista = (Array.isArray(entradas) ? entradas : [])
    .map(normalizarEntradaHistorial)
    .filter(Boolean);

  const actual = await leerHistorialGlobal();
  const existentes = new Set(actual.map(r => String(r.partidoId)));
  const nuevas = [];
  for (const entrada of lista) {
    if (existentes.has(entrada.partidoId)) continue;
    existentes.add(entrada.partidoId);
    nuevas.push(entrada);
  }
  if (nuevas.length === 0) {
    return { insertados: 0, omitidos: lista.length, total: actual.length };
  }
  const total = actual.concat(nuevas);
  await guardarHistorialGlobal(nuevas, { espejo: total });
  return { insertados: nuevas.length, omitidos: lista.length - nuevas.length, total: total.length };
}

async function inicializarHistorial() {
  try {
    const storage = cargarStorageHistorial();
    if (storage.inicializar) await storage.inicializar();
    const previo = await storage.leer();
    if (Array.isArray(previo) && previo.length > 0) {
      historialCacheMemoria = recortarHistorial(previo);
      asegurarHistorialGlobal();
      fs.promises.writeFile(HISTORIAL_PATH, JSON.stringify(historialCacheMemoria, null, 2), 'utf8').catch(() => {});
    }
    console.log(`Historial cargado desde ${storage.tipo} (${(historialCacheMemoria || []).length} entradas).`);
  } catch (error) {
    storageHistorialFallo = error.message;
    console.warn('No se pudo inicializar el storage de historial (se usará el archivo legacy):', error.message);
  }
}

module.exports = {
  cargarStorageHistorial,
  guardarHistorialEnStorage,
  asegurarHistorialGlobal,
  leerHistorialLegacy,
  leerHistorialGlobal,
  recortarHistorial,
  guardarHistorialGlobal,
  normalizarEntradaHistorial,
  ingestarHistorialGlobal,
  inicializarHistorial,
  getHistorialCacheMemoria: () => historialCacheMemoria,
  getEscrituraPendiente: () => escrituraPendiente,
  setEscrituraPendiente: (v) => { escrituraPendiente = v; },
  getStorageHistorial: () => storageHistorial,
  getStorageHistorialFallo: () => storageHistorialFallo
};
