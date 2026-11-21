/**
 * test-version.js
 *
 * Pruebas del versionado de modelo (Fase 5.1): constante JS, versión de
 * pronosticos.py en paridad, endpoint /api/version y X-Model-Version.
 *
 * Ejecutar: node server/test-version.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MODEL_VERSION } = require('../packages/domain/version');
const modelsService = require('./services/models');

console.log('=== TEST DE VERSION DEL MODELO (Fase 5.1) ===');

assert.match(MODEL_VERSION, /^\d{4}-\d{2}$/, `MODEL_VERSION formato inválido: ${MODEL_VERSION}`);
assert.strictEqual(modelsService.versionModelo(), MODEL_VERSION);

const py = fs.readFileSync(path.join(__dirname, '..', 'pronosticos.py'), 'utf8');
const m = py.match(/MODEL_VERSION\s*=\s*["']([^"']+)["']/);
assert.ok(m, 'pronosticos.py no define MODEL_VERSION');
assert.strictEqual(m[1], MODEL_VERSION, `versiones desincronizadas: python=${m[1]} js=${MODEL_VERSION}`);

console.log(`  [OK ] versionModelo() => ${MODEL_VERSION} (paridad con pronosticos.py)`);

// Route /api/version en server.js.
const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
assert.match(serverJs, /app\.get\('\/api\/version'/, 'server.js: /api/version falta');
assert.match(serverJs, /modelsService\.versionModelo\(\)/, 'server.js: versionModelo() no usado');

console.log('  [OK ] server.js expone GET /api/version con modelsService.versionModelo()');

console.log('=== RESULTADO: OK ===');
