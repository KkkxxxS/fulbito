/**
 * test-frontend-namespaces.js — Pruebas de modularidad del frontend (Fase 10, en curso).
 *
 * Verifica reglas verificables hoy:
 *   - `index.html` sin `<script>` inline (solo ld+json).
 *   - Todos los `<script>` externos.
 *   - `bootstrap.js` es el shell sincrónico (sin defer).
 *   - `app-init.js` define `window.FULBITO` (namespace raíz).
 *   - Los módulos existen (frontend/README.md documenta el plan).
 *
 * Ejecutar: npm run test:frontend-namespaces
 */
const fs = require('fs');
const path = require('path');

let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) console.log(`  [OK ] ${nombre}`);
  else { fallos++; console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`); }
}

console.log('=== TEST DE NAMESPACES DEL FRONTEND (Fase 10) ===');

const root = path.join(__dirname, '..');
function leer(archivo) {
  return fs.readFileSync(path.join(root, archivo), 'utf8');
}

// 1. index.html: sin scripts inline; todos con src.
const index = leer('index.html');
const tagRegex = /<script([^>]*)>/g;
const tags = [];
let m;
while ((m = tagRegex.exec(index)) !== null) tags.push(m[1]);
const scriptsExternos = tags.filter(a => !a.includes('ld+json'));
const noInline = scriptsExternos.every(a => /src=/.test(a));
check('index.html: sin <script> inline', noInline, JSON.stringify(tags));
const bootstrapTag = tags.find(a => /src="bootstrap\.js/.test(a));
check('index.html: bootstrap.js sin defer', !!bootstrapTag && !bootstrapTag.includes('defer'), JSON.stringify(bootstrapTag));

// 2. bootstrap.js y app-init.js garantizan window.FULBITO (namespace raíz).
check('bootstrap.js define global.FULBITO', /global\.FULBITO\s*=\s*global\.FULBITO\s*\|\|/.test(leer('bootstrap.js')));
const appInit = leer('app-init.js');
check('app-init.js define window.FULBITO', /window\.FULBITO\s*=\s*window\.FULBITO\s*\|\|/.test(appInit));

// 3. Los módulos del plan existen.
const modulos = ['bootstrap.js', 'menu-toggle.js', 'i18n.js', 'auth.js', 'v-multideporte.js',
  'app-animaciones.js', 'app-model.js', 'app-ui.js', 'app-init.js', 'events.js', 'frontend/README.md'];
for (const mod of modulos) {
  check(`archivo existe: ${mod}`, fs.existsSync(path.join(root, mod)));
}

// 4. frontend/README.md documenta los namespaces.
const readme = leer('frontend/README.md');
check('frontend/README.md define namespaces (FULBITO.*)', /FULBITO\.(menu|i18n|auth|deportes|animaciones|model|render|app|events)/.test(readme));

console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
process.exit(fallos === 0 ? 0 : 1);
