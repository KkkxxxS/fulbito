# -*- coding: utf-8 -*-
"""
Test de Paridad Numerica Cross-Language: Python (pronosticos.py) vs JS (app-model.js)
"""

import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))

import pronosticos as P

def check(nombre, condicion, detalle=""):
    estado = "OK " if condicion else "FALLA"
    print(f"  [{estado}] {nombre}" + (f" - {detalle}" if detalle and not condicion else ""))
    if not condicion:
        raise AssertionError(nombre + (" - " + detalle if detalle else ""))

def correr_js_eval(codigo_expr):
    codigo_json = json.dumps(f"(function() {{ return {codigo_expr}; }})()")
    js_script = f"""
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const codigo = fs.readFileSync(path.join('{BASE.replace(chr(92), '/')}', 'app-model.js'), 'utf8');
    const sandbox = {{
      console, Math, Date, JSON, Number, Object, Array, String, Set, Map,
      localStorage: {{ getItem: () => null, setItem: () => {{}}, removeItem: () => {{}} }},
      fetch: async () => ({{ ok: true, json: async () => ({{}}) }}),
      document: {{ addEventListener() {{}}, removeEventListener() {{}}, querySelectorAll: () => [], getElementById: () => ({{ style: {{ setProperty() {{}} }}, classList: {{ add() {{}}, remove() {{}}, toggle() {{}} }} }}) }},
      window: {{}},
      history: {{ replaceState() {{}} }},
      location: {{ hash: '' }},
      requestAnimationFrame: (cb) => cb(0),
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval
    }};
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(codigo, sandbox);
    const res = vm.runInContext({codigo_json}, sandbox);
    process.stdout.write(JSON.stringify(res));
    """
    p = subprocess.run(['node', '-e', js_script], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"Error evaluando JS: {p.stderr}")
    return json.loads(p.stdout)

def main():
    print("=== TEST DE PARIDAD NUMERICA PYTHON <-> JS ===")
    fallos = 0

    try:
        print("\n1. Funcion Poisson")
        for k in [0, 1, 2, 3, 5]:
            for lam in [0.8, 1.25, 2.1]:
                py_val = P.poisson(k, lam)
                js_val = correr_js_eval(f"poisson({k}, {lam})")
                check(f"poisson({k}, {lam})", abs(py_val - js_val) < 1e-9, f"py={py_val} vs js={js_val}")

        print("\n2. Ajuste Dixon-Coles (Tau)")
        ll, lv, rho = 1.45, 1.10, -0.04
        for gl, gv in [(0,0), (0,1), (1,0), (1,1), (2,2)]:
            js_tau = correr_js_eval(f"tauDixonColes({gl}, {gv}, {ll}, {lv}, {rho})")
            if gl == 0 and gv == 0: esperado = 1 - ll * lv * rho
            elif gl == 0 and gv == 1: esperado = 1 + ll * rho
            elif gl == 1 and gv == 0: esperado = 1 + lv * rho
            elif gl == 1 and gv == 1: esperado = 1 - rho
            else: esperado = 1.0
            check(f"tau({gl}, {gv})", abs(js_tau - esperado) < 1e-9, f"js={js_tau} vs esperado={esperado}")

        print("\n3. Matriz de Marcadores (Dixon-Coles)")
        ll, lv, rho = 1.62, 1.18, -0.04
        py_mat = P.matrizMarcadores(ll, lv, 8, rho)
        js_mat = correr_js_eval(f"matrizMarcadores({ll}, {lv}, 8, {rho})")
        max_dif = 0.0
        for i in range(9):
            for j in range(9):
                max_dif = max(max_dif, abs(py_mat['get'](i, j) - js_mat[i][j]))
        check("matriz identica", max_dif < 1e-9, f"max_dif={max_dif}")

        print("\n4. Verificacion de Mercados")
        mercados_test = [
            ("resultado", {"lado": "local"}, 2, 1, True),
            ("resultado", {"lado": "local"}, 1, 1, False),
            ("doble", {"lado": "1X"}, 1, 1, True),
            ("doble", {"lado": "X2"}, 0, 1, True),
            ("totalgoles", {"linea": 2.5, "direccion": "mas"}, 2, 1, True),
            ("totalgoles", {"linea": 2.5, "direccion": "menos"}, 1, 1, True),
            ("btts", {"si": True}, 1, 1, True),
            ("btts", {"si": True}, 2, 0, False),
            ("equipomarca", {"lado": "visita"}, 0, 1, True),
            ("handicap", {"lado": "local", "valor": 2}, 3, 1, True),
            ("handicap", {"lado": "local", "valor": 2}, 2, 1, False),
            ("marcador", {"gl": 2, "gv": 1}, 2, 1, True)
        ]
        for cat, params, gl, gv, exp in mercados_test:
            py_res = P.verificarMercado(cat, params, gl, gv)
            js_res = correr_js_eval(f"verificarMercado('{cat}', {json.dumps(params)}, {gl}, {gv})")
            check(f"mercado {cat} ({gl}-{gv})", py_res == exp and js_res == exp)

        print("\n5. Candidatos de Mercado")
        py_cand = P.ModeloEstadistico(P.Config()).generarCandidatosMercado(py_mat, 8, "Local", "Visita")
        js_cand = correr_js_eval(f"generarCandidatosMercado(matrizMarcadores({ll}, {lv}, 8, {rho}), 8, 'Local', 'Visita')")
        check("mismo marcador probable", py_cand['marcadorProbable'] == js_cand['marcadorProbable'])
        check("mismo favorito", py_cand['favoritoLocal'] == js_cand['favoritoLocal'])

    except AssertionError as e:
        print(f"\nFALLO DE PARIDAD: {e}")
        fallos = 1
    except Exception as e:
        print(f"\nERROR: {e}")
        fallos = 1

    print("\n=== RESULTADO FINAL:", "PARIDAD CONFIRMADA AL 100%" if fallos == 0 else "HAY DISCREPANCIAS", "===")
    return fallos

if __name__ == '__main__':
    sys.exit(main())
