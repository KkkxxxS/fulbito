/**
 * repositories.js
 *
 * Servicios de persistencia para usuarios, sesiones y el historial del usuario.
 *
 * Propósito de Fase 2: consolidar todo en un único pool PostgreSQL. Aquí
 * también empezamos a introducir una capa de repositorios con contratos
 * explícitos, aunque aún no se ha migrado todo server.js.
 *
 * Todo lo que manipula SQL y cambia en `server/server.js`; Fase 4.5 mueve historial personal a repositorios.
 */
const db = require('./db');
const { marcadorDePartido } = require('./liquidacion');
const { verificarMercado } = require('../packages/domain/settlement');

async function repoUsuarioPorNombre(usuario) {
  const res = await db.query(
    'SELECT id, usuario, salt, password_hash FROM usuarios WHERE usuario = $1',
    [usuario]
  );
  return res.rows[0] || null;
}

async function repoSesionPorTokenHash(ht) {
  const res = await db.query(
    `SELECT s.*, u.usuario AS username FROM sesiones s
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = $1 AND s.expira >= NOW()`,
    [ht]
  );
  return res.rows[0] || null;
}

async function repoUsuarioIdPorToken(ht) {
  const res = await db.query(
    `SELECT u.id AS usuarioId, s.usuario_id AS id FROM sesiones s
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = $1 AND s.expira >= NOW()`,
    [ht]
  );
  return res.rows[0] || null;
}

async function repoCrearUsuario(usuario, passwordHash, salt) {
  const res = await db.query(
    'INSERT INTO usuarios (usuario, password_hash, salt) VALUES ($1, $2, $3) RETURNING id, usuario',
    [usuario, passwordHash, salt]
  );
  return res.rows[0];
}

async function repoCrearUsuarioYSesion(usuario, passwordHash, salt, tokenHash, expira) {
  const cliente = await db.pool.connect();
  try {
    await cliente.query('BEGIN');
    const userRes = await cliente.query(
      'INSERT INTO usuarios (usuario, password_hash, salt) VALUES ($1, $2, $3) RETURNING id',
      [usuario, passwordHash, salt]
    );
    const userId = userRes.rows[0].id;
    await cliente.query(
      'INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES ($1, $2, $3)',
      [tokenHash, userId, expira]
    );
    await cliente.query('COMMIT');
    return { id: userId, usuario };
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

async function repoCrearSesion(tokenHash, usuarioId, expira) {
  const res = await db.query(
    'INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES ($1, $2, $3) RETURNING *',
    [tokenHash, usuarioId, expira]
  );
  return res.rows[0];
}

async function repoRevocarSesionesUsuario(usuarioId) {
  await db.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuarioId]);
}

async function repoRevocarSesionPorTokenHash(ht) {
  await db.query('DELETE FROM sesiones WHERE token_hash = $1', [ht]);
}

async function repoLimpiarSesionesExpiradas() {
  await db.query('DELETE FROM sesiones WHERE expira < NOW()');
}

async function repoGetPersonalHistory(usuarioId) {
  const res = await db.query(
    'SELECT datos FROM pronosticos_usuario WHERE usuario_id = $1 ORDER BY id ASC',
    [usuarioId]
  );
  return res.rows.map(r => r.datos);
}

