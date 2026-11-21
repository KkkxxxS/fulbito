/**
 * test-recovery.js — Pruebas del servicio de recuperación de contraseñas (Fase 9).
 *
 * Cubre: entropía de tokens, hashes, y las rutas sin DB (motivos).
 * Ejecutar: npm run test:recovery
 */
let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) console.log(`  [OK ] ${nombre}`);
  else { fallos++; console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`); }
}

console.log('=== TEST DE RECOVERY (Fase 9) ===');

(async () => {
  const db = require('./db');
  const recovery = require('./services/recovery');

  const t1 = recovery.generarToken();
  const t2 = recovery.generarToken();
  check('token hex 64 caracteres', /^[0-9a-f]{64}$/.test(t1), t1);
  check('tokens distintos', t1 !== t2);
  check('hashToken igual para mismo token', recovery.hashToken(t1) === recovery.hashToken(t1));
  check('hashToken distintos', recovery.hashToken(t1) !== recovery.hashToken(t2));
  check('hashToken hex 64', /^[0-9a-f]{64}$/.test(recovery.hashToken('x')));

  if (!db.disponible()) {
    const r = await recovery.validarToken('tok_invalido');
    check('validarToken sin DB: motivo db_no_disponible', r.motivo === 'db_no_disponible', JSON.stringify(r));
    const c = await recovery.crearTokenRecuperacion('a@b.c');
    check('crearToken sin DB: motivo db_no_disponible', c.motivo === 'db_no_disponible', JSON.stringify(c));
  }

  const sinEmail = await recovery.crearTokenRecuperacion('');
  check('crearToken sin email: email_requerido', sinEmail.motivo === 'email_requerido', JSON.stringify(sinEmail));

  const rr = await recovery.restablecerContrasena('u', '12345678');
  check('restablecer sin DB: usuario_no_encontrado o db_no_disponible',
    ['usuario_no_encontrado', 'db_no_disponible'].includes(rr.motivo), JSON.stringify(rr));

  console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
  process.exit(fallos === 0 ? 0 : 1);
})();
