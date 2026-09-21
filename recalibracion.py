#!/usr/bin/env python3
"""
Sistema de recalibración supervisada para el motor de pronósticos de Fulbito.

Diseño aprobado (2026-09-20). Principios:
  1. Diagnostica si el motor sub/sobre-estima probabilidades (Brier + curva de
     calibración) y re-ajusta los pesos internos (localía, liga, EWMA, H2H,
     Dixon-Coles rho, límite de tabla, ajuste por categoría) con backtesting
     exacto sobre los partidos ya verificados.
  2. NUNCA aplica cambios directo a producción: genera una PROPUESTA
     (propuesta_recalibracion.json) que el usuario revisa y aprueba o rechaza.
  3. Cada resolución queda en la bitácora (bitacora_recalibracion.jsonl) para
     la sección Transparencia.
  4. Gates de seguridad: mínimo 50 partidos verificados, muestra no sesgada
     por liga (>=4 ligas con >=5 partidos cada una para tocar la localía
     global), movimiento máximo del 5% por corrida, shrinkage bayesiano
     (K=100), validación temporal 70/30 y mejora mínima de Brier 0.005.
  5. Los datos que entran al cálculo pasan sanity-checks (marcadores válidos,
     deduplicación, fechas coherentes y cruce contra el histórico oficial del
     motor) como mitigación parcial del pool público sin autenticación.

Uso:
  python recalibracion.py --modo status        # estado del sistema
  python recalibracion.py --modo diagnostico   # solo lectura: reporta sesgos
  python recalibracion.py --modo propuesta     # genera propuesta si hay cambios
  python recalibracion.py --aprobar <id>       # aplica una propuesta aprobada
  python recalibracion.py --rechazar <id> --motivo "..."

Nota importante: este módulo NO modifica la lógica de cálculo de
pronosticos.py. Solo lee, evalúa y produce archivos. La aplicación de
overrides (fase 4) se habilita en pronosticos.py por separado y solo después
de la primera aprobación manual.
"""

import argparse
import hashlib
import json
import math
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

import numpy as np

# La paridad matemática con el motor es por construcción: importamos las
# funciones puras directamente de pronosticos.py (tiene guard __main__).
# `sumaMatriz` NO se importa: tiene un bug de shadowing de dict.get y devuelve
# sumas de índices en lugar de probabilidades. Ver `sumar_matriz` más abajo.
try:
    from pronosticos import (
        Config,
        poisson,
        matrizMarcadores,
        verificarMercado,
    )
    PRONOSTICOS_IMPORT_OK = True
except Exception as e:  # pragma: no cover
    PRONOSTICOS_IMPORT_OK = False
    _ERROR_IMPORT = e

# ==================== CONFIGURACIÓN DEL SISTEMA ====================

BACKEND_URL = "https://fulbito-forh.onrender.com"
RUTA_HISTORICO = "pronosticos_historicos.jsonl"
RUTA_PROPUESTA = "propuesta_recalibracion.json"
RUTA_BITACORA = "bitacora_recalibracion.jsonl"
RUTA_APROBADOS = "parametros_aprobados.json"

# Gates de muestra (diseño aprobado)
N_MINIMO_PARTIDOS = 50          # mínimo global para proponer cualquier cosa
LIGAS_DISTINTAS_MIN = 4         # ligas mínimas representadas para tocar localía global
PARTIDOS_MIN_POR_LIGA_GLOBAL = 5  # cada una de esas ligas necesita al menos esto
N_MINIMO_POR_LIGA = 30          # para ajustar el factor de liga de UNA liga
N_MINIMO_POR_CATEGORIA = 30     # para Platt / ajuste por categoría
N_MINIMO_FACTOR = 40            # para EWMA / H2H / rho / limiteTabla
VERIFICACIONES_NUEVAS_MIN = 10  # entre propuesta y propuesta

# Conservadurismo (diseño aprobado)
K_SHRINKAGE = 100.0
MOVIMIENTO_MAX_PCT = 0.05       # máximo 5% relativo por corrida
MEJORA_MINIMA_BRIER = 0.005
TOLERANCIA_CRUCE_PROB = 0.03    # ±3 puntos (escala 0-100) al cruzar con el histórico
GOLES_MAX_VALIDO = 12
SPLIT_ENTRENAMIENTO = 0.70      # walk-forward 70/30 por fecha

# Guardia de integridad de la telemetría oficial. Firma del bug de `sumaMatriz`
# en pronosticos.py: todas las probabilidades quedan pegadas al techo del clamp
# (0.92) porque la "probabilidad" es en realidad una suma de índices (84.0).
CLAMP_TECHO = 0.92
MOTOR_DEGENERADO_PCT = 0.50     # >=50% de las muestras en el techo => sospechoso
MOTOR_DEGENERADO_VALORES = 3    # y con <=3 valores distintos en total

# Límites espejo de pronosticos.Config (no se pueden proponer valores fuera de aquí)
LIM_FACTOR_LOCALIA = (1.0, 1.25)
LIM_RHO = (-0.20, 0.05)
LIM_LIMITE_TABLA = (0.03, 0.12)
LIM_POR_CATEGORIA = (0.75, 1.25)
LIM_FACTOR_LIGA_AJUSTADO = (0.90, 1.10)

# Movimientos mínimos absolutos para parámetros pequeños (5% relativo sería ruido)
MOVIMIENTO_MINIMO_ABSOLUTO = {
    "rhoDixonColes": 0.01,
    "limiteTabla": 0.005,
}
# Multiplicador k sobre ajustes (EWMA/H2H): k=1.0 es el comportamiento actual
LIM_MULT_AJUSTE = (0.5, 1.5)

# Valores base del motor (espejo de Config / constantes internas del modelo)
BASE_FACTOR_LOCALIA = getattr(Config, "FACTOR_LOCALIA_BASE", 1.08) if PRONOSTICOS_IMPORT_OK else 1.08
BASE_RHO = getattr(Config, "RHO_DIXON_COLES", -0.04) if PRONOSTICOS_IMPORT_OK else -0.04
BASE_LIMITE_TABLA = getattr(Config, "LIMITE_TABLA_BASE", 0.10) if PRONOSTICOS_IMPORT_OK else 0.10
BASE_PESO_EWMA = 0.30   # constante interna de factorTendencia (pronosticos.py:306)
BASE_H2H_MAX = 0.05     # constante interna de factorH2H (pronosticos.py:421)

# ==================== UTILIDADES ====================

def ahora_utc():
    return datetime.now(timezone.utc).isoformat()


