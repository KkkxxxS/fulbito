/**
 * Test de persistencia del historial del servidor (server.js).
 *
 * Ejecutar: npm run test:server
 *
 * Verifica el ciclo que antes se perdía en Render free (filesystem efímero):
 *   1. El historial se escribe con X-Api-Key.
 *   2. El ingest diario solo agrega partidos nuevos (idempotente).
 *   3. Un registro ya liquidado no se pisa con una predicción posterior.
 *   4. Los mercados conservan selección y probabilidad al reiniciar.
 *
 * Usa un puerto propio y un directorio temporal: nunca toca `server/data`
 * (historial real del usuario) ni la base PostgreSQL configurada.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { construirEntradasDesdeArtefacto } = require('../historial-artefacto');

const PUERTO = 33221;
const CLAVE = 'clave-de-prueba';
const BASE = `http://127.0.0.1:${PUERTO}`;
const DIR = __dirname;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fulbito-persistencia-'));
const FECHA_PASADA = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
// Artefacto trampa: el proxy debe rechazarlo por estar marcado como ejemplo.
const ARTEFACTO_EJEMPLO = 'data:application/json,' + encodeURIComponent(JSON.stringify({
  generadoEn: 'ejemplo',
  datosDeEjemplo: true,
  pronosticos: { '999': { partido: { id: '999' }, pronosticos: { seleccionados: [] } } }
}));

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
      env: {
        ...process.env,
        PORT: String(PUERTO),
        HISTORIAL_API_KEY: CLAVE,
        DATABASE_URL: '',
        FULBITO_DATA_DIR: DATA_DIR,
        FULBITO_AUTO_TRACK_RECORD: 'false',
        // Fuerza el proxy a descargar un artefacto de ejemplo: debe rechazarlo
        // y caer a la copia local commiteada, sin depender de GitHub.
        FULBITO_ARTIFACT_URL: ARTEFACTO_EJEMPLO
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    if (hijo.stderr) {
      hijo.stderr.on('data', (trozo) => {
        stderr = (stderr + trozo.toString()).slice(-8000);
      });
    }
    const detalleError = () => stderr.trim() ? `\n--- stderr del servidor ---\n${stderr.trim()}` : '';
    let intervalo = null;
    const esperar = Date.now() + 15000;
    let resuelto = false;
    const parar = () => { if (intervalo) clearInterval(intervalo); };
    hijo.once('exit', (codigo) => {
      if (!resuelto) {
        parar();
        reject(new Error(`el servidor terminó antes de iniciar (exit=${codigo})${detalleError()}`));
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

async function leerStats() {
  const r = await fetch(`${BASE}/api/historial/stats`);
  return r.json();
}

async function postJson(ruta, cuerpo, conKey = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (conKey) headers['X-Api-Key'] = CLAVE;
  const r = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch (e) {}
  return { status: r.status, ok: r.ok, datos, texto };
}

const ENTRADA_BASE = {
  partidoId: 123,
  local: 'Alianza',
  visita: 'U',
  liga: 'PL',
  fecha: FECHA_PASADA,
  mercados: [
    { categoria: 'resultado', parametros: { lado: 'local' }, seleccion: 'Gana Alianza', probabilidad: 54 }
  ],
  verificado: false
};

const ENTRADAS_NUEVAS = [
  {
    partidoId: 456,
    local: 'Equipo A',
    visita: 'Equipo B',
    liga: 'PL',
    fecha: FECHA_PASADA,
    mercados: [
      { categoria: 'resultado', parametros: { lado: 'local' }, seleccion: 'Gana A', probabilidad: 55 },
      { categoria: 'btts', parametros: { si: true }, seleccion: 'Ambos anotan: Sí', probabilidad: 61 }
    ],
    verificado: false
  },
  {
    partidoId: 789,
    local: 'Equipo C',
    visita: 'Equipo D',
    liga: 'SA',
    fecha: FECHA_PASADA,
    mercados: [
      { categoria: 'totalgoles', parametros: { linea: 2.5, direccion: 'mas' }, seleccion: 'Más de 2.5 goles', probabilidad: 58 }
    ],
    verificado: false
  }
];

async function main() {
  console.log('=== TEST DE PERSISTENCIA DEL SERVIDOR ===');

  // La conversión artefacto -> historial es la base del track record: solo
  // deben entrar partidos futuros, programados y con mercados.
  const ahoraFijo = Date.parse('2026-11-07T12:00:00Z');
  const artefactoPrueba = {
    generadoEn: '2026-11-07T08:00:00Z',
    pronosticos: {
      'futuro': {
        partido: {
          id: 'futuro',
          homeTeam: { name: 'Local FC' },
          awayTeam: { name: 'Visita FC' },
          competition: { name: 'Liga de Prueba' },
          utcDate: '2026-11-07T14:00:00Z',
          status: 'TIMED'
        },
        pronosticos: {
          seleccionados: [
            { categoria: 'resultado', parametros: { lado: 'local' }, seleccion: 'Gana Local FC', probabilidad: 55 }
          ]
        }
      },
      'pasado': {
        partido: { id: 'pasado', utcDate: '2026-11-07T10:00:00Z', status: 'TIMED' },
        pronosticos: { seleccionados: [{ categoria: 'resultado', probabilidad: 50 }] }
      },
      'finalizado': {
        partido: { id: 'finalizado', utcDate: '2026-11-07T14:00:00Z', status: 'FINISHED' },
        pronosticos: { seleccionados: [{ categoria: 'resultado', probabilidad: 50 }] }
      }
    }
  };
  const entradasPrueba = construirEntradasDesdeArtefacto(artefactoPrueba, ahoraFijo);
  check(
    'el artefacto solo aporta partidos futuros y programados',
    entradasPrueba.length === 1 && entradasPrueba[0].partidoId === 'futuro' &&
      entradasPrueba[0].local === 'Local FC' && entradasPrueba[0].visita === 'Visita FC' &&
      entradasPrueba[0].liga === 'Liga de Prueba' && entradasPrueba[0].mercados.length === 1,
    JSON.stringify(entradasPrueba)
  );
  check(
    'un artefacto marcado como ejemplo no aporta entradas',
    construirEntradasDesdeArtefacto({ datosDeEjemplo: true, ...artefactoPrueba }, ahoraFijo).length === 0
  );

  const hijo1 = await arrancarServidor();
  try {
    const rPost = await postJson('/api/historial', { historial: [ENTRADA_BASE] });
    check('POST con X-Api-Key guarda el historial', rPost.ok && rPost.datos.total === 1, rPost.texto);

    const rSinKey = await postJson('/api/historial', { historial: [ENTRADA_BASE] }, false);
    check('POST sin X-Api-Key es rechazado (401)', rSinKey.status === 401, `status=${rSinKey.status}`);

    const rIngestSinKey = await postJson('/api/historial/ingest', { historial: ENTRADAS_NUEVAS }, false);
    check('POST ingest sin X-Api-Key es rechazado (401)', rIngestSinKey.status === 401, `status=${rIngestSinKey.status}`);

    const rIngest = await postJson('/api/historial/ingest', { historial: ENTRADAS_NUEVAS });
    check(
      'POST ingest inserta solo los partidos nuevos',
      rIngest.ok && rIngest.datos.insertados === 2 && rIngest.datos.omitidos === 0 && rIngest.datos.total === 3,
      rIngest.texto
    );

    const rIngest2 = await postJson('/api/historial/ingest', { historial: ENTRADAS_NUEVAS });
    check(
      'POST ingest es idempotente',
      rIngest2.ok && rIngest2.datos.insertados === 0 && rIngest2.datos.omitidos === 2 && rIngest2.datos.total === 3,
      rIngest2.texto
    );

    let historial = await leerHistorial();
    const entrada456 = historial.find((h) => String(h.partidoId) === '456');
    const mercado456 = entrada456 && entrada456.mercados && entrada456.mercados[0];
    check(
      'los mercados conservan selección y probabilidad',
      Boolean(mercado456) && mercado456.seleccion === 'Gana A' && mercado456.probabilidad === 55,
      JSON.stringify(mercado456)
    );

    // Liquidamos manualmente la entrada 456 con el historial completo (el POST
    // legacy reemplaza el archivo, igual que hace el cliente).
    const conLiquidado = historial.map((h) => String(h.partidoId) === '456'
      ? { ...h, verificado: true, marcadorFinal: '2-1', liquidadoEn: new Date().toISOString() }
      : h);
    const rLiquidar = await postJson('/api/historial', { historial: conLiquidado });
    check('una entrada se puede marcar como liquidada', rLiquidar.ok, rLiquidar.texto);

    const rIngest3 = await postJson('/api/historial/ingest', { historial: [ENTRADAS_NUEVAS[0]] });
    historial = await leerHistorial();
    const entrada456Liquidada = historial.find((h) => String(h.partidoId) === '456');
    check(
      'el ingest no pisa un registro ya liquidado',
      rIngest3.ok && rIngest3.datos.insertados === 0 &&
        Boolean(entrada456Liquidada) && entrada456Liquidada.verificado === true &&
        entrada456Liquidada.marcadorFinal === '2-1',
      JSON.stringify(entrada456Liquidada)
    );

    const stats = await leerStats();
    check('stats refleja total y verificados', stats.total === 3 && stats.verificados === 1, JSON.stringify(stats));

    const rProxy = await fetch(`${BASE}/api/pronosticos`);
    const proxyDatos = await rProxy.json();
    check(
      'GET /api/pronosticos descarta el ejemplo y usa la copia local',
      rProxy.ok && rProxy.headers.get('x-fulbito-fuente') === 'local' &&
        Boolean(proxyDatos.pronosticos) && Object.keys(proxyDatos.pronosticos).length > 0 &&
        proxyDatos.generadoEn !== 'ejemplo' && !proxyDatos.pronosticos['999'],
      `status=${rProxy.status} fuente=${rProxy.headers.get('x-fulbito-fuente')} generadoEn=${proxyDatos.generadoEn}`
    );

    const rCorsOk = await fetch(`${BASE}/health`, {
      headers: { Origin: 'https://kkkxxxs.github.io' }
    });
    check(
      'un origen permitido recibe la cabecera CORS',
      rCorsOk.ok && rCorsOk.headers.get('access-control-allow-origin') === 'https://kkkxxxs.github.io',
      `status=${rCorsOk.status} ACAO=${rCorsOk.headers.get('access-control-allow-origin')}`
    );

    const rCorsNo = await fetch(`${BASE}/health`, {
      headers: { Origin: 'https://origen-no-permitido.example' }
    });
    check(
      'un origen no permitido no recibe CORS y tampoco un 500',
      rCorsNo.status === 200 && rCorsNo.headers.get('access-control-allow-origin') === null,
      `status=${rCorsNo.status} ACAO=${rCorsNo.headers.get('access-control-allow-origin')}`
    );

    // Esperar a que el debounce de escritura (500ms) persista en la DB antes de reiniciar.
    await new Promise((resolve) => setTimeout(resolve, 800));
  } finally {
    await detener(hijo1);
  }

  const hijo2 = await arrancarServidor();
  try {
    const historial = await leerHistorial();
    check('el historial sobrevive al reinicio del servidor', historial.length === 3, JSON.stringify(historial));

    const entrada456 = historial.find((h) => String(h.partidoId) === '456');
    check(
      'el estado liquidado sobrevive al reinicio',
      Boolean(entrada456) && entrada456.verificado === true && entrada456.marcadorFinal === '2-1',
      JSON.stringify(entrada456)
    );

    const mercado456 = entrada456 && entrada456.mercados && entrada456.mercados[0];
    check(
      'los campos de mercado sobreviven al reinicio',
      Boolean(mercado456) && mercado456.seleccion === 'Gana A' && mercado456.probabilidad === 55,
      JSON.stringify(mercado456)
    );

    const rIngest4 = await postJson('/api/historial/ingest', { historial: ENTRADAS_NUEVAS });
    check(
      'el ingest sigue siendo idempotente tras el reinicio',
      rIngest4.ok && rIngest4.datos.insertados === 0 && rIngest4.datos.omitidos === 2,
      rIngest4.texto
    );
  } finally {
    await detener(hijo2);
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS'} ===`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(1);
});
