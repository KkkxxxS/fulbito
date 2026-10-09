/**
 * Tests de auth ligera y del historial personal del servidor (server.js).
 *
 * Ejecutar: npm run test:auth
 *
 * Verifica el flujo de cuentas opcional (register/login/me/logout) y el
 * historial por usuario, que vive en la misma kv-store que el pool global pero
 * aislado por usuario (`historial:<usuarioId>`).
 *
 * Usa un puerto propio y limpia los artefactos (db/json legacy) al terminar.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUERTO = 33222;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DIR = __dirname;
const DB = path.join(DIR, 'data', 'historial.db');
const DB_SHM = path.join(DIR, 'data', 'historial.db-shm');
const DB_WAL = path.join(DIR, 'data', 'historial.db-wal');
const JSON_LEGACY = path.join(DIR, 'data', 'historial.json');

let fallos = 0;
function check(nombre, condicion, detalle) {
  if (condicion) {
    console.log(`  [OK ] ${nombre}`);
  } else {
    console.log(`  [FALLA] ${nombre}${detalle ? ` — ${detalle}` : ''}`);
    fallos++;
  }
}

function arrancarServidor() {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, ['server.js'], {
      cwd: DIR,
      env: { ...process.env, PORT: String(PUERTO), DATABASE_URL: process.env.DATABASE_URL || '' },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let resuelto = false;
    const limite = Date.now() + 15000;
    const sondeo = setInterval(() => {
      fetch(`${BASE}/health`)
        .then((r) => {
          if (r.ok && !resuelto) { resuelto = true; clearInterval(sondeo); resolve(hijo); }
        })
        .catch(() => {});
      if (!resuelto && Date.now() > limite) {
        resuelto = true; clearInterval(sondeo);
        reject(new Error('el servidor no respondió a /health a tiempo'));
      }
    }, 250);
    hijo.once('exit', (codigo) => {
      if (!resuelto) { resuelto = true; clearInterval(sondeo); reject(new Error(`el servidor terminó antes de iniciar (exit=${codigo})`)); }
    });
  });
}

async function detener(hijo) {
  if (!hijo || hijo.exitCode !== null) return;
  await new Promise((resolve) => {
    hijo.once('exit', resolve);
    hijo.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

async function llamar(metodo, ruta, cuerpo, token) {
  const cab = { 'Content-Type': 'application/json' };
  if (token) cab['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: cab,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  let datos = null;
  try { datos = await r.json(); } catch (e) {}
  return { r, datos };
}

async function main() {
  console.log('=== TEST DE AUTH E HISTORIAL PERSONAL ===');
  const hijo = await arrancarServidor();
  try {
    const usuario = `tester_${Date.now() % 100000}`;
    const password = 'secreta123';

    const reg = await llamar('POST', '/api/auth/register', { usuario, password });
    check('register crea cuenta y devuelve token', reg.r.ok && reg.datos.ok && typeof reg.datos.token === 'string', JSON.stringify(reg.datos));
    const token1 = reg.datos && reg.datos.token;

    const regDup = await llamar('POST', '/api/auth/register', { usuario, password });
    check('register duplicado es rechazado (409)', regDup.r.status === 409, `status=${regDup.r.status}`);

    const regCorto = await llamar('POST', '/api/auth/register', { usuario: 'ab', password });
    check('usuario corto es rechazado (400)', regCorto.r.status === 400, `status=${regCorto.r.status}`);

    const regPass = await llamar('POST', '/api/auth/register', { usuario: `otro_${Date.now() % 100000}`, password: 'corta' });
    check('contraseña corta es rechazada (400)', regPass.r.status === 400, `status=${regPass.r.status}`);

    const login = await llamar('POST', '/api/auth/login', { usuario, password });
    check('login con credenciales correctas devuelve token', login.r.ok && typeof login.datos.token === 'string', JSON.stringify(login.datos));
    const token = login.datos && login.datos.token;

    const loginMal = await llamar('POST', '/api/auth/login', { usuario, password: 'otra12345' });
    check('login con contraseña incorrecta es 401', loginMal.r.status === 401, `status=${loginMal.r.status}`);

    const me = await llamar('GET', '/api/auth/me', undefined, token);
    check('GET /api/auth/me responde el usuario', me.r.ok && me.datos.usuario === usuario.toLowerCase(), JSON.stringify(me.datos));

    const meSinToken = await llamar('GET', '/api/auth/me');
    check('GET /api/auth/me sin token es 401', meSinToken.r.status === 401, `status=${meSinToken.r.status}`);

    const h0 = await llamar('GET', '/api/mi-historial', undefined, token);
    check('GET /api/mi-historial arranca vacío', h0.r.ok && Array.isArray(h0.datos.historial) && h0.datos.historial.length === 0, JSON.stringify(h0.datos));

    const hSin = await llamar('GET', '/api/mi-historial');
    check('GET /api/mi-historial sin token es 401', hSin.r.status === 401, `status=${hSin.r.status}`);

    const carga = [
      { partidoId: 11, local: 'A', visita: 'B', liga: 'PL', fecha: new Date().toISOString(), verificado: false },
      { partidoId: 22, local: 'C', visita: 'D', liga: 'PD', fecha: new Date().toISOString(), verificado: true }
    ];
    const put = await llamar('PUT', '/api/mi-historial', { historial: carga }, token);
    check('PUT /api/mi-historial guarda el historial personal', put.r.ok && put.datos.total === 2, JSON.stringify(put.datos));

    const putSin = await llamar('PUT', '/api/mi-historial', { historial: carga });
    check('PUT /api/mi-historial sin token es 401', putSin.r.status === 401, `status=${putSin.r.status}`);

    const putGrande = await llamar('PUT', '/api/mi-historial', { historial: new Array(600).fill({ partidoId: 1 }) }, token);
    check('PUT /api/mi-historial rechaza payload > 500', putGrande.r.status === 400, `status=${putGrande.r.status}`);

    const h1 = await llamar('GET', '/api/mi-historial', undefined, token);
    check('GET /api/mi-historial devuelve lo guardado', h1.r.ok && h1.datos.historial.length === 2 && h1.datos.historial[1].verificado === true, JSON.stringify(h1.datos));

    const out = await llamar('POST', '/api/auth/logout', undefined, token);
    check('logout responde ok', out.r.ok, JSON.stringify(out.datos));

    const mePostOut = await llamar('GET', '/api/auth/me', undefined, token);
    check('el token queda invalidado tras logout', mePostOut.r.status === 401, `status=${mePostOut.r.status}`);
  } finally {
    await detener(hijo);
  }

  for (const archivo of [DB, DB_SHM, DB_WAL, JSON_LEGACY]) {
    if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  }

  console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS'} ===`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  for (const archivo of [DB, DB_SHM, DB_WAL, JSON_LEGACY]) {
    if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  }
  process.exit(1);
});
