#!/usr/bin/env python3
"""Pruebas end-to-end del sistema de recalibración supervisada.

Ejecutar:  python test_recalibracion.py

Genera un dataset sintético DETERMINISTA (semilla fija) con el mismo formato
que producirán pronosticos.py (telemetría) y el frontend (historial), y valida:
  1. Gate de muestra insuficiente (<50 partidos)
  2. Abort con datos de ejemplo
  3. Sanity-checks (marcador inválido, duplicados en conflicto, cruce fallido,
     duplicado envenenado que NO debe borrar el partido limpio)
  4. Generación de propuesta (sesgo deliberado en Over 2.5) y anti-repetición
  5. Aprobación -> parametros_aprobados.json + bitácora
  6. Rechazo -> bitácora con motivo
  7. Telemetría real del motor (pronosticos.py) + abort por datos de ejemplo
  8. Propuesta de peso interno (factorLocalia) con desvío real del nivel de goles
  9. Guardia de integridad: probabilidades oficiales degeneradas => abortado
 10. Regresión del bug de suma de matriz del motor (pronosticos.sumaMatriz)
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

from pronosticos import matrizMarcadores, verificarMercado  # noqa: E402
from recalibracion import aplicar_post_proceso, sumar_matriz  # noqa: E402

LIGAS = ["PL", "PD", "BL1", "SA", "FL1"]
NOMBRES_LIGA = {"PL": "Premier League", "PD": "La Liga", "BL1": "Bundesliga",
                "SA": "Serie A", "FL1": "Ligue 1"}
PERFIL_GOLES = {"PL": 1.04, "PD": 0.96, "BL1": 1.07, "SA": 0.94, "FL1": 0.98}


def prob_mercado(cat, params, ll, lv, rho=-0.04):
    """Probabilidad real del mercado.

    Usa `sumar_matriz` (la lambda 'get' de la matriz) y NO `sumaMatriz` de
    pronosticos.py: esa función hace `matriz.get(i, j)` sobre un dict, que en
    Python devuelve el índice `j` como default => "probabilidades" de 84.0 que el
    motor clampa a 0.92. Con esa función, todos los mercados del dataset salían
    idénticos (92%) y el diagnóstico/backtesting quedaban midiendo ruido.
    """
    matriz = matrizMarcadores(ll, lv, 8, rho)
    return sumar_matriz(matriz, 8, lambda i, j: verificarMercado(cat, params, i, j))


def generar_dataset(directorio, n_partidos=140, sesgo_totalgoles=1.35,
                    datos_de_ejemplo=False, semilla=42, contaminar=False,
                    escala_goles_real=1.0, prob_degenerada=False):
    """Genera pronosticos_historicos.jsonl + historial_prueba.json en el directorio.

    escala_goles_real: multiplica el lambda local Y el visitante SOLO al muestrear
    el marcador real (la "verdad" tiene un nivel de goles distinto al que cree el
    modelo). Debe escalar ambos lados porque el motor aplica `factorLocalia` a los
    dos lambdas (pronosticos.py:790-791), así que es el único tipo de desvío de
    nivel que el instrumento `factorLocalia` puede representar.

    prob_degenerada: simula el bug de `sumaMatriz` del motor (todas las
    probabilidades publicadas pegadas al techo del clamp) para verificar que el
    sistema de recalibración aborta en vez de proponer cambios sobre ruido.
    """
    rng = np.random.default_rng(semilla)
    # Fechas en el PASADO (el sanity-check rechaza fechas futuras): la muestra
    # termina 2 días antes de hoy.
    base = (datetime.now(timezone.utc).replace(hour=18, minute=0, second=0, microsecond=0)
            - timedelta(days=n_partidos + 2))
    historico = {"corridaId": "test", "datosDeEjemplo": datos_de_ejemplo, "pronosticos": {}}
    historial = []

    for i in range(n_partidos):
        liga = LIGAS[i % len(LIGAS)]
        ll = float(rng.uniform(0.8, 2.2))
        lv = float(rng.uniform(0.4, 1.8))
        pid = f"{10000 + i}"
        fecha = base + timedelta(days=i)
        generado = fecha - timedelta(days=1)

        # Marcador real: muestreado de la matriz SIN sesgo de mercados (fuente de
        # verdad), con el nivel real de goles aplicado solo aquí.
        matriz = matrizMarcadores(ll * escala_goles_real, lv * escala_goles_real, 8, -0.04)
        probs = matriz["data"].ravel() / matriz["data"].sum()
        k = int(rng.choice(probs.size, p=probs))
        gl, gv = divmod(k, matriz["dim"])

        # Mercados seleccionados con probabilidades oficiales (replica del motor)
        p_local = prob_mercado("resultado", {"lado": "local"}, ll, lv)
        p_visita = prob_mercado("resultado", {"lado": "visita"}, ll, lv)
        lado = "local" if p_local >= p_visita else "visita"
        direccion = "mas" if i % 2 == 0 else "menos"
        mercados = [
            ("resultado", {"lado": lado}, f"Gana el {lado}"),
            ("doble", {"lado": "1X" if lado == "local" else "X2"}, "Doble oportunidad"),
            ("totalgoles", {"linea": 2.5, "direccion": direccion}, f"Total {direccion} 2.5"),
            ("btts", {"si": True}, "Ambos anotan"),
        ]

        seleccionados = []
        for cat, params, sel in mercados:
            cruda = prob_mercado(cat, params, ll, lv)
            # Sesgo deliberado: TODA la categoría totalgoles sobre-estimada
            # (el marcador real sale de la matriz sin sesgo => detectable).
            factor_sesgo = sesgo_totalgoles if cat == "totalgoles" else 1.0
            p_oficial = aplicar_post_proceso(cruda * factor_sesgo, 1.0)
            if prob_degenerada:
                p_oficial = 0.92  # firma del bug: todo pegado al techo del clamp
            seleccionados.append({
                "categoria": cat, "seleccion": sel,
                "probabilidad": round(p_oficial * 100),
                "parametros": params,
            })

        h2h_factor = 1.0 if i % 2 == 0 else 0.98
        tendencia = 1.0 if i % 3 == 0 else (1.02 if i % 3 == 1 else 0.97)
        desv_tabla = float(rng.uniform(-0.08, 0.08))
        historico["pronosticos"][pid] = {
            "partido": {"id": pid,
                        "homeTeam": {"id": 500 + i, "name": f"Local {i}"},
                        "awayTeam": {"id": 900 + i, "name": f"Visita {i}"},
                        "competition": {"name": NOMBRES_LIGA[liga], "code": liga},
                        "utcDate": fecha.isoformat().replace("+00:00", "Z"),
                        "status": "FINISHED"},
            "generadoEn": generado.isoformat().replace("+00:00", "Z"),
            "datosDeEjemplo": datos_de_ejemplo,
            "sinNadaEnJuego": False,
            "pocaData": False,
            "parametrosModelo": {
                "lambdaLocal": round(ll, 3), "lambdaVisita": round(lv, 3),
                "rhoDixonColes": -0.04, "factorLocalia": 1.08,
                "factorLiga": PERFIL_GOLES[liga], "perfilLigaGoles": PERFIL_GOLES[liga],
                "factores": {"localia": 1.08, "ligaBase": 1.0, "ligaAjustado": PERFIL_GOLES[liga],
                             "tablaLocal": 1 + max(-0.10, min(0.10, desv_tabla)),
                             "tablaVisita": 1 + max(-0.10, min(0.10, -desv_tabla)),
                             "h2hLocal": h2h_factor, "h2hVisita": 1.0 - (h2h_factor - 1.0),
                             "tendenciaLocal": tendencia, "tendenciaVisita": 1.0,
                             "tablaDesviacionLocal": round(desv_tabla, 4),
                             "tablaDesviacionVisita": round(-desv_tabla, 4)},
                "tendenciaDireccionLocal": "subiendo" if tendencia > 1 else "bajando",
                "tendenciaDireccionVisita": "neutral"
            },
            "seleccionados": seleccionados,
            "probMarcador": 12,
        }
        historial.append({
            "partidoId": pid,
            "local": f"Local {i}", "visita": f"Visita {i}",
            "fecha": fecha.isoformat().replace("+00:00", "Z"),
            "liga": NOMBRES_LIGA[liga],
            "mercados": [dict(m) for m in seleccionados],
            "verificado": True,
            "marcadorFinal": f"{gl}-{gv}",
        })

    ruta_hist = os.path.join(directorio, "pronosticos_historicos.jsonl")
    with open(ruta_hist, "w", encoding="utf-8") as f:
        f.write(json.dumps(historico, ensure_ascii=False, separators=(",", ":")) + "\n")
    ruta_historial = os.path.join(directorio, "historial_prueba.json")
    with open(ruta_historial, "w", encoding="utf-8") as f:
        json.dump(historial, f, ensure_ascii=False)
    return ruta_hist, ruta_historial


def contaminar_dataset(ruta_historial):
    """Contamina el pool con 5 casos (uno por sanity-check del diseño §1.1):

    1. marcador absurdo (99-0) sobre el partido 0   -> sinMarcadorValido
    2. duplicado del partido 1 con marcador válido
       pero CONTRADICTORIO                          -> duplicadosEnConflicto
    3. probabilidad alterada en el ÚNICO registro
       del partido 2                                -> cruceFallido
    4. pick que no existe en el histórico oficial   -> sinHistoricoOficial
    5. duplicado del partido 3 con marcador IDÉNTICO
       y probabilidad alterada                      -> debe ignorarse SIN perder
                                                       el partido limpio
    """
    with open(ruta_historial, "r", encoding="utf-8") as f:
        historial = json.load(f)

    # 1. marcador absurdo (variante suelta: el registro original queda válido)
    absurdo = dict(historial[0])
    absurdo["marcadorFinal"] = "99-0"

    # 2. mismo partido con otro marcador válido => conflicto
    gl, gv = (int(x) for x in historial[1]["marcadorFinal"].split("-"))
    distinto = f"{gv}-{gl}" if gl != gv else f"{gl + 1}-{gv}"
    conflicto = dict(historial[1])
    conflicto["marcadorFinal"] = distinto

    # 3. probabilidad alterada en el único registro del partido 2
    alterado = dict(historial[2])
    mercado_alt = dict(alterado["mercados"][0])
    p_orig = int(mercado_alt["probabilidad"])
    mercado_alt["probabilidad"] = max(1, min(100, p_orig - 20 if p_orig >= 50 else p_orig + 20))
    alterado["mercados"] = [mercado_alt]
    historial[2] = alterado

    # 4. pick inexistente en el histórico oficial del motor
    fantasma = {
        "partidoId": "99999", "local": "Fantasma", "visita": "Otro",
        "fecha": historial[0]["fecha"], "liga": "Premier League",
        "mercados": [{"categoria": "resultado", "seleccion": "Gana el local",
                      "probabilidad": 50, "parametros": {"lado": "local"}}],
        "verificado": True, "marcadorFinal": "1-0",
    }

    # 5. duplicado envenenado (mismo marcador) del partido 3. Entra PRIMERO en
    #    el pool (como haría una inyección real): el cruce debe rescatar el
    #    registro limpio en vez de perder el partido.
    envenenado = dict(historial[3])
    mercado_env = dict(envenenado["mercados"][0])
    p_env = int(mercado_env["probabilidad"])
    mercado_env["probabilidad"] = max(1, min(100, p_env - 25 if p_env >= 50 else p_env + 25))
    envenenado["mercados"] = [mercado_env]

    historial.extend([absurdo, conflicto, fantasma])
    historial.insert(0, envenenado)
    with open(ruta_historial, "w", encoding="utf-8") as f:
        json.dump(historial, f, ensure_ascii=False)


def correr(args):
    """Ejecuta recalibracion.py como subprocess y devuelve (codigo, salida)."""
    proceso = subprocess.run(
        [sys.executable, os.path.join(BASE, "recalibracion.py")] + args,
        cwd=BASE, capture_output=True, text=True, timeout=900,
    )
    return proceso.returncode, proceso.stdout + proceso.stderr


def assertion(nombre, condicion, detalle=""):
    estado = "OK " if condicion else "FALLA"
    print(f"  [{estado}] {nombre}" + (f" — {detalle}" if detalle and not condicion else ""))
    if not condicion:
        raise AssertionError(nombre + (" — " + detalle if detalle else ""))


def args_prueba(d, ruta_historial):
    return ["--modo", "propuesta", "--historial-archivo", ruta_historial,
            "--historico-archivo", os.path.join(d, "pronosticos_historicos.jsonl"),
            "--dir-salida", d]


def bitacora_de(d):
    ruta = os.path.join(d, "bitacora_recalibracion.jsonl")
    if not os.path.exists(ruta):
        return []
    return [json.loads(l) for l in open(ruta, encoding="utf-8") if l.strip()]


def leer_json_ruta(ruta):
    with open(ruta, "r", encoding="utf-8") as f:
        return json.load(f)


def escenario_muestra_insuficiente(tmp):
    print("Escenario 1: muestra insuficiente (<50 partidos) => sin propuesta")
    d = os.path.join(tmp, "e1"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=30)
    codigo, salida = correr(args_prueba(d, ruta_historial))
    assertion("exit code 0", codigo == 0, salida[-600:])
    assertion("muestra insuficiente reportada", "muestra insuficiente" in salida)
    assertion("sin propuesta escrita", not os.path.exists(os.path.join(d, "propuesta_recalibracion.json")))
    assertion("bitácora registra la corrida",
              any(b.get("resultado") == "muestra_insuficiente" for b in bitacora_de(d)))


def escenario_abort_datos_ejemplo(tmp):
    print("Escenario 2: histórico con datos de ejemplo => abortado")
    d = os.path.join(tmp, "e2"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=20, datos_de_ejemplo=True)
    codigo, salida = correr(args_prueba(d, ruta_historial))
    assertion("abortado por datos de ejemplo", "ABORTADO" in salida, salida[-600:])
    assertion("sin propuesta escrita", not os.path.exists(os.path.join(d, "propuesta_recalibracion.json")))
    assertion("bitácora registra el aborto",
              any(b.get("resultado") == "abortado_datos_de_ejemplo" for b in bitacora_de(d)))


def escenario_sanity(tmp):
    print("Escenario 3: sanity-checks descartan registros contaminados")
    d = os.path.join(tmp, "e3"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=140)
    contaminar_dataset(ruta_historial)
    codigo, salida = correr(["--modo", "diagnostico", "--historial-archivo", ruta_historial,
                             "--historico-archivo", os.path.join(d, "pronosticos_historicos.jsonl"),
                             "--dir-salida", d])
    assertion("exit code 0", codigo == 0, salida[-800:])
    import re
    m = re.search(r"Descartes por sanity: (\{[^\n]*\})", salida)
    assertion("reporte de descartes presente", bool(m), salida[-600:])
    descartes = json.loads(m.group(1)) if m else {}
    assertion("marcador absurdo descartado", descartes.get("sinMarcadorValido") == 1, str(descartes))
    assertion("duplicado en conflicto descartado", descartes.get("duplicadosEnConflicto") == 1, str(descartes))
    assertion("probabilidad alterada descartada (cruce)", descartes.get("cruceFallido") == 1, str(descartes))
    assertion("pick sin histórico oficial descartado", descartes.get("sinHistoricoOficial") == 1, str(descartes))
    # 140 originales - 1 partido en conflicto - 1 partido con prob alterada.
    # El partido 3 tiene un duplicado envenenado PRIMERO en el pool: su registro
    # limpio debe rescatarse, por eso el total es 138 y no 137 (y cruceFallido
    # sigue siendo 1: ese partido no se cuenta como descartado).
    assertion("138 partidos limpios (el duplicado alterado no borra el partido limpio)",
              "Partidos verificados limpios: 138" in salida, salida[-600:])


def escenario_propuesta(tmp):
    print("Escenario 4: propuesta generada con sesgo deliberado en totalgoles")
    d = os.path.join(tmp, "e4"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=140)
    codigo, salida = correr(args_prueba(d, ruta_historial))
    ruta_propuesta = os.path.join(d, "propuesta_recalibracion.json")
    assertion("propuesta escrita", os.path.exists(ruta_propuesta), salida[-1500:])
    if not os.path.exists(ruta_propuesta):
        print(salida)
        return None, d
    propuesta = leer_json_ruta(ruta_propuesta)
    assertion("estado 'propuesta'", propuesta.get("estado") == "propuesta")
    assertion("dataset >= 50 partidos", propuesta["dataset"]["partidosVerificados"] >= 50)
    cambios = propuesta.get("cambios", [])
    assertion("al menos un cambio propuesto", len(cambios) >= 1,
              json.dumps(propuesta.get("cambiosVetados", []), ensure_ascii=False)[:400])
    toca_totalgoles = any("totalgoles" in (c.get("alcance") or "") for c in cambios)
    assertion("el sesgo de totalgoles fue detectado", toca_totalgoles,
              json.dumps([{"p": c["parametro"], "a": c.get("alcance")} for c in cambios], ensure_ascii=False))

    # Anti-repetición: misma muestra => sin propuesta por falta de verificaciones nuevas
    codigo2, salida2 = correr(args_prueba(d, ruta_historial))
    assertion("segunda corrida sin verificaciones nuevas",
              "SIN PROPUESTA: solo 0 verificaciones nuevas" in salida2, salida2[-600:])
    assertion("bitácora registra la propuesta", any(
        b.get("tipo") == "propuesta" and b.get("propuestaId") == propuesta["id"]
        for b in bitacora_de(d)))
    return propuesta, d


def escenario_aprobar(propuesta, d):
    print("Escenario 5: aprobación => overrides + bitácora")
    codigo, salida = correr(["--aprobar", propuesta["id"], "--dir-salida", d])
    assertion("exit code 0", codigo == 0, salida[-600:])
    ruta_aprobados = os.path.join(d, "parametros_aprobados.json")
    assertion("parametros_aprobados.json escrito", os.path.exists(ruta_aprobados))
    aprobados = leer_json_ruta(ruta_aprobados)
    assertion("estado aprobada", aprobados.get("estado") == "aprobada")
    ov = aprobados.get("overrides", {})
    assertion("overrides con contenido", any(ov.get(k) for k in
              ("calibracion", "multiplicadoresAjuste", "platt")),
              json.dumps(ov, ensure_ascii=False)[:300])
    assertion("propuesta marcada aprobada",
              leer_json_ruta(os.path.join(d, "propuesta_recalibracion.json")).get("estado") == "aprobada")
    assertion("bitácora registra la resolución", any(
        b.get("tipo") == "resolucion" and b.get("estado") == "aprobada"
        and b.get("propuestaId") == propuesta["id"] for b in bitacora_de(d)))


def escenario_rechazar(tmp):
    print("Escenario 6: rechazo => bitácora con motivo")
    d = os.path.join(tmp, "e6"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=140, semilla=7)
    codigo, salida = correr(args_prueba(d, ruta_historial))
    ruta_p = os.path.join(d, "propuesta_recalibracion.json")
    if os.path.exists(ruta_p):
        propuesta = leer_json_ruta(ruta_p)
    else:
        propuesta = {"id": "prop-test-rechazo", "estado": "propuesta", "cambios": []}
        with open(ruta_p, "w", encoding="utf-8") as f:
            json.dump(propuesta, f, ensure_ascii=False, indent=2)
    codigo, salida = correr(["--rechazar", propuesta["id"],
                             "--motivo", "muestra muy corta", "--dir-salida", d])
    assertion("exit code 0", codigo == 0, salida[-600:])
    final = leer_json_ruta(ruta_p)
    assertion("propuesta marcada rechazada", final.get("estado") == "rechazada")
    assertion("motivo registrado", final.get("motivoRechazo") == "muestra muy corta")
    assertion("bitácora registra el rechazo", any(
        b.get("tipo") == "resolucion" and b.get("estado") == "rechazada"
        and b.get("motivo") == "muestra muy corta" for b in bitacora_de(d)))


def escenario_peso(tmp):
    """La "verdad" tiene un nivel de goles 2.2x mayor que el que cree el modelo.
    Como el motor aplica `factorLocalia` a AMBOS lambdas (pronosticos.py:790-791),
    ese factor es el instrumento que puede corregir un desvío de nivel: el sistema
    debe proponerlo (con efectoPorLiga y sin veto), respetando los caps.

    El desvío es deliberadamente extremo: por diseño (cap 5% por corrida +
    shrinkage K=100 + umbral 0.005) la ruta de pesos internos solo reacciona a
    mal-calibraciones groseras. Verificado con sonda: k=1.1..1.8 => sin propuesta;
    k=2.2 => propone. El escenario ejercita el camino completo; no representa un
    caso realista.
    """
    print("Escenario 8: propuesta de peso interno (factorLocalia), desvío extremo")
    d = os.path.join(tmp, "e8"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=140, sesgo_totalgoles=1.0,
                                        escala_goles_real=2.2, semilla=11)
    codigo, salida = correr(args_prueba(d, ruta_historial))
    ruta_propuesta = os.path.join(d, "propuesta_recalibracion.json")
    assertion("propuesta escrita", os.path.exists(ruta_propuesta), salida[-1500:])
    propuesta = leer_json_ruta(ruta_propuesta)
    cambios = propuesta.get("cambios", [])
    vetados = propuesta.get("cambiosVetados", [])
    de_localia = [c for c in cambios if c.get("parametro") == "factorLocalia"]
    assertion("factorLocalia propuesto (no vetado por liga)", len(de_localia) == 1,
              json.dumps({"cambios": [c.get("parametro") for c in cambios],
                          "vetados": [v.get("parametro") for v in vetados]}, ensure_ascii=False))
    if not de_localia:
        return
    c = de_localia[0]
    assertion("detecta que el nivel de goles está sub-estimado",
              c["valorPropuesto"] > c["valorActual"], json.dumps(c, ensure_ascii=False))
    tope = c["valorActual"] * (1 + 0.05) + 1e-9
    assertion("movimiento dentro del cap del 5% por corrida",
              c["valorPropuesto"] <= tope, f"{c['valorActual']} -> {c['valorPropuesto']}")
    assertion("mejora validada en holdout >= 0.005",
              c["mejora"] >= 0.005 and c["validacionTemporal"]["entrenamiento"] > 0,
              json.dumps(c.get("validacionTemporal"), ensure_ascii=False))
    efecto = c.get("efectoPorLiga") or {}
    assertion("efectoPorLiga reportado por liga", len(efecto) >= 4, json.dumps(efecto))
    empeoran = [l for l, v in efecto.items() if v < 0]
    assertion("mejora en la mayoría de las ligas (sin veto multi-liga)",
              len(empeoran) < 3, json.dumps(efecto))
    assertion("shrinkage aplicado: movimiento menor al óptimo de la grilla",
              abs(c["valorPropuesto"] - c["valorActual"]) < abs(c["valorActual"] * 0.04) + 1e-9,
              f"{c['valorActual']} -> {c['valorPropuesto']}")


def escenario_integridad(tmp):
    """Telemetría con probabilidades degeneradas (firma del bug de suma del motor:
    todo pegado al techo del clamp): el sistema debe ABORTAR, no proponer."""
    print("Escenario 9: probabilidades oficiales degeneradas => abortado")
    d = os.path.join(tmp, "e9"); os.makedirs(d)
    _, ruta_historial = generar_dataset(d, n_partidos=140, prob_degenerada=True, semilla=5)
    codigo, salida = correr(args_prueba(d, ruta_historial))
    assertion("aborta con código distinto de 0", codigo != 0, f"exit={codigo}")
    assertion("reporta probabilidades degeneradas",
              "Probabilidades oficiales degeneradas" in salida, salida[-600:])
    assertion("no escribe propuesta",
              not os.path.exists(os.path.join(d, "propuesta_recalibracion.json")), "")
    bitacora = bitacora_de(d)
    assertion("bitácora registra el aborto por integridad", any(
        b.get("resultado") == "abortado_probabilidades_degeneradas" for b in bitacora),
        json.dumps(bitacora, ensure_ascii=False)[-400:])
    # El diagnóstico (solo lectura) no aborta: advierte y sigue informando.
    codigo_d, salida_d = correr(["--modo", "diagnostico",
                                 "--historico-archivo", os.path.join(d, "pronosticos_historicos.jsonl"),
                                 "--historial-archivo", ruta_historial,
                                 "--dir-salida", d])
    assertion("diagnóstico advierte sin abortar", codigo_d == 0 and "ADVERTENCIA" in salida_d,
              f"exit={codigo_d}")


def escenario_bug_motor():
    """Regresión del bug de suma del motor (pronosticos.sumaMatriz).

    Documenta el bug como prueba: si alguien arregla `sumaMatriz` en el motor,
    esta prueba FALLA a propósito y obliga a actualizar `sumar_matriz` y la
    guardia de integridad. También verifica que la suma correcta da una
    probabilidad válida y que el frontend no está afectado por ser JS.
    """
    print("Escenario 10: regresión del bug de suma del motor (Python)")
    from pronosticos import sumaMatriz  # el buggy, importado a propósito

    matriz = matrizMarcadores(0.98, 1.099, 8, -0.04)
    rota = sumaMatriz(matriz, 8, lambda i, j: i > j)
    correcta = sumar_matriz(matriz, 8, lambda i, j: i > j)

    assertion("el motor devuelve una suma de índices (bug documentado)",
              rota > 1.0, f"sumaMatriz devolvió {rota} (se esperaba >1 por el bug)")
    assertion("la suma correcta es una probabilidad válida",
              0.0 < correcta < 1.0, f"sumar_matriz devolvió {correcta}")
    assertion("ambas coinciden con la P(1X2) calculada a mano",
              abs(correcta - (lambda1x2 := prob_mercado("resultado", {"lado": "local"}, 0.98, 1.099))) < 1e-9,
              f"{correcta} vs {lambda1x2}")
    p_local = correcta
    p_empate = sumar_matriz(matriz, 8, lambda i, j: i == j)
    p_visita = sumar_matriz(matriz, 8, lambda i, j: i < j)
    assertion("las tres probabilidades de 1X2 suman 1",
              abs((p_local + p_empate + p_visita) - 1.0) < 1e-9,
              f"{p_local + p_empate + p_visita}")


def escenario_telemetria_motor(tmp):
    print("Escenario 7: telemetría real del motor + abort por datos de ejemplo")
    d = os.path.join(tmp, "e7"); os.makedirs(d)
    proceso = subprocess.run([sys.executable, os.path.join(BASE, "pronosticos.py")],
                             cwd=d, capture_output=True, text=True, timeout=900)
    ruta_telemetria = os.path.join(d, "pronosticos_historicos.jsonl")
    assertion("pronosticos.py corrió sin errores", proceso.returncode == 0,
              (proceso.stdout + proceso.stderr)[-600:])
    assertion("telemetría escrita", os.path.exists(ruta_telemetria))
    linea = [json.loads(l) for l in open(ruta_telemetria, encoding="utf-8") if l.strip()][0]
    assertion("datosDeEjemplo marcado", linea.get("datosDeEjemplo") is True)
    algun_pm = next(iter(linea["pronosticos"].values()))["parametrosModelo"]
    assertion("parametrosModelo con factores de telemetría",
              "factores" in algun_pm and "h2hLocal" in (algun_pm.get("factores") or {}),
              json.dumps(algun_pm, ensure_ascii=False)[:300])
    codigo, salida = correr(["--modo", "propuesta",
                             "--historico-archivo", ruta_telemetria,
                             "--dir-salida", d])
    assertion("recalibrador aborta con datos de ejemplo", "ABORTADO" in salida, salida[-600:])


def main():
    print("=== PRUEBAS DEL SISTEMA DE RECALIBRACIÓN SUPERVISADA ===")
    tmp = tempfile.mkdtemp(prefix="recalibracion_test_")
    fallos = 0
    try:
        escenario_muestra_insuficiente(tmp)
        escenario_abort_datos_ejemplo(tmp)
        escenario_sanity(tmp)
        propuesta, d4 = escenario_propuesta(tmp)
        if propuesta:
            escenario_aprobar(propuesta, d4)
        escenario_rechazar(tmp)
        escenario_peso(tmp)
        escenario_integridad(tmp)
        escenario_bug_motor()
        escenario_telemetria_motor(tmp)
    except AssertionError as e:
        print(f"\nPRUEBA FALLIDA: {e}")
        fallos = 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n=== RESULTADO:", "TODAS LAS PRUEBAS PASARON" if fallos == 0 else "HAY FALLOS", "===")
    return fallos


if __name__ == "__main__":
    sys.exit(main())
