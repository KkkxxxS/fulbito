/**
 * liquidacion.js
 *
 * Liquidación server-side del track record: cruza los pronósticos registrados
 * en el pool global contra los resultados reales de partidos terminados y
 * sella cada mercado como acierto/fallo.
 *
 * Funciones puras y sin I/O: la persistencia y el fetch se hacen en server.js.
 * `verificarMercado` es un espejo exacto de la versión del cliente
 * (app-model.js verificarMercado) para que el resultado sea idéntico.
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
    case 'totalgoles': {
      const total = gl + gv;
      return p.direccion === 'menos' ? total < p.linea : total > p.linea;
    }
    case 'btts': {
      const ambos = gl >= 1 && gv >= 1;
      return p.si ? ambos : !ambos;
    }
    case 'equipomarca':
      return p.lado === 'local' ? gl >= 1 : gv >= 1;
    case 'handicap': {
      const margen = p.lado === 'local' ? (gl - gv) : (gv - gl);
      return margen >= p.valor;
    }
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

function marcadorDePartido(partido) {
  const score = partido && partido.score;
  if (!score) return null;
  const ft = score.fullTime || score.regularTime || score;
  if (!ft || ft.home === null || ft.away === null || ft.home === undefined || ft.away === undefined) return null;
  const gl = Number(ft.home);
  const gv = Number(ft.away);
  if (!Number.isFinite(gl) || !Number.isFinite(gv)) return null;
  return { local: gl, visita: gv };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Divide un rango de fechas en bloques cuya diferencia no supere `maxDias`.
 * football-data.org rechaza períodos con más de 10 días de diferencia con
 * HTTP 400 ("Specified period must not exceed 10 days").
 * Devuelve fechas `YYYY-MM-DD` en UTC, contiguas y sin solaparse.
 */
function rangosDeFechas(desde, hasta, maxDias = 10) {
  const inicio = new Date(desde);
  const fin = new Date(hasta);
  if (!Number.isFinite(inicio.getTime()) || !Number.isFinite(fin.getTime()) || inicio > fin) return [];

  const max = Math.max(0, Math.floor(maxDias));
  const inicioDia = Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate());
  const finDia = Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate());
  const rangos = [];
  let cursor = inicioDia;
  while (cursor <= finDia) {
    const finRango = Math.min(cursor + max * DIA_MS, finDia);
    rangos.push({
      dateFrom: new Date(cursor).toISOString().slice(0, 10),
      dateTo: new Date(finRango).toISOString().slice(0, 10)
    });
    cursor = finRango + DIA_MS;
  }
  return rangos;
}

/**
 * Liquida un historial contra un mapa de partidos terminados.
 * Devuelve el historial completo con los pendientes sellados. No muta la entrada.
 *
 * @param {Array} historial entradas del pool global
 * @param {Object|Map} mapaResultados id de partido -> partido (con score)
 * @returns {{ historial: Array, liquidados: number }}
 */
function liquidarHistorial(historial, mapaResultados) {
  if (!Array.isArray(historial)) return { historial: [], liquidados: 0 };
  const get = mapaResultados instanceof Map
    ? (id) => mapaResultados.get(id)
    : (id) => mapaResultados && mapaResultados[id];

  let liquidados = 0;
  const resultado = historial.map(registro => {
    if (!registro || registro.verificado) return registro;
    const partido = get(registro.partidoId);
    if (!partido) return registro;
    const marcador = marcadorDePartido(partido);
    if (!marcador) return registro;

    liquidados += 1;
    return {
      ...registro,
      mercados: evaluarMercados(registro.mercados, marcador.local, marcador.visita),
      verificado: true,
      marcadorFinal: `${marcador.local}-${marcador.visita}`,
      liquidadoEn: new Date().toISOString()
    };
  });

  return { historial: resultado, liquidados };
}

module.exports = {
  CATEGORIAS_SOPORTADAS,
  verificarMercado,
  evaluarMercados,
  marcadorDePartido,
  rangosDeFechas,
  liquidarHistorial
};
