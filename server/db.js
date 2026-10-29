const { Pool } = require('pg');

/**
 * Gestor de Base de Datos para Fulbito.
 * Centraliza la conexión a PostgreSQL y las migraciones de esquema.
 *
 * El pool se crea de forma perezosa para que dotenv (que se carga en
 * server.js) haya leído DATABASE_URL antes de la primera conexión.
 * Sin DATABASE_URL las cuentas quedan deshabilitadas con un 503 explícito,
 * pero el resto del servidor (historial global en SQLite/archivo) sigue vivo.
 */

let poolReal = null;

function disponible() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

function obtenerPool() {
  if (!disponible()) {
    const error = new Error('DATABASE_URL no configurada: las cuentas requieren PostgreSQL.');
    error.code = 'DB_NO_CONFIGURADA';
    throw error;
  }
  if (!poolReal) {
    poolReal = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      max: 10,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
    poolReal.on('error', (error) => {
      console.error('Error inesperado del pool PostgreSQL:', error.message);
    });
  }
  return poolReal;
}

// Proxy compatible con el uso existente: db.pool.connect(), db.pool.query().
const pool = {
  connect: (...args) => obtenerPool().connect(...args),
  query: (...args) => obtenerPool().query(...args),
  end: (...args) => (poolReal ? poolReal.end(...args) : Promise.resolve())
};

async function inicializarBaseDeDatos() {
  if (!disponible()) {
    console.warn('⚠️  DATABASE_URL no configurada: las cuentas y el historial por usuario quedan deshabilitados.');
    return { omitido: true, motivo: 'DATABASE_URL no configurada' };
  }

  const cliente = await obtenerPool().connect();
  try {
    console.log('🚀 Iniciando migraciones de base de datos...');

    // 1. Tabla de Usuarios
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        creado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tabla de Sesiones
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS sesiones (
        token_hash TEXT PRIMARY KEY,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        expira TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira);');

    // 3. Tabla de Pronósticos Globales
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS pronosticos_globales (
        id SERIAL PRIMARY KEY,
        partido_id TEXT NOT NULL,
        fecha TIMESTAMP WITH TIME ZONE NOT NULL,
        verificado BOOLEAN DEFAULT FALSE,
        marcador_final TEXT,
        liquidado_en TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_partido_id ON pronosticos_globales(partido_id);');

    // 4. Tabla de Mercados (Detalle de cada pronóstico)
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS mercados_pronostico (
        id SERIAL PRIMARY KEY,
        pronostico_id INTEGER REFERENCES pronosticos_globales(id) ON DELETE CASCADE,
        categoria TEXT NOT NULL,
        parametros JSONB NOT NULL,
        acierto BOOLEAN
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_mercado_pronostico_id ON mercados_pronostico(pronostico_id);');

    // 5. Tabla de Pronósticos de Usuario (Historial Personal)
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS pronosticos_usuario (
        id SERIAL PRIMARY KEY,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        partido_id TEXT NOT NULL,
        datos JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_user_pronosticos ON pronosticos_usuario(usuario_id);');

    console.log('✅ Migraciones completadas exitosamente.');
    return { omitido: false };
  } catch (error) {
    console.error('❌ Error crítico en la migración de DB:', error);
    throw error;
  } finally {
    cliente.release();
  }
}

module.exports = {
  pool,
  disponible,
  inicializarBaseDeDatos,
  query: (text, params) => obtenerPool().query(text, params)
};
