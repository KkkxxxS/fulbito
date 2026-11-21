const { Pool } = require('pg');
const fs = require('fs');

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
      // Fase 9: TLS con validación de certificado por defecto. DATABASE_SSL=false
      // desactiva TLS (compat, sólo desarrollo local); DATABASE_SSL_CA_FILE añade CA personalizada.
      ssl: modoSsl()
    });
    poolReal.on('error', (error) => {
      console.error('Error inesperado del pool PostgreSQL:', error.message);
    });
  }
  return poolReal;
}

function modoSsl() {
  const modo = String(process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (!modo || modo === 'false') return false;
  const opts = { rejectUnauthorized: true };
  const caFile = String(process.env.DATABASE_SSL_CA_FILE || '').trim();
  if (caFile) {
    try {
      opts.ca = fs.readFileSync(caFile);
    } catch (e) {
      console.warn('ADVERTENCIA: no se pudo leer DATABASE_SSL_CA_FILE:', caFile);
    }
  }
  return opts;
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
        local TEXT,
        visita TEXT,
        liga TEXT,
        fecha TIMESTAMP WITH TIME ZONE NOT NULL,
        verificado BOOLEAN DEFAULT FALSE,
        marcador_final TEXT,
        liquidado_en TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_partido_id ON pronosticos_globales(partido_id);');
    // Migraciones idempotentes para bases creadas antes de estas columnas.
    await cliente.query('ALTER TABLE pronosticos_globales ADD COLUMN IF NOT EXISTS local TEXT;');
    await cliente.query('ALTER TABLE pronosticos_globales ADD COLUMN IF NOT EXISTS visita TEXT;');
    await cliente.query('ALTER TABLE pronosticos_globales ADD COLUMN IF NOT EXISTS liga TEXT;');

    // 4. Tabla de Mercados (Detalle de cada pronóstico)
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS mercados_pronostico (
        id SERIAL PRIMARY KEY,
        pronostico_id INTEGER REFERENCES pronosticos_globales(id) ON DELETE CASCADE,
        categoria TEXT NOT NULL,
        parametros JSONB NOT NULL,
        acierto BOOLEAN,
        seleccion TEXT,
        probabilidad NUMERIC
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_mercado_pronostico_id ON mercados_pronostico(pronostico_id);');
    await cliente.query('ALTER TABLE mercados_pronostico ADD COLUMN IF NOT EXISTS seleccion TEXT;');
    await cliente.query('ALTER TABLE mercados_pronostico ADD COLUMN IF NOT EXISTS probabilidad NUMERIC;');

    // Tabla kv: almacén clave-valor usado por el layer de compatibilidad
    // (espacios legacy de historial). En Fase 2 se deja de usarla; se mantiene
    // para evitar romper lecturas de fases anteriores.
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS kv (
        clave TEXT PRIMARY KEY,
        valor JSONB NOT NULL
      );
    `);

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

    // 7. Tokens de restablecimiento de contraseña (Fase 9).
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        token_hash TEXT NOT NULL,
        expira TIMESTAMP WITH TIME ZONE NOT NULL,
        usado BOOLEAN NOT NULL DEFAULT false,
        creado TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await cliente.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_email ON password_reset_tokens(email);');

    // 8. Auditoría de aprobaciones (Fase 9): registro inmutable de decisiones.
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS auditoria_aprobaciones (
        id SERIAL PRIMARY KEY,
        accion TEXT NOT NULL,
        actor TEXT NOT NULL,
        descripcion TEXT,
        ip TEXT,
        hash TEXT NOT NULL,
        hash_input TEXT NOT NULL,
        creado TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await cliente.query('CREATE INDEX IF NOT EXISTS idx_auditoria_aprobaciones_creado ON auditoria_aprobaciones(creado);');

    console.log('✅ Migraciones completadas exitosamente.');
    return { omitido: false };
  } catch (error) {
    console.error('❌ Error crítico en la migración de DB:', error);
    throw error;
  } finally {
    cliente.release();
  }
}

function normalizarParametrosQuery(params) {
  return params === undefined || Array.isArray(params) ? params : [params];
}

module.exports = {
  pool,
  disponible,
  inicializarBaseDeDatos,
  normalizarParametrosQuery,
  query: (text, params) => {
    // `pg` exige que los valores sean un array. Aceptamos un escalar para no
    // repetir el fallo "Query values must be an array" que dejó la liquidación
    // del track record sin ejecutarse en producción.
    return obtenerPool().query(text, normalizarParametrosQuery(params));
  }
};
