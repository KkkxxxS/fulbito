# -*- coding: utf-8 -*-
"""
Gobernanza de parámetros aprobados.

Verifica el contrato que faltaba:
  - solo `estado == "aprobada"` se consume;
  - el kill switch ignora overrides sin borrar el archivo;
  - aprobar registra actor, versión y hash;
  - `--dry-run` no escribe nada;
  - rechazar no escribe overrides y deja bitácora.

Ejecutar: python test_gobernanza.py
"""
import json
import os
import sys
import tempfile

import pronosticos as P
import recalibracion as R

FALLOS = 0


def check(nombre, condicion, detalle=""):
    global FALLOS
    estado = "OK  " if condicion else "FALLA"
    print(f"  [{estado}] {nombre}" + (f" - {detalle}" if detalle and not condicion else ""))
    if not condicion:
        FALLOS += 1


def escribir_propuesta(rutas, id_propuesta="prop-test"):
    R.escribir_json(rutas["propuesta"], {
        "id": id_propuesta,
        "estado": "propuesta",
        "generadoEn": "2026-01-01T00:00:00+00:00",
        "cambios": [{
            "parametro": "factorLocalia",
            "alcance": "global",
            "valorActual": 1.08,
            "valorPropuesto": 1.1,
            "mejora": 0.01,
            "nota": "prueba de gobernanza",
        }],
    })


def leer_bitacora(rutas):
    if not os.path.exists(rutas["bitacora"]):
        return []
    with open(rutas["bitacora"], "r", encoding="utf-8") as f:
        return [json.loads(linea) for linea in f if linea.strip()]


def escenario_lectura(tmp):
    print("\n1. Lectura de overrides")
    ruta = os.path.join(tmp, "aprobados.json")

    check("sin archivo devuelve None", P.cargar_parametros_aprobados(ruta) is None)

    R.escribir_json(ruta, {"estado": "propuesta", "overrides": {"calibracion": {"factorLocalia": 1.2}}})
    check("estado 'propuesta' se ignora", P.cargar_parametros_aprobados(ruta) is None)

    R.escribir_json(ruta, {
        "estado": "aprobada",
        "propuestaId": "prop-1",
        "aprobadoPor": "qa",
        "version": "params-prop-1",
        "overrides": {"calibracion": {"factorLocalia": 1.1}},
    })
    overrides = P.cargar_parametros_aprobados(ruta)
    check("estado 'aprobada' se consume", overrides == {"calibracion": {"factorLocalia": 1.1}})

    overrides, meta = P.cargar_parametros_aprobados(ruta, con_metadata=True)
    check("metadata incluye actor", meta.get("aprobadoPor") == "qa")
    check("metadata incluye versión", meta.get("version") == "params-prop-1")

    anterior = os.environ.get("FULBITO_IGNORE_APPROVED_PARAMS")
    os.environ["FULBITO_IGNORE_APPROVED_PARAMS"] = "1"
    try:
        check("kill switch ignora overrides", P.cargar_parametros_aprobados(ruta) is None)
    finally:
        if anterior is None:
            os.environ.pop("FULBITO_IGNORE_APPROVED_PARAMS", None)
        else:
            os.environ["FULBITO_IGNORE_APPROVED_PARAMS"] = anterior


def escenario_aprobacion(tmp):
    print("\n2. Aprobación: dry-run, escritura y bitácora")
    rutas = R.resolver_rutas(tmp)
    escribir_propuesta(rutas)

    resultado = R.aprobar_propuesta("prop-test", rutas, actor="qa", dry_run=True)
    check("dry-run devuelve 0", resultado == 0)
    check("dry-run no escribe overrides", not os.path.exists(rutas["aprobados"]))
    propuesta = R.leer_json(rutas["propuesta"])
    check("dry-run no cambia el estado", propuesta.get("estado") == "propuesta")

    resultado = R.aprobar_propuesta("prop-test", rutas, actor="qa")
    check("aprobación devuelve 0", resultado == 0)
    aprobados = R.leer_json(rutas["aprobados"])
    check("estado aprobada", aprobados.get("estado") == "aprobada")
    check("actor registrado", aprobados.get("aprobadoPor") == "qa")
    check("versión registrada", aprobados.get("version") == "params-prop-test")
    check("hash registrado", bool(aprobados.get("hashOverrides")))
    check("aplicación documentada", "FULBITO_IGNORE_APPROVED_PARAMS" in (aprobados.get("aplicacion") or ""))
    check("override de localía", aprobados.get("overrides", {}).get("calibracion", {}).get("factorLocalia") == 1.1)

    propuesta = R.leer_json(rutas["propuesta"])
    check("propuesta resuelta", propuesta.get("estado") == "aprobada")
    check("resuelta por actor", propuesta.get("resueltaPor") == "qa")

    entradas = leer_bitacora(rutas)
    ultima = entradas[-1] if entradas else {}
    check("bitácora registra resolución", ultima.get("tipo") == "resolucion")
    check("bitácora registra actor", ultima.get("actor") == "qa")
    check("bitácora registra versión", ultima.get("version") == "params-prop-test")


def escenario_rechazo(tmp):
    print("\n3. Rechazo: no escribe overrides y deja motivo")
    rutas = R.resolver_rutas(tmp)
    escribir_propuesta(rutas)

    resultado = R.rechazar_propuesta("prop-test", "no cumple el gate", rutas, actor="qa")
    check("rechazo devuelve 0", resultado == 0)
    check("rechazo no escribe overrides", not os.path.exists(rutas["aprobados"]))

    propuesta = R.leer_json(rutas["propuesta"])
    check("estado rechazada", propuesta.get("estado") == "rechazada")
    check("motivo registrado", propuesta.get("motivoRechazo") == "no cumple el gate")
    check("resuelta por actor", propuesta.get("resueltaPor") == "qa")

    entradas = leer_bitacora(rutas)
    ultima = entradas[-1] if entradas else {}
    check("bitácora registra rechazo", ultima.get("estado") == "rechazada")
    check("bitácora registra actor", ultima.get("actor") == "qa")
    check("bitácora registra motivo", ultima.get("motivo") == "no cumple el gate")


def escenario_id_invalido(tmp):
    print("\n4. Id inválido no escribe nada")
    rutas = R.resolver_rutas(tmp)
    escribir_propuesta(rutas)
    resultado = R.aprobar_propuesta("otro-id", rutas, actor="qa")
    check("id inválido devuelve 1", resultado == 1)
    check("id inválido no escribe overrides", not os.path.exists(rutas["aprobados"]))


def main():
    print("=== PRUEBAS DE GOBERNANZA DE PARÁMETROS ===")
    with tempfile.TemporaryDirectory() as tmp:
        escenario_lectura(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        escenario_aprobacion(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        escenario_rechazo(tmp)
    with tempfile.TemporaryDirectory() as tmp:
        escenario_id_invalido(tmp)

    print(f"\n=== RESULTADO: {'OK' if FALLOS == 0 else str(FALLOS) + ' FALLOS'} ===")
    return 1 if FALLOS else 0


if __name__ == "__main__":
    sys.exit(main())
