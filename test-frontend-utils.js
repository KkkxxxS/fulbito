// Pruebas de utilidades del frontend que se pueden ejecutar en Node sin navegador.
// Carga app-model.js y i18n.js en un sandbox tolerante (mismo enfoque que el smoke)
// y verifica el escapado de HTML y la API de idioma.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function mk(nombre = 'el') {
  const fn = function () { return mk(nombre); };
  const base = {
    nodeName: nombre, nodeType: 1, tagName: String(nombre).toUpperCase(),
    style: new Proxy({}, { get: () => () => {}, set: () => true }),
    dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], childNodes: [], value: '', textContent: '', innerHTML: '',
    id: '', className: '', href: '', src: '', type: '', checked: false,
    offsetWidth: 100, offsetHeight: 100, scrollTop: 0, scrollHeight: 1000,
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, insertBefore() {}, replaceChild() {},
    setAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    removeAttribute() {}, closest: () => null, contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    querySelector: () => null, querySelectorAll: () => [],
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    insertAdjacentHTML() {}, cloneNode() { return mk(); },
    toDataURL: () => 'data:,', getContext: () => null,
    ownerDocument: null, parentNode: null, parentElement: null,
    length: 0
  };
  return new Proxy(fn, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === Symbol.iterator) return [][Symbol.iterator].bind([]);
      if (p === 'then') return undefined;
      if (typeof p === 'symbol') return undefined;
      return mk(String(p));
    },
    set(t, p, v) { t[p] = v; return true; },
    has() { return true; }
  });
}

const doc = mk('document');
doc.documentElement = mk('html');
doc.body = mk('body');
doc.head = mk('head');
doc.readyState = 'complete';
doc.visibilityState = 'visible';
doc.cookie = '';
doc.location = { hash: '', href: 'https://kkkxxxs.github.io/fulbito/', pathname: '/fulbito/', search: '' };

const store = new Map();
const sandbox = {
  console, Math, Date, JSON, Number, Object, Array, String, Boolean,
  Set, Map, WeakMap, Promise, Error, TypeError, RangeError, RegExp, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  Intl, URL, URLSearchParams, Uint8Array, Float64Array, ArrayBuffer,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  requestAnimationFrame: (cb) => { try { cb(0); } catch (e) {} },
  cancelAnimationFrame() {},
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  document: doc,
  navigator: { language: 'es-ES', languages: ['es-ES'], userAgent: 'node', clipboard: { writeText: async () => {} } },
  location: doc.location,
  history: { replaceState() {}, pushState() {} },
  performance: { now: () => Date.now() },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  scrollTo() {}, scrollBy() {}, open: () => null, close() {},
  innerWidth: 1280, innerHeight: 800, outerWidth: 1280, outerHeight: 800,
  devicePixelRatio: 1, pageYOffset: 0, scrollX: 0, scrollY: 0,
  Notification: function () { return { permission: 'default' }; },
  CustomEvent: function (t, o) { this.type = t; Object.assign(this, o); },
  Event: function (t) { this.type = t; },
  Motion: undefined,
  alert: () => {}, confirm: () => true, prompt: () => null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const m of ['app-model.js', 'i18n.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, m), 'utf8'), sandbox, { filename: m });
}

let fallos = 0;
function prueba(nombre, fn) {
  try { fn(); console.log(`  [OK  ] ${nombre}`); }
  catch (e) { console.log(`  [FALLA] ${nombre} -> ${e.message}`); fallos++; }
}

prueba('escaparHTML neutraliza etiquetas y comillas', () => {
  const salida = sandbox.escaparHTML('<img src=x onerror="alert(1)"> & \'test\'');
  assert.strictEqual(salida, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;');
});

prueba('escaparHTML maneja null/undefined como cadena vacía', () => {
  assert.strictEqual(sandbox.escaparHTML(null), '');
  assert.strictEqual(sandbox.escaparHTML(undefined), '');
});

prueba('escaparHTML deja el texto plano intacto', () => {
  assert.strictEqual(sandbox.escaparHTML('Real Madrid vs Barcelona'), 'Real Madrid vs Barcelona');
});

prueba('expone la API de idioma (aplicarIdioma/alternarIdioma)', () => {
  assert.strictEqual(typeof sandbox.aplicarIdioma, 'function');
  assert.strictEqual(typeof sandbox.alternarIdioma, 'function');
});

prueba('alternarIdioma cambia y persiste el idioma', () => {
  sandbox.alternarIdioma();
  const guardado = store.get('fulbito_idioma');
  assert.ok(guardado === 'en' || guardado === 'es', 'el idioma guardado debe ser es o en');
});

console.log(`\n=== UTILES FRONTEND: ${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`} ===`);
process.exit(fallos === 0 ? 0 : 1);