async function repoSavePersonalHistory(usuarioId, historial) {
  const lista = Array.isArray(historial) ? historial : [];
  const usuarioHistorial = lista.slice(-500);
  await db.pool.connect().then(async (client) => {
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM pronosticos_usuario WHERE usuario_id = $1', [usuarioId]);
      for (const registro of usuarioHistorial) {
        await client.query(
          'INSERT INTO pronosticos_usuario (usuario_id, partido_id, datos) VALUES ($1, $2, $3)',
          [usuarioId, String(registro.partidoId || 'unknown'), JSON.stringify(registro)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
  return { ok: true, historial: usuarioHistorial, total: usuarioHistorial.length };
}

async function repoGetHistorialPendientes(hoy) {
  const res = await db.query(`
    SELECT p.id, p.partido_id,
           (SELECT json_agg(m.*) FROM mercados_pronostico m WHERE m.pronostico_id = p.id) as mercados
    FROM pronosticos_globales p
    WHERE p.verificado = FALSE
      AND p.fecha <= $1`,
    [hoy.toISOString()]
  );
  return res.rows;
}

async function repoLiquidarPendientes(pendientes, mapaResultados) {
  let liquidados = 0;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of pendientes) {
      const partido = mapaResultados.get(String(p.partido_id));
      if (!partido) continue;
      const marcador = marcadorDePartido(partido);
      if (!marcador) continue;

      const mercadosActualizados = (p.mercados || []).map(m => ({
        ...m,
        acierto: verificarMercado(m.categoria, m.parametros, marcador.local, marcador.visita)
      }));

      await client.query(`
        UPDATE pronosticos_globales
        SET verificado = TRUE, marcador_final = $1, liquidado_en = $2
        WHERE id = $3`,
        [`${marcador.local}-${marcador.visita}`, new Date().toISOString(), p.id]
      );

      for (const m of mercadosActualizados) {
        await client.query(
          'UPDATE mercados_pronostico SET acierto = $1 WHERE pronostico_id = $2 AND categoria = $3',
          [m.acierto, p.id, m.categoria]
        );
      }
      liquidados++;
    }
    await client.query('COMMIT');
    return liquidados;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function repoGetHistorialGlobal() {
  const res = await db.query(`
    SELECT p.*,
           (SELECT json_agg(m.* ORDER BY m.id) FROM mercados_pronostico m WHERE m.pronostico_id = p.id) as mercados
    FROM pronosticos_globales p
    ORDER BY p.fecha DESC
  `);
  return res.rows.map(p => ({
    ...p,
    partidoId: p.partido_id,
    id: p.id,
    local: p.local,
    visita: p.visita,
    liga: p.liga,
    fecha: p.fecha,
    verificado: p.verificado,
    marcadorFinal: p.marcador_final,
    liquidadoEn: p.liquidado_en,
    mercados: (p.mercados || []).map(m => ({
      ...m,
      parametros: m.parametros || {},
      probabilidad: m.probabilidad == null ? null : Number(m.probabilidad)
    }))
  }));
}

async function repoGuardarHistorialGlobal(historial, opciones = {}) {
  const completo = Array.isArray(opciones.espejo) ? opciones.espejo : historial;
  const cliente = await db.pool.connect();
  try {
    await cliente.query('BEGIN');
    for (const registro of historial) {
      if (!registro || !registro.partidoId) continue;
      const fecha = registro.fecha || registro.timestamp || new Date().toISOString();
      const existente = await cliente.query(
        'SELECT id FROM pronosticos_globales WHERE partido_id = $1 ORDER BY id DESC LIMIT 1',
        [String(registro.partidoId)]
      );
      let pId;
      if (existente.rows.length > 0) {
        pId = existente.rows[0].id;
        await cliente.query(`
          UPDATE pronosticos_globales
          SET fecha = $1, verificado = $2, marcador_final = $3, liquidado_en = $4,
              local = COALESCE($6, local), visita = COALESCE($7, visita), liga = COALESCE($8, liga)
          WHERE id = $5`,
          [fecha, Boolean(registro.verificado), registro.marcadorFinal || null,
           registro.liquidadoEn || null, pId, registro.local || null,
           registro.visita || null, registro.liga || null]
        );
      } else {
        const pRes = await cliente.query(`
          INSERT INTO pronosticos_globales
            (partido_id, fecha, verificado, marcador_final, liquidado_en, local, visita, liga)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [String(registro.partidoId), fecha, Boolean(registro.verificado),
           registro.marcadorFinal || null, registro.liquidadoEn || null,
           registro.local || null, registro.visita || null, registro.liga || null]
        );
        pId = pRes.rows[0].id;
      }
      await cliente.query('DELETE FROM mercados_pronostico WHERE pronostico_id = $1', [pId]);
      if (registro.mercados && Array.isArray(registro.mercados)) {
        for (const m of registro.mercados) {
          await cliente.query(
            `INSERT INTO mercados_pronostico
               (pronostico_id, categoria, parametros, acierto, seleccion, probabilidad)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [pId, m.categoria, JSON.stringify(m.parametros || {}),
             typeof m.acierto === 'boolean' ? m.acierto : null,
             m.seleccion || null,
             Number.isFinite(Number(m.probabilidad)) ? Number(m.probabilidad) : null]
          );
        }
      }
    }
    await cliente.query('COMMIT');
    return completo;
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

async function repoCambiarContrasena(usuarioId, passwordHash) {
  const res = await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [passwordHash, usuarioId]);
  return res.rowCount > 0;
}

module.exports = {
  repoUsuarioPorNombre,
  repoUsuarioIdPorToken,
  repoSesionPorTokenHash,
  repoCrearUsuario,
  repoCrearUsuarioYSesion,
  repoCrearSesion,
  repoRevocarSesionesUsuario,
  repoRevocarSesionPorTokenHash,
  repoLimpiarSesionesExpiradas,
  repoGetPersonalHistory,
  repoSavePersonalHistory,
  repoGetHistorialPendientes,
  repoLiquidarPendientes,
  repoGetHistorialGlobal,
  repoGuardarHistorialGlobal,
  repoCambiarContrasena
};
