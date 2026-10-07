/**
 * Test de persistencia del historial del servidor (server.js).
 *
 * Ejecutar: npm run test:server
 *
 * Verifica el ciclo que antes se perdía en Render free (filesystem efímero):
 *   1. El historial se escribe con X-Api-Key.
 *   2. Se mantiene al reiniciar (persistencia en DB: SQLite local / Postgres con DATABASE_URL).
 *   3. Las escrituras sin key son rechazadas.
 *
 * Usa un puerto propio y limpia los artefactos (db/json legacy) al terminar.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUERTO = 33221;
const CLAVE = 'clave-de-prueba';
const BASE = `http://127.0.0.1:${PUERTO}`;
const DIR = __dirname;
const DB = path.join(DIR, 'data', 'historial.db');
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
      env: { ...process.env, PORT: String(PUERTO), HISTORIAL_API_KEY: CLAVE, DATABASE_URL: process.env.DATABASE_URL || '' },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let intervalo = null;
    const esperar = Date.now() + 15000;
    let resuelto = false;
    const parar = () => { if (intervalo) clearInterval(intervalo); };
    hijo.once('exit', (codigo) => {
      if (!resuelto) {
        parar();
        reject(new Error(`el servidor terminó antes de iniciar (exit=${codigo})`));
      }
    });
    const sondeo = setInterval(() => {
      fetch(`${BASE}/health`)
        .then((r) => {
          if (r.ok && !resuelto) {
            resuelto = true;
            parar();
            resolve(hijo);
          }
        })
        .catch(() => {});
      if (Date.now() > esperar && !resuelto) {
        resuelto = true;
        parar();
        reject(new Error('el servidor no respondió a /health a tiempo'));
      }
    }, 250);
    intervalo = sondeo;
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

async function leerHistorial() {
  const r = await fetch(`${BASE}/api/historial`);
  const datos = await r.json();
  return datos.historial;
}

async function main() {
  console.log('=== TEST DE PERSISTENCIA DEL SERVIDOR ===');
  const hijo1 = await arrancarServidor();
  try {
    const payload = {
      historial: [
        { partidoId: 123, local: 'Alianza', visita: 'U', liga: 'PL', fecha: new Date().toISOString(), verificado: false }
      ]
    };
    const rPost = await fetch(`${BASE}/api/historial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': CLAVE },
      body: JSON.stringify(payload)
    });
    const postDatos = await rPost.json();
    check('POST con X-Api-Key guarda el historial', rPost.ok && postDatos.total === 1, JSON.stringify(postDatos));

    const rSinKey = await fetch(`${BASE}/api/historial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    check('POST sin X-Api-Key es rechazado (401)', rSinKey.status === 401, `status=${rSinKey.status}`);
    // Esperar a que el debounce de escritura (500ms) persista en la DB antes de reiniciar.
    await new Promise((resolve) => setTimeout(resolve, 800));
  } finally {
    await detener(hijo1);
  }

  const hijo2 = await arrancarServidor();
  try {
    const historial = await leerHistorial();
    check('el historial sobrevive al reinicio del servidor', historial.length === 1 && historial[0].local === 'Alianza',
      JSON.stringify(historial));
  } finally {
    await detener(hijo2);
  }

  for (const archivo of [DB, JSON_LEGACY]) {
    if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  }

  console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS'} ===`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  for (const archivo of [DB, JSON_LEGACY]) {
    if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  }
  process.exit(1);
});