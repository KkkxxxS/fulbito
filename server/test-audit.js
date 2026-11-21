/**
 * test-audit.js — Pruebas del servicio de auditoría (Fase 9).
 *
 * Ejecutar: npm run test:audit
 */
let fallos = 0;
function check(nombre, condicion, detalle = '') {
  if (condicion) console.log(`  [OK ] ${nombre}`);
  else { fallos++; console.log(`  [FALLA] ${nombre}${detalle ? ` - ${detalle}` : ''}`); }
}

console.log('=== TEST DE AUDITORÍA (Fase 9) ===');

(async () => {
  const db = require('./db');
  const audit = require('./services/audit');

  const o1 = { accion: 'aprobar_propuesta', actor: 'u1', descripcion: 'ok', ip: '127.0.0.1' };
  const o2 = { ip: '127.0.0.1', descripcion: 'ok', actor: 'u1', accion: 'aprobar_propuesta' };
  check('hashStable ignora orden de claves', audit.hashStable(o1) === audit.hashStable(o2));
  check('hashStable deterministico', audit.hashStable(o1) === audit.hashStable(o1));
  check('hashStable hex 64', /^[0-9a-f]{64}$/.test(audit.hashStable(o1)));
  check('hashStable difiere por contenido', audit.hashStable(o1) !== audit.hashStable({ ...o1, actor: 'u2' }));

  const registro = await audit.registrarAprobacion('aprobar_propuesta', 'op-local', 'revisada', '::1');
  if (db.disponible()) {
    check('registrarAprobacion con DB', registro && registro.ok === true, JSON.stringify(registro));
  } else {
    check('registrarAprobacion sin DB => null', registro === null, JSON.stringify(registro));
  }
  const lista = await audit.listarAuditoria();
  check('listarAuditoria es array', Array.isArray(lista));

  console.log(`\n=== RESULTADO: ${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : 'HAY FALLOS: ' + fallos} ===`);
  process.exit(fallos === 0 ? 0 : 1);
})();
