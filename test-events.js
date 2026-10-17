/*
 * test-events.js — pruebas del despachador central (events.js).
 *
 * Verifica que cada `data-action` del shell enrute a la función correcta
 * con los argumentos correctos, y que los casos borde (acción desconocida,
 * teclado en no-botones, clics dentro de un <summary>) no disparen nada.
 *
 * DOM falso mínimo pero funcional: soporta closest, dataset, listeners y
 * el despacho de eventos con preventDefault.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function ok(nombre, cond) {
  console.log(`  [${cond ? 'OK  ' : 'FALLA'}] ${nombre}`);
  if (!cond) fallos++;
}

// ---- mini-DOM ----
function crearElemento(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    dataset: {},
    _attrs: {},
    _listeners: {},
    _padre: null,
    className: attrs.class || '',
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    closest(sel) {
      let n = this;
      while (n) {
        if (coincide(n, sel)) return n;
        n = n._padre;
      }
      return null;
    }
  };
  // pasa datos tipo data-vista="inicio" a dataset.camelCase
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[camel] = String(v);
    } else {
      el._attrs[k] = String(v);
    }
  }
  return el;
}
function coincide(el, sel) {
  if (sel === '[data-action]') return 'action' in el.dataset;
  if (sel === 'summary') return el.tagName === 'SUMMARY';
  if (sel.startsWith('.')) return (el.className || '').split(/\s+/).includes(sel.slice(1));
  return false;
}
function append(padre, hijo) { hijo._padre = padre; return hijo; }

// ---- contexto ----
const win = {
  cambiarVista: (v) => llamadas.push(['cambiarVista', v]),
  cambiarDeporte: (k) => llamadas.push(['cambiarDeporte', k]),
  cambiarFecha: (t, e) => llamadas.push(['cambiarFecha', t, !!e]),
  filtrarAnalitica: (c, e) => llamadas.push(['filtrarAnalitica', c, !!e]),
  mostrarSelectorFecha: (e) => llamadas.push(['mostrarSelectorFecha', !!e]),
  aplicarFechaPersonalizada: () => llamadas.push(['aplicarFechaPersonalizada']),
  alternarPerfil: (e) => llamadas.push(['alternarPerfil', !!e]),
  enfocarBuscador: (e) => llamadas.push(['enfocarBuscador', !!e]),
  alternarIdioma: () => llamadas.push(['alternarIdioma']),
  toggleMenuMovil: () => llamadas.push(['toggleMenuMovil']),
  toggleSidebarDesktop: () => llamadas.push(['toggleSidebarDesktop']),
  cerrarMenuMovil: () => llamadas.push(['cerrarMenuMovil']),
  scrollTo: (o) => llamadas.push(['scrollTo', o && o.top]),
  location: { reload: () => llamadas.push(['reload']), protocol: 'https:' },
  enviarAuth: (e, modo) => llamadas.push(['enviarAuth', modo, !!e]),
  onBuscar: (v) => llamadas.push(['onBuscar', v]),
  sincronizarBusquedaDashboard: (v) => llamadas.push(['syncDash', v]),
  onBuscarIntegrado: (v) => llamadas.push(['onBuscarIntegrado', v]),
  abrirCombinadaAsistida: () => llamadas.push(['abrirCombinadaAsistida']),
  exportarDatos: () => llamadas.push(['exportarDatos']),
  importarDatos: (e) => llamadas.push(['importarDatos', !!e])
};
const llamadas = [];
const docListeners = {};
const document = {
  readyState: 'complete',
  getElementById: () => null,
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }
};
win.document = document;
win.window = win;
win.scrollTo = win.scrollTo;
win.__fulbitoAcciones = null;
const ctx = vm.createContext(win);
ctx.window = win;
ctx.document = document;
ctx.console = console;

// carga events.js
vm.runInContext(fs.readFileSync(path.join(__dirname, 'events.js'), 'utf8'), ctx, { filename: 'events.js' });

function disparar(tipo, target, extra = {}) {
  let prevenido = false;
  const ev = Object.assign({
    type: tipo, target,
    preventDefault() { prevenido = true; }
  }, extra);
  (docListeners[tipo] || []).forEach((fn) => fn(ev));
  return prevenido;
}

// ---- casos ----
console.log('events.js: despachador de acciones');

const navInicio = crearElemento('button', { 'data-action': 'cambiar-vista', 'data-vista': 'inicio' });
disparar('click', navInicio);
ok('click cambiar-vista enruta con data-vista', llamadas.some(c => c[0] === 'cambiarVista' && c[1] === 'inicio'));

const depTenis = crearElemento('button', { 'data-action': 'cambiar-deporte', 'data-deporte': 'tenis' });
disparar('click', depTenis);
ok('click cambiar-deporte enruta con data-deporte', llamadas.some(c => c[0] === 'cambiarDeporte' && c[1] === 'tenis'));

const fechaHoy = crearElemento('button', { 'data-action': 'cambiar-fecha', 'data-fecha': 'hoy' });
disparar('click', fechaHoy);
ok('click cambiar-fecha inyecta el evento', llamadas.some(c => c[0] === 'cambiarFecha' && c[1] === 'hoy' && c[2] === true));

const filtroBtts = crearElemento('button', { 'data-action': 'filtrar-analitica', 'data-categoria': 'btts' });
disparar('click', filtroBtts);
ok('click filtrar-analitica pasa categoría y evento', llamadas.some(c => c[0] === 'filtrarAnalitica' && c[1] === 'btts'));

const form = crearElemento('form', { 'data-action': 'enviar-auth', 'data-modo': 'register' });
disparar('submit', form);
ok('submit enviar-auth usa data-modo del form', llamadas.some(c => c[0] === 'enviarAuth' && c[1] === 'register'));

const inputBusqueda = crearElemento('input', { 'data-action': 'buscar', 'data-origen': 'sidebar' });
inputBusqueda.value = 'real madrid';
disparar('input', inputBusqueda);
ok('input buscar usa data-origen para elegir la función', llamadas.some(c => c[0] === 'onBuscar' && c[1] === 'real madrid'));

const inputIntegrado = crearElemento('input', { 'data-action': 'buscar', 'data-origen': 'integrado' });
inputIntegrado.value = 'barcelona';
disparar('input', inputIntegrado);
ok('input buscar origen=integrado usa onBuscarIntegrado', llamadas.some(c => c[0] === 'onBuscarIntegrado' && c[1] === 'barcelona'));

// casos borde
const antesLen = llamadas.length;
const sinAccion = crearElemento('div', {});
disparar('click', sinAccion);
ok('click sin data-action no dispara nada', llamadas.length === antesLen);

const accionFantasma = crearElemento('button', { 'data-action': 'no-existe' });
let lanzo = false;
try { disparar('click', accionFantasma); } catch (e) { lanzo = true; }
ok('acción desconocida no lanza excepción', !lanzo);

const spanKey = crearElemento('span', { 'data-action': 'cambiar-vista', 'data-vista': 'voley' });
disparar('keydown', spanKey, { key: 'Enter' });
ok('keydown en no-botón NO dispara la acción', !llamadas.some(c => c[0] === 'cambiarVista' && c[1] === 'voley'));

const botonKey = crearElemento('button', { 'data-action': 'cambiar-vista', 'data-vista': 'ranking' });
disparar('keydown', botonKey, { key: 'Enter' });
ok('keydown Enter en botón SÍ dispara la acción', llamadas.some(c => c[0] === 'cambiarVista' && c[1] === 'ranking'));

const resumen = crearElemento('summary', {});
const dentroResumen = append(resumen, crearElemento('button', { 'data-action': 'cambiar-vista', 'data-vista': 'live' }));
disparar('click', dentroResumen);
ok('click dentro de <summary> no dispara la acción', !llamadas.some(c => c[0] === 'cambiarVista' && c[1] === 'live'));

console.log(`\n=== EVENTS: ${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`} ===`);
process.exit(fallos === 0 ? 0 : 1);
