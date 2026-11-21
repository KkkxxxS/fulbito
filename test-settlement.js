/**
 * Contrato de liquidación: cliente (app-model.js) y servidor (liquidacion.js).
 *
 * Usa los mismos fixtures que test_settlement.py. Si el cliente y el servidor
 * no coinciden con el contrato, el track record deja de ser confiable.
 *
 * Ejecutar: node test-settlement.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const liquidacion = require('./server/liquidacion.js');
const RUTA_FIXTURES = path.join(__dirname, 'tests', 'fixtures', 'settlement.json');

function cargarCliente() {
  const codigo = fs.readFileSync(path.join(__dirname, 'app-model.js'), 'utf8');
  const sandbox = {
    console, Math, Date, JSON, Number, Object, Array, String, Set, Map,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: {
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => [],
      getElementById: () => ({
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} }
      })
    },
    window: {},
    history: { replaceState() {} },
    location: { hash: '' },
    requestAnimationFrame: (cb) => cb(0),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  return sandbox;
}

function main() {
  console.log('=== CONTRATO DE LIQUIDACION (cliente + servidor) ===');

  let fixtures;
  try {
    fixtures = JSON.parse(fs.readFileSync(RUTA_FIXTURES, 'utf8'));
  } catch (e) {
    console.error(`[FALLA] No se pudieron cargar los fixtures: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const casos = fixtures.casos || [];
  const sandbox = cargarCliente();
  const cliente = sandbox.verificarMercado;

  if (typeof cliente !== 'function') {
    console.error('[FALLA] app-model.js no expone verificarMercado');
    process.exitCode = 1;
    return;
  }
  if (typeof liquidacion.verificarMercado !== 'function') {
    console.error('[FALLA] liquidacion.js no expone verificarMercado');
    process.exitCode = 1;
    return;
  }

  let fallos = 0;
  for (const caso of casos) {
    const esperado = Boolean(caso.esperado);
    const args = [caso.categoria, caso.parametros || {}, caso.gl, caso.gv];

    let obtenidoCliente;
    let obtenidoServidor;
    let error = '';
    try {
      obtenidoCliente = Boolean(cliente(...args));
      obtenidoServidor = Boolean(liquidacion.verificarMercado(...args));
    } catch (e) {
      error = ` (${e.name}: ${e.message})`;
    }

    const ok = obtenidoCliente === esperado && obtenidoServidor === esperado;
    if (!ok) {
      fallos += 1;
      console.log(
        `  [FALLA] ${caso.id}: esperado=${esperado} cliente=${obtenidoCliente} servidor=${obtenidoServidor}${error}`
      );
    } else {
      console.log(`  [OK   ] ${caso.id}`);
    }
  }

  console.log(`\n=== RESULTADO: ${casos.length - fallos}/${casos.length} OK ===`);
  if (fallos) process.exitCode = 1;
}

main();
