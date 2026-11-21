/**
 * settlement.js
 *
 * Módulo puro: verifica si un mercado es acierto/fallo dado el marcador real.
 * No tiene I/O, no emite side effects y se consume desde:
 *   - server/server.js (liquidación)
 *   - server/liquidacion.js (facade legacy)
 *   - server/test-liquidacion.js
 *
 * Fase 3: extraemos la única implementación de liquidación del servidor a un
 * módulo de dominio. El cliente y Python conservan sus propias copias por
 * paridad aprobada (test:parity); si en el futuro cambia la semántica debe
 * cambiar este archivo + liquidacion.js + app-model.js + pronosticos.py.
 *
 * Contrato unico compartido con tests/fixtures/settlement.json:
 *   Python: pronosticos.verificarMercado
 *   JS cliente: app-model.js verificarMercado
 *   JS servidor: packages/domain/settlement/index.js
 */

const CATEGORIAS_SOPORTADAS = [
  'resultado', 'doble', 'totalgoles', 'btts', 'equipomarca', 'handicap', 'dnb', 'marcador'
];

function verificarMercado(categoria, parametros, golesLocal, golesVisita) {
  const gl = Number(golesLocal);
  const gv = Number(golesVisita);
  if (!Number.isFinite(gl) || !Number.isFinite(gv)) return false;
  const p = parametros || {};

  switch (categoria) {
    case 'resultado':
      if (p.lado === 'local') return gl > gv;
      if (p.lado === 'visita') return gv > gl;
      return gl === gv;
    case 'doble':
      if (p.lado === '1X') return gl >= gv;
      if (p.lado === 'X2') return gv >= gl;
      return gl !== gv;
    case 'totalgoles':
      return p.direccion === 'menos' ? (gl + gv) < p.linea : (gl + gv) > p.linea;
    case 'btts': {
      const ambos = gl >= 1 && gv >= 1;
      return p.si ? ambos : !ambos;
    }
    case 'equipomarca':
      return p.lado === 'local' ? gl >= 1 : gv >= 1;
    case 'handicap':
      return (p.lado === 'local' ? (gl - gv) : (gv - gl)) >= p.valor;
    case 'dnb':
      if (p.lado === 'local') return gl > gv;
      if (p.lado === 'visita') return gv > gl;
      return false;
    case 'marcador':
      return gl === p.gl && gv === p.gv;
    default:
      return false;
  }
}

function evaluarMercados(mercados, golesLocal, golesVisita) {
  if (!Array.isArray(mercados)) return [];
  return mercados.map(m => ({
    ...m,
    acierto: verificarMercado(m.categoria, m.parametros, golesLocal, golesVisita)
  }));
}

module.exports = {
  CATEGORIAS_SOPORTADAS,
  verificarMercado,
  evaluarMercados
};
