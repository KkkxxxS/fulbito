# -*- coding: utf-8 -*-
"""Control de calidad de los datos de entrada del motor (Fase 5.1).

Checks sobre las muestras del dataset de calibración (paridad con las
muestras que salen de `muestras_pendientes()`/`construir_dataset()` en
recalibración.py):
  - duplicados: misma clave (partidoId, liga, categoria, seleccion, gl, gv, fecha).
  - marcadores_invalidos: `pPredicha` fuera de [0,1] o `y` no binario.
  - frescura: fechas con más de DIAS_FRESCURA días de antigüedad.
  - cobertura_ligas: menos de LIGAS_MINIMAS_REQUERIDAS ligas con >= 5 muestras.

Ejecutar: python test_data_quality.py
"""

from datetime import datetime, timedelta, timezone

DIAS_FRESCURA = 2
LIGAS_MINIMAS_REQUERIDAS = 4  # Fase 5.1: >=4 ligas con >=5 partidos


def _fecha_a_datetime(fecha):
    """Parsea ISO con Z; None si no parsea."""
    if fecha is None or isinstance(fecha, datetime):
        return fecha if isinstance(fecha, datetime) else None
    try:
        d = datetime.fromisoformat(str(fecha).replace('Z', '+00:00'))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except (TypeError, ValueError):
        return None


def verificar_calidad(muestras, opciones=None):
    """Devuelve {'total', 'ok', 'problemas': [{'tipo', 'descripcion', 'cuenta'}]}."""
    opciones = opciones or {}
    frescura_dias = int(opciones.get('diasFrescura', DIAS_FRESCURA))
    ligas_req = int(opciones.get('ligasMinimasRequeridas', LIGAS_MINIMAS_REQUERIDAS))
    problemas = []

    if not muestras:
        problemas.append({'tipo': 'vacío', 'descripcion': 'Sin muestras verificadas', 'cuenta': 0})
        return {'total': 0, 'ok': False, 'problemas': problemas}

    # Duplicados por clave.
    vistos, dupes = set(), 0
    for m in muestras:
        clave = (m.get('partidoId') or '', m.get('liga') or '', m.get('categoria') or '',
                 (m.get('seleccion') or ''), m.get('gl'), m.get('gv'),
                 str(m.get('fecha') or m.get('fechaInicio') or ''))
        if clave in vistos:
            dupes += 1
        else:
            vistos.add(clave)
    if dupes:
        problemas.append({'tipo': 'duplicados',
                          'descripcion': f'{dupes} muestras duplicadas (partidoId/liga/categoria/seleccion/gl/gv/fecha)',
                          'cuenta': dupes})

    # Marcadores inválidos: pPredicha en [0,1], y binario.
    invalidos = 0
    for m in muestras:
        p = m.get('pPredicha')
        if p is None or isinstance(p, bool) or not isinstance(p, (int, float)) or not (0.0 <= float(p) <= 1.0):
            invalidos += 1
            continue
        y = m.get('y')
        if y is not None and y not in (0, 1):
            invalidos += 1
    if invalidos:
        problemas.append({'tipo': 'marcadores_invalidos',
                          'descripcion': 'muestras con pPredicha fuera de [0,1] o y no binario',
                          'cuenta': invalidos})

    # Frescura: fecha parseable más antigua que DIAS_FRESCURA días.
    ahora = datetime.now(timezone.utc)
    f_viejas = 0
    for m in muestras:
        f = _fecha_a_datetime(m.get('fecha') or m.get('fechaInicio'))
        if f is not None and f < ahora - timedelta(days=frescura_dias):
            f_viejas += 1
    if f_viejas:
        problemas.append({'tipo': 'frescura',
                          'descripcion': f'{f_viejas} muestras con fecha más antigua que {frescura_dias} días',
                          'cuenta': f_viejas})

    # Cobertura de ligas.
    conteo = {}
    for m in muestras:
        l = m.get('liga') or 'sin_liga'
        conteo[l] = conteo.get(l, 0) + 1
    ligas_req_cnt = sum(1 for n in conteo.values() if n >= 5)
    if ligas_req_cnt < ligas_req:
        problemas.append({'tipo': 'cobertura_ligas',
                          'descripcion': f'Solo {ligas_req_cnt} ligas con >=5 muestras (requiere {ligas_req})',
                          'cuenta': ligas_req})

    return {'total': len(muestras), 'ok': not problemas, 'problemas': problemas}