def parsear_fecha(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None


def parsear_marcador(marcador):
    """'2-1' -> (2, 1). None si no es parseable o los goles son absurdos."""
    if not isinstance(marcador, str):
        return None
    partes = marcador.strip().split("-")
    if len(partes) != 2:
        return None
    try:
        gl, gv = int(partes[0]), int(partes[1])
    except ValueError:
        return None
    if gl < 0 or gv < 0 or gl > GOLES_MAX_VALIDO or gv > GOLES_MAX_VALIDO:
        return None
    return gl, gv


def clamp(x, bajo, alto):
    return max(bajo, min(alto, x))


def prob_logit(p):
    p = clamp(p, 0.02, 0.98)
    return math.log(p / (1 - p))


def prob_sigmoide(z):
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def leer_json(ruta, default=None):
    try:
        with open(ruta, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def escribir_json(ruta, datos):
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, indent=2, ensure_ascii=False)


def append_jsonl(ruta, registro):
    with open(ruta, "a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False, separators=(",", ":")) + "\n")


def hash_estable(objeto):
    serial = json.dumps(objeto, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(serial.encode("utf-8")).hexdigest()[:16]


def sumar_matriz(matriz, max_goles, condicion):
    """Suma celdas de la matriz llamando a la función `get` EXPUESTA por la matriz.

    NO se usa `sumaMatriz` de pronosticos.py a propósito: esa función hace
    `matriz.get(i, j)` sobre un `dict`, y en Python `dict.get` es el método del
    diccionario (busca la clave `i`, devuelve el default `j`) — no la lambda
    `'get'` de la matriz. El resultado son sumas de ÍNDICES, no probabilidades
    (para `i > j` con dim=9 devuelve 84.0, la suma de los índices de columna).
    Ese bug está vivo en `pronosticos.py` (afecta también a marcador exacto),
    pero es un cambio del motor: se arregla en un PR aparte con aprobación. Aquí
    se usa la lambda correcta para que el backtesting mida probabilidades reales.
    """
    obtener = matriz["get"]
    total = 0.0
    for i in range(max_goles + 1):
        for j in range(max_goles + 1):
            if condicion(i, j):
                total += obtener(i, j)
    return total


def derivar_probabilidad_mercado(categoria, parametros, lambda_local, lambda_visita, rho, max_goles=8):
    """Re-deriva la probabilidad de un mercado desde (lambda_local, lambda_visita, rho).

    Usa las mismas primitivas del motor (matrizMarcadores + verificarMercado
    importadas de pronosticos.py) y la suma correcta (`sumar_matriz`), de modo que
    el backtesting es matemáticamente equivalente a re-generar el partido con
    otros parámetros una vez corregida la suma del motor.
    """
    matriz = matrizMarcadores(lambda_local, lambda_visita, max_goles, rho)
    return sumar_matriz(matriz, max_goles, lambda i, j: verificarMercado(categoria, parametros, i, j))


def aplicar_post_proceso(prob_cruda, ajuste_categoria):
    """Replica el post-proceso del motor sobre la probabilidad cruda derivada.

    Espejo de pronosticos.py:868-871 (ajuste por categoría + suavizado fijo +
    clamp 0.08-0.92). No replica la capa ML (multiplicador 0.9-1.1, idéntico
    para todos los candidatos, por lo que no altera la comparación).
    """
    suavizado = 0.96 if prob_cruda < 0.5 else 0.92
    return clamp(prob_cruda * ajuste_categoria * suavizado, 0.08, 0.92)


def cargar_overrides(ruta_aprobados):
    """Carga los parámetros aprobados manualmente (fase 4). Devuelve {} si no hay."""
    datos = leer_json(ruta_aprobados)
    if not datos or datos.get("estado") != "aprobada":
        return {}
    return datos.get("overrides", {})


def valores_base(overrides):
    """Estado vigente de cada parámetro calibrable: defaults del motor + overrides aprobados."""
    cal = overrides.get("calibracion", {}) or {}
    mult = overrides.get("multiplicadoresAjuste", {}) or {}
    return {
        "factorLocalia": cal.get("factorLocalia", BASE_FACTOR_LOCALIA),
        "rhoDixonColes": cal.get("rhoDixonColes", BASE_RHO),
        "limiteTabla": cal.get("limiteTabla", BASE_LIMITE_TABLA),
        "porLiga": dict(cal.get("porLiga", {}) or {}),
        "porCategoria": dict(cal.get("porCategoria", {}) or {}),
        "multEWMA": mult.get("ewma", 1.0),
        "multH2H": mult.get("h2h", 1.0),
    }


# ==================== INGESTA ====================

def descargar_historial(backend_url=BACKEND_URL, intentos=3, timeout=30):
    """Descarga el pool global de picks verificados. GET /api/historial (solo lectura)."""
    url = f"{backend_url}/api/historial"
    ultimo_error = None
    for intento in range(1, intentos + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                datos = json.loads(resp.read().decode("utf-8"))
            if not isinstance(datos, dict):
                raise ValueError("La respuesta del backend no es un objeto JSON.")
            historial = datos.get("historial")
            if not isinstance(historial, list):
                raise ValueError("La respuesta no contiene el campo 'historial' como lista.")
            return historial
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, json.JSONDecodeError) as e:
            ultimo_error = e
    raise RuntimeError(f"No se pudo descargar el historial del backend ({url}): {ultimo_error}")


def cargar_historico(ruta=RUTA_HISTORICO):
    """Carga el histórico oficial de pronósticos (append-only, escrito por el workflow)."""
    registros = []
    if not os.path.exists(ruta):
        return registros
    with open(ruta, "r", encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea:
                continue
            try:
                registros.append(json.loads(linea))
            except json.JSONDecodeError:
                continue  # línea corrupta: se ignora y se reporta
    return registros


def indexar_historico(registros_historico):
    """Índice por partidoId: la generación oficial MÁS RECIENTE anterior al kickoff."""
    indice = {}
    n_lineas_corruptas = 0
    for reg in registros_historico:
        for pid, data in (reg.get("pronosticos") or {}).items():
            partido = data.get("partido") or {}
            fecha = parsear_fecha(partido.get("utcDate"))
            genero = parsear_fecha(data.get("generadoEn"))
            if not fecha or not genero:
                n_lineas_corruptas += 1
                continue
            if genero > fecha:
                continue  # generación posterior al kickoff no es la fuente del pick
            actual = indice.get(pid)
            if actual is None or parsear_fecha(actual.get("generadoEn")) < genero:
                indice[pid] = data
    stats = {"partidos": len(indice), "lineasCorruptas": n_lineas_corruptas}
    return indice, stats


# ==================== SANITY-CHECKS Y DATASET ====================

def evaluar_acierto(categoria, parametros, gl, gv):
    """Espejo exacto de verificarMercado del motor (función importada)."""
    return bool(verificarMercado(categoria, parametros, gl, gv))


def construir_dataset(historial, indice_historico, registros_historico=None):
    """Convierte el pool verificado en muestras limpias para recalibrar.

    Sanity-checks (diseño §1.1, mitigación parcial del pool sin autenticación):
      1. marcadorFinal parseable y goles en [0, GOLES_MAX_VALIDO]
      2. deduplicación por partidoId; marcadores en conflicto => fuera TODO el partido,
         y duplicados con el mismo marcador se prueban uno por uno (el primero que
         pase el cruce se usa) para que un duplicado alterado no borre el limpio
      3. fechas coherentes (no futuras, no anteriores a 2020)
      4. cruce con el histórico oficial: misma categoría+selección y probabilidad
         coincidente (±3 puntos) => si falla, pick manual o alterado => fuera
      5. si el histórico oficial proviene de datos de ejemplo => abortar
    Devuelve (muestras, reporte). Cada muestra = un mercado evaluado.
    """
    reporte = {
        "registrosEntrada": len(historial),
        "descartados": {
            "sinMarcadorValido": 0,
            "fechaInvalida": 0,
            "sinHistoricoOficial": 0,
            "cruceFallido": 0,
            "duplicadosEnConflicto": 0,
        },
        "partidosDuplicadosDedup": 0,
        "partidosVerificados": 0,
        "ligas": {},
        "datosDeEjemplo": False,
        "notas": [],
    }

    # --- paso 0: detección de datos de ejemplo en el histórico oficial ---
    # El flag vive a nivel de CORRIDA (registro jsonl); también se revisa el
    # índice por partido por compatibilidad con telemetrías anteriores.
    for registro_corrida in (registros_historico or []):
        if registro_corrida.get("datosDeEjemplo"):
            reporte["datosDeEjemplo"] = True
            break
    if not reporte["datosDeEjemplo"]:
        for data in indice_historico.values():
            if data.get("datosDeEjemplo"):
                reporte["datosDeEjemplo"] = True
                break
    if reporte["datosDeEjemplo"]:
        reporte["notas"].append(
            "El histórico oficial proviene de datos de EJEMPLO (pronosticos.py sin "
            "integración real contra el backend). El sistema no recalibra contra "
            "datos ficticios; queda pendiente conectar la generación a datos reales."
        )
        return [], reporte

    # --- paso 1: marcadores válidos, fechas coherentes, dedup por partido ---
    hoy = datetime.now(timezone.utc)
    candidatos = {}
    for registro in historial:
        if not isinstance(registro, dict) or not registro.get("verificado"):
            continue
        marcador = parsear_marcador(registro.get("marcadorFinal"))
        pid = str(registro.get("partidoId", ""))
        if marcador is None or not pid:
            reporte["descartados"]["sinMarcadorValido"] += 1
            continue
        fecha = parsear_fecha(registro.get("fecha"))
        if fecha is None or fecha > hoy + timedelta(days=1) or fecha.year < 2020:
            reporte["descartados"]["fechaInvalida"] += 1
            continue
        gl, gv = marcador
        # Se conservan TODOS los registros del partido: si un duplicado entra
        # alterado (pool público sin autenticación), el cruce con el histórico
        # oficial descarta ESE registro sin perder el partido limpio.
        entry = candidatos.setdefault(pid, {"gl": gl, "gv": gv, "registros": []})
        entry["registros"].append((gl, gv, registro))
        if (entry["gl"], entry["gv"]) != (gl, gv):
            entry["conflicto"] = True  # marcadores contradictorios => contaminación

    limpios = {}
    for pid, entry in candidatos.items():
        if entry.get("conflicto"):
            reporte["descartados"]["duplicadosEnConflicto"] += 1
            continue
        limpios[pid] = entry
    reporte["partidosDuplicadosDedup"] = len(candidatos) - len(limpios)
    return muestras_pendientes(limpios, indice_historico, reporte)


def muestras_de_registro(registro, mapa_oficial, gl, gv, pm):
    """Muestras limpias de UN registro del pool (un intento del cruce).

    Devuelve (muestras, descartes_por_cruce):
      - un pick que no existe en el histórico oficial (manual) se ignora sin contar;
      - un pick cuya probabilidad no coincide con la oficial (±3 pts) se descarta
        y se cuenta en descartes_por_cruce (probabilidad alterada o pick manual).
    """
    muestras = []
    cruce_fallido = 0
    for mercado in registro.get("mercados") or []:
        clave = f"{mercado.get('categoria')}|{mercado.get('seleccion')}"
        p_oficial = mapa_oficial.get(clave)
        if p_oficial is None:
            continue  # pick no generado por el motor (manual) => fuera
        p_pick = float(mercado.get("probabilidad", 0)) / 100.0
        if abs(p_pick - p_oficial) > TOLERANCIA_CRUCE_PROB:
            cruce_fallido += 1  # prob alterada/manual => fuera
            continue
        muestras.append({
            "partidoId": registro.get("partidoId"),
            "liga": None,  # se completa en muestras_pendientes
            "categoria": mercado.get("categoria", "otro"),
            "seleccion": mercado.get("seleccion"),
            "parametros": mercado.get("parametros"),
            "pPredicha": p_oficial,  # probabilidad oficial del histórico (0-1)
            "y": 1 if evaluar_acierto(mercado.get("categoria"), mercado.get("parametros"), gl, gv) else 0,
            "gl": gl, "gv": gv,
            "fecha": None,  # se completa en muestras_pendientes
            "parametrosModelo": pm,
        })
    return muestras, cruce_fallido


def muestras_pendientes(limpios, indice_historico, reporte):
    """Paso 2 del dataset: cruce con el histórico oficial y armado de muestras.

    Cada partido puede tener varios registros en el pool (duplicados). Se prueban
    en orden y se usa el primero que aporte muestras limpias; solo si NINGUNO pasa
    el cruce se cuenta el partido como descartado (cruceFallido).
    """
    muestras = []
    partidos_utiles = set()
    for pid, entry in limpios.items():
        oficial = indice_historico.get(pid)
        if not oficial:
            reporte["descartados"]["sinHistoricoOficial"] += 1
            continue
        partido = oficial.get("partido") or {}
        codigo_liga = (partido.get("competition") or {}).get("code") or "OTRAS"
        pm = oficial.get("parametrosModelo") or {}
        if not pm.get("lambdaLocal") or not pm.get("lambdaVisita"):
            reporte["descartados"]["sinHistoricoOficial"] += 1
            continue
        mapa_oficial = {}
        for mercado_oficial in oficial.get("seleccionados") or []:
            clave = f"{mercado_oficial.get('categoria')}|{mercado_oficial.get('seleccion')}"
            mapa_oficial[clave] = float(mercado_oficial.get("probabilidad", 0)) / 100.0

        registros = entry.get("registros") or []
        if not registros:
            continue
        muestras_pid, cruce_fallido_primero = [], 0
        for indice, (gl_reg, gv_reg, registro) in enumerate(registros):
            nuevas, cruce_fallido = muestras_de_registro(registro, mapa_oficial, gl_reg, gv_reg, pm)
            if indice == 0:
                cruce_fallido_primero = cruce_fallido
            if nuevas:
                muestras_pid = nuevas
                break
        if not muestras_pid:
            # ningún registro del partido pasa el cruce => no confiable
            reporte["descartados"]["cruceFallido"] += cruce_fallido_primero
            continue
        for m in muestras_pid:
            m["liga"] = codigo_liga
            m["fecha"] = partido.get("utcDate")
        muestras.extend(muestras_pid)
        partidos_utiles.add(pid)
        reporte["ligas"][codigo_liga] = reporte["ligas"].get(codigo_liga, 0) + 1

    reporte["partidosVerificados"] = len(partidos_utiles)
    reporte["muestrasMercados"] = len(muestras)
    return muestras, reporte


# ==================== MÉTRICAS Y DIAGNÓSTICO ====================

def brier(muestras):
    """Brier Score binario promedio: media de (p - y)^2 por mercado."""
    if not muestras:
        return None
    errores = [(m["pPredicha"] - m["y"]) ** 2 for m in muestras]
    return sum(errores) / len(errores)


def agrupar(muestras, clave):
    grupos = {}
    for m in muestras:
        grupos.setdefault(clave(m), []).append(m)
    return grupos


def curva_calibracion(muestras):
    """Banda de p predicha -> (p_promedio, tasa_real, n, desviación en errores estándares).

    desviacionStd = (tasa_real - p_promedio) / SE, con SE = sqrt(p(1-p)/n).
    |desviacionStd| > 2 es señal estadística de sesgo (aprox. IC 95%).
    """
    bordes = [0.0, 0.20, 0.35, 0.50, 0.65, 0.80, 1.01]
    bandas = []
    for i in range(len(bordes) - 1):
        grupo = [m for m in muestras if bordes[i] <= m["pPredicha"] < bordes[i + 1]]
        if not grupo:
            continue
        n = len(grupo)
        p_prom = sum(m["pPredicha"] for m in grupo) / n
        tasa_real = sum(m["y"] for m in grupo) / n
        se = math.sqrt(max(p_prom * (1 - p_prom), 1e-9) / n)
        desv = (tasa_real - p_prom) / se if se > 0 else 0.0
        bandas.append({
            "banda": f"{int(bordes[i]*100)}-{int(min(bordes[i+1],1.0)*100)}%",
            "n": n,
            "pPromedio": round(p_prom, 4),
            "tasaReal": round(tasa_real, 4),
            "sesgo": round(tasa_real - p_prom, 4),
            "desviacionStd": round(desv, 2),
            "significativo": abs(desv) > 2,
        })
    return bandas


def integridad_probabilidades(muestras):
    """Detecta probabilidades oficiales degeneradas (firma del bug de suma del motor).

    Si el motor publica probabilidades que en realidad son sumas de índices, todas
    caen en el techo del clamp (0.92) y quedan pocos valores distintos. Recalibrar
    sobre eso produciría propuestas "confiables" sobre ruido (Platt ajustando una
    constante), así que el sistema aborta y lo reporta.
    """
    if not muestras:
        return {"degenerado": False, "n": 0}
    probs = [round(m["pPredicha"], 4) for m in muestras]
    n_techo = sum(1 for p in probs if p >= CLAMP_TECHO - 1e-9)
    distintos = len(set(probs))
    pct_techo = n_techo / len(probs)
    degenerado = (pct_techo >= MOTOR_DEGENERADO_PCT
                  and distintos <= MOTOR_DEGENERADO_VALORES)
    return {
        "degenerado": degenerado,
        "n": len(probs),
        "pctEnTechoClamp": round(pct_techo, 4),
        "valoresDistintos": distintos,
        "motivo": ("Probabilidades oficiales degeneradas: casi todas pegadas al "
                   "techo del clamp con muy pocos valores distintos. Es la firma "
                   "del bug de suma de la matriz en pronosticos.py "
                   "(`matriz.get(i, j)` sobre un dict devuelve el índice j). "
                   "Se recalibraría sobre ruido: no se propone nada.")
                  if degenerado else None,
    }


def diagnosticar(muestras):
    """Reporte de diagnóstico: Brier global y por subgrupo + curvas de calibración."""
    b = brier(muestras)
    diagnostico = {
        "nMercados": len(muestras),
        "brierGlobal": round(b, 4) if b is not None else None,
        "porCategoria": {},
        "porLiga": {},
        "calibracionGlobal": curva_calibracion(muestras),
    }
    for cat, grupo in agrupar(muestras, lambda m: m["categoria"]).items():
        bc = brier(grupo)
        diagnostico["porCategoria"][cat] = {
            "n": len(grupo), "brier": round(bc, 4) if bc else None,
            "tasaAcierto": round(sum(m["y"] for m in grupo) / len(grupo), 4),
            "calibracion": curva_calibracion(grupo),
        }
    for liga, grupo in agrupar(muestras, lambda m: m["liga"]).items():
        bl = brier(grupo)
        diagnostico["porLiga"][liga] = {"n": len(grupo), "brier": round(bl, 4) if bl else None}
    return diagnostico


def imprimir_diagnostico(diagnostico):
    print(f"  Mercados evaluados: {diagnostico['nMercados']}")
    print(f"  Brier global: {diagnostico['brierGlobal']}")
    print("  --- Brier por categoría ---")
    for cat, info in diagnostico["porCategoria"].items():
        print(f"    {cat:<12} n={info['n']:<4} brier={info['brier']}  aciertos={info['tasaAcierto']}")
    print("  --- Calibración global (bandas de probabilidad) ---")
    for banda in diagnostico["calibracionGlobal"]:
        marca = " <-- SESGO" if banda["significativo"] else ""
        print(
            f"    {banda['banda']:<9} n={banda['n']:<4} p_modelo={banda['pPromedio']:<7} "
            f"real={banda['tasaReal']:<7} sesgo={banda['sesgo']:+.3f}{marca}"
        )
    print("  --- Brier por liga ---")
    for liga, info in diagnostico["porLiga"].items():
        print(f"    {liga:<6} n={info['n']:<4} brier={info['brier']}")


# ==================== RECALIBRACIÓN PLATT ====================

def ajustar_platt(p_list, y_list, iteraciones=600, lr=0.08, reg=0.01):
    """Recalibración tipo Platt: p_cal = sigmoide(a + b * logit(p)).

    Regresión logística de 2 parámetros con gradiente descendente determinista
    (sin dependencias extra). Devuelve (a, b) sin shrinkage ni caps: eso lo
    aplica el llamador según el tamaño de la muestra.
    """
    z = np.array([prob_logit(p) for p in p_list])
    y = np.array(y_list, dtype=float)
    a, b = 0.0, 1.0
    for _ in range(iteraciones):
        p_cal = 1.0 / (1.0 + np.exp(-(a + b * z)))
        error = p_cal - y
        grad_a = error.mean() + reg * a
        grad_b = (error * z).mean() + reg * (b - 1.0)
        a -= lr * grad_a
        b -= lr * grad_b
    return float(a), float(b)


def proponer_platt(muestras, overrides_platt=None):
    """Propuesta de recalibración de probabilidades por categoría (diseño §1.2).

    Gates: n >= N_MINIMO_POR_CATEGORIA y mejora de Brier >= MEJORA_MINIMA_BRIER
    en el holdout temporal (30% más reciente). Shrinkage hacia identidad con
    K=100 y caps: b en [0.85, 1.15], a en [-0.30, 0.30].
    """
    propuestas = []
    for cat, grupo in agrupar(muestras, lambda m: m["categoria"]).items():
        n = len(grupo)
        if n < N_MINIMO_POR_CATEGORIA:
            continue
        orden = sorted(range(n), key=lambda i: grupo[i]["fecha"] or "")
        corte = max(1, int(n * SPLIT_ENTRENAMIENTO))
        idx_train, idx_val = orden[:corte], orden[corte:]
        if len(idx_val) < 10:
            continue
        p_list = [m["pPredicha"] for m in grupo]
        y_list = [m["y"] for m in grupo]
        a_fit, b_fit = ajustar_platt([p_list[i] for i in idx_train], [y_list[i] for i in idx_train])
        peso = n / (n + K_SHRINKAGE)
        a = clamp(peso * a_fit, -0.30, 0.30)
        b = clamp(1.0 + peso * (b_fit - 1.0), 0.85, 1.15)

        def aplicar(p):
            return clamp(prob_sigmoide(a + b * prob_logit(p)), 0.08, 0.92)

        mejora_holdout = sum(
            ((p_list[i] - y_list[i]) ** 2 - (aplicar(p_list[i]) - y_list[i]) ** 2)
            for i in idx_val
        ) / len(idx_val)
        if mejora_holdout < MEJORA_MINIMA_BRIER:
            continue
        mejora_train = sum(
            ((p_list[i] - y_list[i]) ** 2 - (aplicar(p_list[i]) - y_list[i]) ** 2)
            for i in idx_train
        ) / len(idx_train)
        b_actual = sum((p - y) ** 2 for p, y in zip(p_list, y_list)) / n
        b_nuevo = sum((aplicar(p) - y) ** 2 for p, y in zip(p_list, y_list)) / n
        vigente = (overrides_platt or {}).get(cat)
        propuestas.append({
            "parametro": "platt",
            "alcance": f"categoria:{cat}",
            "valorActual": vigente or None,
            "valorPropuesto": {"a": round(a, 4), "b": round(b, 4)},
            "muestras": n,
            "brierActual": round(b_actual, 4),
            "brierPropuesto": round(b_nuevo, 4),
            "mejora": round(mejora_holdout, 4),
            "validacionTemporal": {
                "entrenamiento": round(mejora_train, 4),
                "holdout": round(mejora_holdout, 4),
            },
            "nota": f"Recalibración tipo Platt para '{cat}' (n={n}); mejora validada "
                    f"en el 30% más reciente de la muestra.",
        })
    return propuestas


# ==================== BACKTESTING DE PESOS INTERNOS ====================

_CACHE_MATRIZ = {}

def matriz_para(lambda_local, lambda_visita, rho):
    clave = (round(lambda_local, 4), round(lambda_visita, 4), round(rho, 4))
    if clave not in _CACHE_MATRIZ:
        _CACHE_MATRIZ[clave] = matrizMarcadores(lambda_local, lambda_visita, 8, rho)
    return _CACHE_MATRIZ[clave]


def probabilidad_backtest(m, cambio, valores):
    """Probabilidad de la muestra bajo un cambio candidato (o el estado actual).

    Tubería exacta del motor: derivar probabilidad cruda desde (lambdaL, lambdaV,
    rho) con las funciones importadas de pronosticos.py -> post-proceso
    (ajuste por categoría + suavizado + clamp). La capa ML no se replica porque
    es un multiplicador constante por partido: no altera la comparación entre
    candidatos (nota del diseño §1.3).
    """
    pm = m["parametrosModelo"]
    factores = pm.get("factores") or {}
    ll = float(pm["lambdaLocal"])
    lv = float(pm["lambdaVisita"])
    rho = float(pm.get("rhoDixonColes", valores["rhoDixonColes"]))
    categoria = m["categoria"]

    ajuste_cat = valores["porCategoria"].get(categoria, 1.0)

    if cambio:
        parametro = cambio["parametro"]
        alcance = cambio.get("alcance", "")
        nuevo = cambio["valorPropuesto"]
        if parametro == "factorLocalia":
            ratio = nuevo / valores["factorLocalia"]
            ll *= ratio
            lv *= ratio
        elif parametro == "factorLiga":
            if m["liga"] == alcance.split(":", 1)[-1]:
                perfil = float(pm.get("perfilLigaGoles", 1.0)) or 1.0
                base_actual = float(factores.get("ligaBase", 1.0))
                efectivo_actual = float(factores.get("ligaAjustado", 1.0)) or 1.0
                efectivo_nuevo = clamp(nuevo * perfil, *LIM_FACTOR_LIGA_AJUSTADO)
                ratio = efectivo_nuevo / efectivo_actual
                ll *= ratio
                lv *= ratio
        elif parametro == "multEWMA":
            k = float(nuevo)
            for lado, lado_lambda in (("tendenciaLocal", "ll"), ("tendenciaVisita", "lv")):
                f = float(factores.get(lado, 1.0))
                if f != 1.0:
                    f_nuevo = 1.0 + (f - 1.0) * k
                    if lado_lambda == "ll":
                        ll *= f_nuevo / f
                    else:
                        lv *= f_nuevo / f
        elif parametro == "multH2H":
            k = float(nuevo)
            for lado, lado_lambda in (("h2hLocal", "ll"), ("h2hVisita", "lv")):
                f = float(factores.get(lado, 1.0))
                if f != 1.0:
                    f_nuevo = 1.0 + (f - 1.0) * k
                    if lado_lambda == "ll":
                        ll *= f_nuevo / f
                    else:
                        lv *= f_nuevo / f
        elif parametro == "rhoDixonColes":
            rho = float(nuevo)
        elif parametro == "limiteTabla":
            for lado, lado_lambda in (("tablaDesviacionLocal", "ll"), ("tablaDesviacionVisita", "lv")):
                desv = factores.get(lado)
                if desv is None:
                    continue
                f_actual = float(factores.get("tablaLocal" if lado.endswith("Local") else "tablaVisita", 1.0))
                f_nuevo = 1.0 + clamp(float(desv), -float(nuevo), float(nuevo))
                if f_actual != 0:
                    if lado_lambda == "ll":
                        ll *= f_nuevo / f_actual
                    else:
                        lv *= f_nuevo / f_actual
        elif parametro == "porCategoria":
            if categoria == alcance.split(":", 1)[-1]:
                ajuste_cat = float(nuevo)

    p_cruda = sumar_matriz(
        matriz_para(ll, lv, rho), 8,
        lambda i, j: verificarMercado(categoria, m["parametros"] or {}, i, j),
    )
    return aplicar_post_proceso(p_cruda, ajuste_cat)


def brier_backtest(muestras, cambio, valores, indices=None):
    """Brier promedio sobre las muestras (o subconjunto de índices) bajo un cambio."""
    total, n = 0.0, 0
    for i, m in enumerate(muestras):
        if indices is not None and i not in indices:
            continue
        p = probabilidad_backtest(m, cambio, valores)
        total += (p - m["y"]) ** 2
        n += 1
    return total / n if n else None


def split_temporal(muestras, indices=None):
    """Divide índices por fecha: 70% entrenamiento (más antiguo), 30% holdout."""
    idx = list(indices) if indices is not None else list(range(len(muestras)))
    orden = sorted(idx, key=lambda i: muestras[i]["fecha"] or "")
    corte = max(1, int(len(orden) * SPLIT_ENTRENAMIENTO))
    return set(orden[:corte]), set(orden[corte:])


def mejora_por_liga(muestras, cambio, valores):
    """Mejora de Brier por liga (para el veto multi-liga de la localía global)."""
    salida = {}
    for liga, grupo in agrupar(muestras, lambda m: m["liga"]).items():
        indices_liga = {i for i, m in enumerate(muestras) if m["liga"] == liga}
        b_act = brier_backtest(muestras, None, valores, indices_liga)
        b_nue = brier_backtest(muestras, cambio, valores, indices_liga)
        if b_act is not None and b_nue is not None:
            salida[liga] = round(b_act - b_nue, 4)
    return salida


def grid_candidatos(parametro, valor_actual, lim=None):
    """Candidatos a evaluar para cada parámetro (movimiento acotado por corrida)."""
    if parametro in ("multEWMA", "multH2H"):
        return [round(clamp(valor_actual + d, *LIM_MULT_AJUSTE), 4)
                for d in (-0.10, -0.05, 0.0, 0.05, 0.10)]
    if parametro in ("factorLocalia", "factorLiga", "porCategoria"):
        candidatos = [round(valor_actual * (1 + d), 4) for d in (-0.04, -0.02, 0.0, 0.02, 0.04)]
    elif parametro == "rhoDixonColes":
        paso = max(MOVIMIENTO_MINIMO_ABSOLUTO["rhoDixonColes"], abs(valor_actual) * MOVIMIENTO_MAX_PCT)
        candidatos = [round(valor_actual + d, 4) for d in (-paso, -paso / 2, 0.0, paso / 2, paso)]
    elif parametro == "limiteTabla":
        paso = MOVIMIENTO_MINIMO_ABSOLUTO["limiteTabla"]
        candidatos = [round(valor_actual + d, 4) for d in (-paso, -paso / 2, 0.0, paso / 2, paso)]
    else:
        return [valor_actual]
    if lim:
        candidatos = [clamp(c, *lim) for c in candidatos]
    return sorted(set(candidatos))


def aplicar_limite_movimiento(parametro, actual, propuesto):
    """Cap el movimiento por corrida (5% relativo, o mínimo absoluto para parámetros chicos).

    Nota operativa del diseño: para los multiplicadores de ajuste (EWMA/H2H),
    cuyo valor de referencia es 1.0, el movimiento máximo por corrida es ±0.10
    absoluto (un 5% relativo sería ruido numérico).
    """
    if propuesto == actual:
        return actual
    if parametro in MOVIMIENTO_MINIMO_ABSOLUTO:
        delta = MOVIMIENTO_MINIMO_ABSOLUTO[parametro]
        return actual + clamp(propuesto - actual, -delta, delta)
    if parametro in ("multEWMA", "multH2H"):
        return actual + clamp(propuesto - actual, -0.10, 0.10)
    delta = abs(actual) * MOVIMIENTO_MAX_PCT
    return actual + clamp(propuesto - actual, -delta, delta)


def proponer_peso(parametro, alcance, muestras_sub, valores, cambio_base):
    """Evalúa una grilla de candidatos para un parámetro y arma la propuesta si pasa gates.

    Gates (diseño §1.3): mejora >= MEJORA_MINIMA_BRIER en holdout temporal Y
    mejora positiva en entrenamiento; luego shrinkage bayesiano hacia el valor
    vigente (K=100) y cap de movimiento por corrida; la mejora se re-verifica
    con el valor final (si el shrinkage la neutraliza, no se propone).
    """
    if len(muestras_sub) < 25:
        return None
    idx_train, idx_val = split_temporal(muestras_sub)
    if len(idx_val) < 10 or len(idx_train) < 15:
        return None
    b_train_act = brier_backtest(muestras_sub, None, valores, idx_train)
    b_val_act = brier_backtest(muestras_sub, None, valores, idx_val)
    if b_train_act is None or b_val_act is None:
        return None

    mejor = None
    for candidato in grid_candidatos(parametro, cambio_base["valorActual"]):
        cambio = dict(cambio_base)
        cambio["valorPropuesto"] = candidato
        b_train = brier_backtest(muestras_sub, cambio, valores, idx_train)
        b_val = brier_backtest(muestras_sub, cambio, valores, idx_val)
        if b_train is None or b_val is None:
            continue
        mejora_holdout = b_val_act - b_val
        mejora_train = b_train_act - b_train
        if mejora_holdout < MEJORA_MINIMA_BRIER or mejora_train <= 0:
            continue
        if mejor is None or mejora_holdout > mejor["mejoraHoldout"]:
            mejor = {"valorOptimo": candidato, "mejoraHoldout": mejora_holdout,
                     "mejoraTrain": mejora_train}
    if mejor is None:
        return None

    # shrinkage bayesiano hacia el valor vigente (K=100) + cap de movimiento
    peso = len(muestras_sub) / (len(muestras_sub) + K_SHRINKAGE)
    actual = cambio_base["valorActual"]
    optimo = mejor["valorOptimo"]
    final = peso * optimo + (1 - peso) * actual
    final = aplicar_limite_movimiento(parametro, actual, final)
    if parametro == "factorLocalia":
        final = clamp(final, *LIM_FACTOR_LOCALIA)
    elif parametro == "rhoDixonColes":
        final = clamp(final, *LIM_RHO)
    elif parametro == "limiteTabla":
        final = clamp(final, *LIM_LIMITE_TABLA)
    elif parametro == "porCategoria":
        final = clamp(final, *LIM_POR_CATEGORIA)
    elif parametro in ("multEWMA", "multH2H"):
        final = clamp(final, *LIM_MULT_AJUSTE)
    if final == actual:
        return None

    cambio_final = dict(cambio_base)
    cambio_final["valorPropuesto"] = final
    b_train_fin = brier_backtest(muestras_sub, cambio_final, valores, idx_train)
    b_val_fin = brier_backtest(muestras_sub, cambio_final, valores, idx_val)
    mejora_holdout_final = b_val_act - b_val_fin
    if mejora_holdout_final < MEJORA_MINIMA_BRIER:
        return None  # el shrinkage neutralizó la mejora: no se propone

    b_todo_act = brier_backtest(muestras_sub, None, valores)
    b_todo_nue = brier_backtest(muestras_sub, cambio_final, valores)
    return {
        "parametro": parametro,
        "alcance": alcance,
        "valorActual": actual,
        "valorPropuesto": round(final, 4),
        "muestras": len(muestras_sub),
        "brierActual": round(b_todo_act, 4) if b_todo_act else None,
        "brierPropuesto": round(b_todo_nue, 4) if b_todo_nue else None,
        "mejora": round(mejora_holdout_final, 4),
        "validacionTemporal": {
            "entrenamiento": round(b_train_act - b_train_fin, 4),
            "holdout": round(mejora_holdout_final, 4),
        },
    }


def generar_propuestas_pesos(muestras, valores, reporte):
    """Orquesta las propuestas de pesos con sus gates de subgrupo (diseño §1.3)."""
    propuestas = []
    vetados = []

    # Los partidos con "blend" final (sin nada en juego / poca data) mezclan el
    # lambda con el promedio de liga, por lo que el ratio de factor no sería
    # exacto sobre el lambda guardado: se excluyen del backtest de factores
    # (siguen participando del diagnóstico y de la recalibración por categoría).
    backtest = [m for m in muestras
                if not (m["parametrosModelo"].get("sinNadaEnJuego")
                        or m["parametrosModelo"].get("pocaData"))]
    n_excluidos = len(muestras) - len(backtest)

    def con_factor(sub, lado_local, lado_visita):
        """Muestras cuyo partido tiene el factor activo (distinto de 1.0)."""
        return [m for m in sub
                if float((m["parametrosModelo"].get("factores") or {}).get(lado_local, 1.0)) != 1.0
                or float((m["parametrosModelo"].get("factores") or {}).get(lado_visita, 1.0)) != 1.0]

    # --- factorLocalia (global, con anti-sesgo por liga) ---
    ligas_representadas = [l for l, n in reporte["ligas"].items() if n >= PARTIDOS_MIN_POR_LIGA_GLOBAL]
    if len(ligas_representadas) >= LIGAS_DISTINTAS_MIN and len(backtest) >= N_MINIMO_FACTOR:
        base = {"parametro": "factorLocalia", "alcance": "global",
                "valorActual": valores["factorLocalia"]}
        p = proponer_peso("factorLocalia", "global", backtest, valores, base)
        if p:
            p["efectoPorLiga"] = mejora_por_liga(
                backtest, {"parametro": "factorLocalia", "alcance": "global",
                           "valorPropuesto": p["valorPropuesto"]}, valores)
            empeoran = [l for l, v in (p["efectoPorLiga"] or {}).items() if v < 0]
            if len(empeoran) >= 3:
                vetados.append({**p, "veto": f"Veto multi-liga: el ajuste empeora "
                                              f"{len(empeoran)} ligas ({', '.join(empeoran[:6])})."})
            else:
                propuestas.append(p)

    # --- factor de liga (solo con muestra propia suficiente) ---
    muestras_por_liga = agrupar(backtest, lambda m: m["liga"])
    for liga, grupo in muestras_por_liga.items():
        n_liga = len(set(m["partidoId"] for m in grupo))
        if n_liga < N_MINIMO_POR_LIGA:
            continue
        base = {"parametro": "factorLiga", "alcance": f"liga:{liga}",
                "valorActual": valores["porLiga"].get(liga, 1.0)}
        p = proponer_peso("factorLiga", f"liga:{liga}", grupo, valores, base)
        if p:
            p["nota"] = f"Ajuste específico de la liga {liga} (n={n_liga} partidos)."
            propuestas.append(p)

    # --- multiplicador del ajuste por tendencia (EWMA) ---
    sub_ewma = con_factor(backtest, "tendenciaLocal", "tendenciaVisita")
    if len(sub_ewma) >= N_MINIMO_FACTOR:
        p = proponer_peso("multEWMA", "global", sub_ewma, valores,
                          {"parametro": "multEWMA", "alcance": "global",
                           "valorActual": valores["multEWMA"]})
        if p:
            p["nota"] = ("Escala del ajuste por forma reciente (EWMA). 1.0 = peso "
                         "actual del motor (0.30); <1.0 = la forma reciente pesa menos.")
            propuestas.append(p)

    # --- multiplicador del ajuste H2H ---
    sub_h2h = con_factor(backtest, "h2hLocal", "h2hVisita")
    if len(sub_h2h) >= N_MINIMO_FACTOR:
        p = proponer_peso("multH2H", "global", sub_h2h, valores,
                          {"parametro": "multH2H", "alcance": "global",
                           "valorActual": valores["multH2H"]})
        if p:
            p["nota"] = ("Escala del ajuste por historial directo. 1.0 = comportamiento "
                         "actual del motor (ajuste máximo 0.05 con shrinkage).")
            propuestas.append(p)

    # --- rho de Dixon-Coles ---
    if len(backtest) >= N_MINIMO_FACTOR:
        p = proponer_peso("rhoDixonColes", "global", backtest, valores,
                          {"parametro": "rhoDixonColes", "alcance": "global",
                           "valorActual": valores["rhoDixonColes"]})
        if p:
            p["nota"] = ("Corrección de marcadores bajos (Dixon-Coles) estimada "
                         "comparando la frecuencia real vs la predicha.")
            propuestas.append(p)

    # --- límite de tabla ---
    sub_tabla = [m for m in backtest
                 if (m["parametrosModelo"].get("factores") or {}).get("tablaDesviacionLocal") is not None
                 or (m["parametrosModelo"].get("factores") or {}).get("tablaDesviacionVisita") is not None]
    if len(sub_tabla) >= 25:
        p = proponer_peso("limiteTabla", "global", sub_tabla, valores,
                          {"parametro": "limiteTabla", "alcance": "global",
                           "valorActual": valores["limiteTabla"]})
        if p:
            p["nota"] = ("Amplitud del ajuste por posición en la tabla (±X%).")
            propuestas.append(p)

    # --- ajuste por categoría (O/U, BTTS, etc.) ---
    for cat, grupo in agrupar(muestras, lambda m: m["categoria"]).items():
        if len(grupo) < N_MINIMO_POR_CATEGORIA:
            continue
        base = {"parametro": "porCategoria", "alcance": f"categoria:{cat}",
                "valorActual": valores["porCategoria"].get(cat, 1.0)}
        p = proponer_peso("porCategoria", f"categoria:{cat}", grupo, valores, base)
        if p:
            p["nota"] = f"Ajuste multiplicativo sobre las probabilidades de '{cat}'."
            propuestas.append(p)

    return propuestas, vetados, n_excluidos


# ==================== PROPUESTA Y BITÁCORA ====================

def armar_propuesta(reporte, diagnostico, cambios, vetados, n_excluidos, id_propuesta):
    return {
        "id": id_propuesta,
        "generadoEn": ahora_utc(),
        "estado": "propuesta",
        "dataset": {
            "partidosVerificados": reporte["partidosVerificados"],
            "muestrasMercados": reporte["muestrasMercados"],
            "ligas": reporte["ligas"],
            "descartadosPorSanity": reporte["descartados"],
            "partidosDuplicadosDedup": reporte["partidosDuplicadosDedup"],
            "muestrasExcluidasDeBacktestDeFactores": n_excluidos,
            "hashHistorial": hash_estable(reporte.get("ligas", {})),
        },
        "diagnostico": {
            "brierGlobal": diagnostico["brierGlobal"],
            "porCategoria": {c: {"n": i["n"], "brier": i["brier"]}
                             for c, i in diagnostico["porCategoria"].items()},
            "calibracionGlobal": diagnostico["calibracionGlobal"],
        },
        "cambios": cambios,
        "cambiosVetados": vetados,
        "notaBacktesting": ("Comparación Brier entre la derivación pura del motor con "
                           "parámetros vigentes y la misma derivación con el candidato. "
                           "La capa ML (multiplicador constante por partido) no se replica: "
                           "no altera la comparación entre candidatos."),
    }


def resumen_humano(propuesta):
    lineas = []
    for c in propuesta.get("cambios", []):
        alcance = f" [{c['alcance']}]" if c.get("alcance") and c["alcance"] != "global" else ""
        nota = f" — {c['nota']}" if c.get("nota") else ""
        lineas.append(f"  • {c['parametro']}{alcance}: {c['valorActual']} -> "
                      f"{c['valorPropuesto']} (mejora Brier holdout: {c['mejora']}){nota}")
    for c in propuesta.get("cambiosVetados", []):
        lineas.append(f"  ✗ VETADO {c['parametro']}: {c.get('veto', '')}")
    return "\n".join(lineas) if lineas else "  (sin cambios que proponer)"


def registrar_bitacora(ruta_bitacora, entrada):
    entrada["ts"] = ahora_utc()
    append_jsonl(ruta_bitacora, entrada)


def ultima_propuesta_de_bitacora(ruta_bitacora):
    """Última entrada de tipo 'propuesta' de la bitácora (para el gate de n nuevas)."""
    if not os.path.exists(ruta_bitacora):
        return None
    ultima = None
    with open(ruta_bitacora, "r", encoding="utf-8") as f:
        for linea in f:
            try:
                entrada = json.loads(linea)
            except json.JSONDecodeError:
                continue
            if entrada.get("tipo") == "propuesta":
                ultima = entrada
    return ultima


def corrida(modo, resultado, detalle=None):
    return {
        "tipo": "corrida",
        "modo": modo,
        "resultado": resultado,
        "detalle": detalle or {},
    }


def construir_overrides(propuesta):
    """Traduce los cambios aprobados al contrato de fase 4 (parametros_aprobados.json)."""
    overrides = {"calibracion": {}, "multiplicadoresAjuste": {}, "platt": {}}
    for cambio in propuesta.get("cambios", []):
        parametro = cambio["parametro"]
        valor = cambio["valorPropuesto"]
        alcance = cambio.get("alcance", "global")
        if parametro == "factorLocalia":
            overrides["calibracion"]["factorLocalia"] = valor
        elif parametro == "factorLiga":
            liga = alcance.split(":", 1)[-1]
            overrides["calibracion"].setdefault("porLiga", {})[liga] = valor
        elif parametro == "porCategoria":
            cat = alcance.split(":", 1)[-1]
            overrides["calibracion"].setdefault("porCategoria", {})[cat] = valor
        elif parametro == "rhoDixonColes":
            overrides["calibracion"]["rhoDixonColes"] = valor
        elif parametro == "limiteTabla":
            overrides["calibracion"]["limiteTabla"] = valor
        elif parametro == "multEWMA":
            overrides["multiplicadoresAjuste"]["ewma"] = valor
        elif parametro == "multH2H":
            overrides["multiplicadoresAjuste"]["h2h"] = valor
        elif parametro == "platt":
            cat = alcance.split(":", 1)[-1]
            overrides["platt"][cat] = valor
    return overrides


def aprobar_propuesta(id_propuesta, rutas):
    propuesta = leer_json(rutas["propuesta"])
    if not propuesta or propuesta.get("id") != id_propuesta:
        print(f"ERROR: la propuesta activa no coincide con el id '{id_propuesta}'.")
        print(f"  Archivo: {rutas['propuesta']} -> id actual: "
              f"{(propuesta or {}).get('id')}, estado: {(propuesta or {}).get('estado')}")
        return 1
    if propuesta.get("estado") != "propuesta":
        print(f"ERROR: la propuesta {id_propuesta} ya está en estado '{propuesta.get('estado')}'.")
        return 1
    if not propuesta.get("cambios"):
        print("ERROR: la propuesta no contiene cambios; nada que aprobar.")
        return 1

    aprobados = {
        "estado": "aprobada",
        "propuestaId": id_propuesta,
        "aprobadoEn": ahora_utc(),
        "aprobadoPor": "usuario",
        "overrides": construir_overrides(propuesta),
        "camposPendientesDeConsumo": (
            "Este archivo es el CONTRATO de fase 4: pronosticos.py todavía NO lo consume "
            "(se implementará en un PR separado, solo después de esta aprobación)."
        ),
    }
    escribir_json(rutas["aprobados"], aprobados)

    propuesta["estado"] = "aprobada"
    propuesta["resueltaEn"] = ahora_utc()
    escribir_json(rutas["propuesta"], propuesta)

    registrar_bitacora(rutas["bitacora"], {
        "tipo": "resolucion",
        "propuestaId": id_propuesta,
        "estado": "aprobada",
        "cambiosResumidos": [
            {"parametro": c["parametro"], "alcance": c.get("alcance", "global"),
             "de": c["valorActual"], "a": c["valorPropuesto"]}
            for c in propuesta["cambios"]
        ],
        "archivoOverrides": rutas["aprobados"],
    })
    print(f"Propuesta {id_propuesta} APROBADA. Overrides escritos en {rutas['aprobados']}.")
    print(json.dumps(aprobados["overrides"], indent=2, ensure_ascii=False))
    return 0


def rechazar_propuesta(id_propuesta, motivo, rutas):
    propuesta = leer_json(rutas["propuesta"])
    if not propuesta or propuesta.get("id") != id_propuesta:
        print(f"ERROR: la propuesta activa no coincide con el id '{id_propuesta}'.")
        return 1
    if propuesta.get("estado") != "propuesta":
        print(f"ERROR: la propuesta {id_propuesta} ya está en estado '{propuesta.get('estado')}'.")
        return 1

    propuesta["estado"] = "rechazada"
    propuesta["resueltaEn"] = ahora_utc()
    propuesta["motivoRechazo"] = motivo or "(sin motivo declarado)"
    escribir_json(rutas["propuesta"], propuesta)

    registrar_bitacora(rutas["bitacora"], {
        "tipo": "resolucion",
        "propuestaId": id_propuesta,
        "estado": "rechazada",
        "motivo": propuesta["motivoRechazo"],
        "cambiosResumidos": [
            {"parametro": c["parametro"], "alcance": c.get("alcance", "global"),
             "de": c["valorActual"], "a": c["valorPropuesto"]}
            for c in propuesta.get("cambios", [])
        ],
    })
    print(f"Propuesta {id_propuesta} RECHAZADA y registrada en la bitácora.")
    return 0


# ==================== MODOS DE EJECUCIÓN ====================

def cargar_insumos(args, rutas):
    """Carga histórico oficial + pool del historial y arma el dataset limpio."""
    registros_historico = cargar_historico(args.historico_archivo or rutas["historico"])
    if not registros_historico:
        print("SIN HISTORICO: no existe pronosticos_historicos.jsonl todavía.")
        print("  La telemetría del motor se llena con cada corrida del workflow")
        print("  (python pronosticos.py). No hay nada que recalibrar aún.")
        return None
    indice, stats_hist = indexar_historico(registros_historico)
    print(f"  Histórico oficial: {stats_hist['partidos']} partidos indexados "
          f"({len(registros_historico)} corridas).")

    if args.historial_archivo:
        historial = leer_json(args.historial_archivo, [])
        print(f"  Historial (archivo local de prueba): {len(historial)} registros.")
    else:
        historial = descargar_historial(args.backend_url)
        print(f"  Historial descargado del backend: {len(historial)} registros.")

    muestras, reporte = construir_dataset(historial, indice, registros_historico)
    return muestras, reporte


def modo_status(args, rutas):
    print("=== ESTADO DEL SISTEMA DE RECALIBRACIÓN ===")
    print(f"  Histórico oficial : {rutas['historico']} "
          f"({'existe' if os.path.exists(rutas['historico']) else 'NO existe aún'})")
    print(f"  Propuesta activa  : {rutas['propuesta']} "
          f"({'existe' if os.path.exists(rutas['propuesta']) else 'sin propuesta'})")
    print(f"  Bitácora          : {rutas['bitacora']} "
          f"({'existe' if os.path.exists(rutas['bitacora']) else 'vacía'})")
    print(f"  Overrides aprobados: {rutas['aprobados']} "
          f"({'existe' if os.path.exists(rutas['aprobados']) else 'ninguno'})")
    overrides = cargar_overrides(rutas["aprobados"])
    if overrides:
        print("  Overrides vigentes:")
        print(json.dumps(overrides, indent=4, ensure_ascii=False))
    propuesta = leer_json(rutas["propuesta"])
    if propuesta:
        print(f"  Última propuesta: {propuesta.get('id')} "
              f"[{propuesta.get('estado')}] con {len(propuesta.get('cambios', []))} cambios.")
    ultima = ultima_propuesta_de_bitacora(rutas["bitacora"])
    if ultima:
        n = (ultima.get("dataset") or {}).get("partidosVerificados")
        print(f"  Gate de n nuevas: última propuesta usó {n} partidos verificados; "
              f"se requiere delta >= {VERIFICACIONES_NUEVAS_MIN} para proponer de nuevo.")
    return 0


def modo_diagnostico(args, rutas):
    print("=== DIAGNÓSTICO (solo lectura) ===")
    insumos = cargar_insumos(args, rutas)
    if not insumos:
        return 1
    muestras, reporte = insumos
    if reporte["datosDeEjemplo"]:
        print("  ABORTADO: " + reporte["notas"][0])
        return 1
    print(f"  Partidos verificados limpios: {reporte['partidosVerificados']} "
          f"(mínimo del sistema: {N_MINIMO_PARTIDOS})")
    print(f"  Descartes por sanity: {json.dumps(reporte['descartados'], ensure_ascii=False)}")
    integridad = integridad_probabilidades(muestras)
    print(f"  Integridad de probabilidades oficiales: "
          f"techo_clamp={integridad['pctEnTechoClamp']} "
          f"valores_distintos={integridad['valoresDistintos']}")
    if integridad["degenerado"]:
        print("  ADVERTENCIA: " + integridad["motivo"])
    if reporte["partidosVerificados"] < N_MINIMO_PARTIDOS:
        print(f"  Muestra insuficiente para proponer cambios "
              f"({reporte['partidosVerificados']}/{N_MINIMO_PARTIDOS}); "
              f"diagnóstico informativo de todos modos:")
    diagnosticos = diagnosticar(muestras)
    imprimir_diagnostico(diagnosticos)
    return 0


def modo_propuesta(args, rutas):
    print("=== RECALIBRACIÓN SUPERVISADA (generación de propuesta) ===")
    insumos = cargar_insumos(args, rutas)
    if not insumos:
        registrar_bitacora(rutas["bitacora"], corrida("propuesta", "sin_historico"))
        return 1
    muestras, reporte = insumos

    if reporte["datosDeEjemplo"]:
        print("  ABORTADO: " + reporte["notas"][0])
        registrar_bitacora(rutas["bitacora"], corrida("propuesta", "abortado_datos_de_ejemplo"))
        return 1

    n = reporte["partidosVerificados"]
    print(f"  Partidos verificados limpios: {n} (mínimo: {N_MINIMO_PARTIDOS}); "
          f"muestras: {reporte['muestrasMercados']}")
    print(f"  Descartes por sanity: {json.dumps(reporte['descartados'], ensure_ascii=False)}")

    integridad = integridad_probabilidades(muestras)
    print(f"  Integridad de probabilidades oficiales: "
          f"techo_clamp={integridad['pctEnTechoClamp']} "
          f"valores_distintos={integridad['valoresDistintos']}")
    if integridad["degenerado"]:
        print("  ABORTADO: " + integridad["motivo"])
        registrar_bitacora(rutas["bitacora"], corrida(
            "propuesta", "abortado_probabilidades_degeneradas", integridad))
        return 1

    if n < N_MINIMO_PARTIDOS:
        print(f"  SIN PROPUESTA: muestra insuficiente ({n}/{N_MINIMO_PARTIDOS}).")
        registrar_bitacora(rutas["bitacora"], corrida(
            "propuesta", "muestra_insuficiente", {"partidosVerificados": n}))
        return 0

    ultima = ultima_propuesta_de_bitacora(rutas["bitacora"])
    n_ultima = (ultima or {}).get("dataset", {}).get("partidosVerificados") or 0
    delta = n - n_ultima
    if delta < VERIFICACIONES_NUEVAS_MIN:
        print(f"  SIN PROPUESTA: solo {delta} verificaciones nuevas desde la última "
              f"propuesta (mínimo: {VERIFICACIONES_NUEVAS_MIN}).")
        registrar_bitacora(rutas["bitacora"], corrida(
            "propuesta", "sin_verificaciones_nuevas", {"partidosVerificados": n, "delta": delta}))
        return 0

    valores = valores_base(cargar_overrides(rutas["aprobados"]))
    print(f"  Base vigente: {json.dumps(valores, ensure_ascii=False)}")

    diagnosticos = diagnosticar(muestras)
    imprimir_diagnostico(diagnosticos)

    overrides = cargar_overrides(rutas["aprobados"])
    cambios_platt = proponer_platt(muestras, overrides.get("platt"))
    pesos, vetados, n_excluidos = generar_propuestas_pesos(muestras, valores, reporte)
    cambios = cambios_platt + pesos

    if not cambios:
        print("  SIN PROPUESTA: ninguna mejora supera los umbrales del diseño.")
        registrar_bitacora(rutas["bitacora"], corrida(
            "propuesta", "sin_mejoras_significativas",
            {"partidosVerificados": n, "muestrasExcluidasDeBacktest": n_excluidos}))
        return 0

    fecha_hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    id_propuesta = f"prop-{fecha_hoy}-{hash_estable({'n': n, 'k': len(cambios)})}"
    propuesta = armar_propuesta(reporte, diagnosticos, cambios, vetados, n_excluidos, id_propuesta)
    escribir_json(rutas["propuesta"], propuesta)

    registrar_bitacora(rutas["bitacora"], {
        "tipo": "propuesta",
        "propuestaId": id_propuesta,
        "estado": "propuesta",
        "nCambios": len(cambios),
        "dataset": {"partidosVerificados": n, "muestrasMercados": reporte["muestrasMercados"]},
        "cambiosResumidos": [
            {"parametro": c["parametro"], "alcance": c.get("alcance", "global"),
             "de": c["valorActual"], "a": c["valorPropuesto"]}
            for c in cambios
        ],
    })

    print("\n=== PROPUESTA GENERADA ===")
    print(f"  id: {id_propuesta}")
    print(f"  archivo: {rutas['propuesta']}")
    print(resumen_humano(propuesta))
    # Marcador para el workflow (GitHub Actions)
    print(f"RECALIBRACION_PROPUESTA_NUEVA={id_propuesta}")
    return 0


def resolver_rutas(dir_salida):
    base = dir_salida or "."
    return {
        "historico": os.path.join(base, RUTA_HISTORICO),
        "propuesta": os.path.join(base, RUTA_PROPUESTA),
        "bitacora": os.path.join(base, RUTA_BITACORA),
        "aprobados": os.path.join(base, RUTA_APROBADOS),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Recalibración supervisada del motor de pronósticos (diseño aprobado).")
    parser.add_argument("--modo", choices=["status", "diagnostico", "propuesta"], default="status",
                        help="status: estado del sistema | diagnostico: solo lectura | "
                             "propuesta: genera propuesta si hay cambios justificados")
    parser.add_argument("--aprobar", metavar="ID", help="Aprueba la propuesta con ese id.")
    parser.add_argument("--rechazar", metavar="ID", help="Rechaza la propuesta con ese id.")
    parser.add_argument("--motivo", default="", help="Motivo del rechazo (para la bitácora).")
    parser.add_argument("--backend-url", default=BACKEND_URL)
    parser.add_argument("--historial-archivo", default=None,
                        help="Ruta a un JSON con el historial (para pruebas locales).")
    parser.add_argument("--historico-archivo", default=None,
                        help="Ruta alternativa al histórico oficial (para pruebas locales).")
    parser.add_argument("--dir-salida", default=None,
                        help="Directorio de propuesta/bitácora/overrides (por defecto: cwd).")
    args = parser.parse_args()

    if not PRONOSTICOS_IMPORT_OK:
        print("ERROR: no se pudo importar pronosticos.py (dependencias faltantes).")
        print(f"  Detalle: {_ERROR_IMPORT}")
        print("  Instala requirements.txt (numpy, scipy, xgboost, scikit-learn).")
        return 1

    rutas = resolver_rutas(args.dir_salida)

    if args.aprobar:
        return aprobar_propuesta(args.aprobar, rutas)
    if args.rechazar:
        return rechazar_propuesta(args.rechazar, args.motivo, rutas)
    if args.modo == "diagnostico":
        return modo_diagnostico(args, rutas)
    if args.modo == "propuesta":
        return modo_propuesta(args, rutas)
    return modo_status(args, rutas)


if __name__ == "__main__":
    sys.exit(main())

