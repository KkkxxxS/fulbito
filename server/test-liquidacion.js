/**
 * test-liquidacion.js
 *
 * Test unitario de server/liquidacion.js: verifica que el espejo server-side de
 * `verificarMercado` coincida con el del cliente y que `liquidarHistorial` selle
 * correctamente los pendientes, sea idempotente y no toque entradas ya verificadas.
 */
const assert = require('assert');
const { verificarMercado, evaluarMercados, marcadorDePartido, liquidarHistorial } = require('./liquidacion');

let pasadas = 0;
let fallidas = 0;

function check(nombre, condicion) {
  if (condicion) { pasadas++; console.log(`  [OK ] ${nombre}`); }
  else { fallidas++; console.error(`  [FALLA] ${nombre}`); }
}

console.log('=== TEST LIQUIDACION SERVER-SIDE ===');

console.log('\n1. verificarMercado (espejo de app-model.js)');
check('resultado local gana', verificarMercado('resultado', { lado: 'local' }, 2, 1) === true);
check('resultado visita gana', verificarMercado('resultado', { lado: 'visita' }, 1, 2) === true);
check('resultado empate', verificarMercado('resultado', {}, 1, 1) === true);
check('doble 1X con empate', verificarMercado('doble', { lado: '1X' }, 1, 1) === true);
check('doble 12 con empate falla', verificarMercado('doble', { lado: '12' }, 1, 1) === false);
check('totalgoles mas 2.5 (3)', verificarMercado('totalgoles', { direccion: 'mas', linea: 2.5 }, 2, 1) === true);
check('totalgoles menos 2.5 (2)', verificarMercado('totalgoles', { direccion: 'menos', linea: 2.5 }, 1, 1) === true);
check('btts si', verificarMercado('btts', { si: true }, 1, 1) === true);
check('btts no', verificarMercado('btts', { si: false }, 2, 0) === true);
check('equipomarca local', verificarMercado('equipomarca', { lado: 'local' }, 1, 0) === true);
check('handicap local -1 (2-0)', verificarMercado('handicap', { lado: 'local', valor: 2 }, 3, 1) === true);
check('dnb local', verificarMercado('dnb', { lado: 'local' }, 2, 1) === true);
check('dnb empate no aplica', verificarMercado('dnb', { lado: 'local' }, 1, 1) === false);
check('marcador exacto', verificarMercado('marcador', { gl: 2, gv: 1 }, 2, 1) === true);
check('categoria desconocida', verificarMercado('raro', {}, 1, 0) === false);
check('marcador no numerico', verificarMercado('resultado', { lado: 'local' }, null, 1) === false);

console.log('\n2. marcadorDePartido');
check('score.fullTime', JSON.stringify(marcadorDePartido({ score: { fullTime: { home: 2, away: 1 } } })) === '{"local":2,"visita":1}');
check('score null', marcadorDePartido({ score: { fullTime: { home: null, away: 1 } } }) === null);
check('sin score', marcadorDePartido({}) === null);

console.log('\n3. liquidarHistorial');
const historial = [
  { partidoId: '1', verificado: false, mercados: [{ categoria: 'resultado', parametros: { lado: 'local' }, probabilidad: 60 }] },
  { partidoId: '2', verificado: true, marcadorFinal: '0-0', mercados: [{ categoria: 'resultado', parametros: { lado: 'local' }, acierto: false }] },
  { partidoId: '3', verificado: false, mercados: [{ categoria: 'btts', parametros: { si: true }, probabilidad: 55 }] }
];
const mapa = new Map([
  ['1', { status: 'FINISHED', score: { fullTime: { home: 3, away: 1 } } }],
  ['2', { status: 'FINISHED', score: { fullTime: { home: 0, away: 0 } } }]
]);
const r1 = liquidarHistorial(historial, mapa);
check('liquidó 1 partido (el otro sin resultado)', r1.liquidados === 1);
check('partido 1 marcado verificado', r1.historial[0].verificado === true);
check('partido 1 acierto correcto', r1.historial[0].mercados[0].acierto === true);
check('partido 1 marcadorFinal', r1.historial[0].marcadorFinal === '3-1');
check('partido 2 intacto', r1.historial[1].marcadorFinal === '0-0' && r1.historial[1].mercados[0].acierto === false);
check('partido 3 sigue pendiente', r1.historial[2].verificado === false);

const r2 = liquidarHistorial(r1.historial, mapa);
check('idempotente: segunda corrida liquida 0', r2.liquidados === 0);

console.log(`\n=== RESULTADO: ${pasadas} OK, ${fallidas} FALLAS ===`);
process.exit(fallidas === 0 ? 0 : 1);
