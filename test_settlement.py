# -*- coding: utf-8 -*-
"""
Contrato de liquidación: Python (pronosticos.py).

Lee los mismos fixtures que test-settlement.js para garantizar que el motor,
el servidor y el cliente liquidan igual. Cualquier divergencia es un fallo.
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(BASE, "tests", "fixtures", "settlement.json")

import pronosticos as P


def cargar_casos():
    with open(FIXTURES, "r", encoding="utf-8") as f:
        return json.load(f)["casos"]


def main():
    print("=== CONTRATO DE LIQUIDACION (Python) ===")
    try:
        casos = cargar_casos()
    except (OSError, KeyError, json.JSONDecodeError) as e:
        print(f"[FALLA] No se pudieron cargar los fixtures: {e}")
        return 1

    fallos = 0
    for caso in casos:
        cid = caso.get("id", "?")
        try:
            obtenido = bool(P.verificarMercado(
                caso["categoria"], caso.get("parametros") or {},
                caso["gl"], caso["gv"]
            ))
            error = ""
        except Exception as e:  # parametros incompletos no deben romper
            obtenido = None
            error = f"{type(e).__name__}: {e}"

        esperado = bool(caso["esperado"])
        if obtenido != esperado:
            fallos += 1
            detalle = f"esperado={esperado} obtenido={obtenido}"
            if error:
                detalle += f" ({error})"
            print(f"  [FALLA] {cid}: {detalle}")
        else:
            print(f"  [OK   ] {cid}")

    print(f"\n=== RESULTADO: {len(casos) - fallos}/{len(casos)} OK ===")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
