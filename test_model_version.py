# -*- coding: utf-8 -*-
"""Paridad de la versión del modelo entre Python y JS (Fase 5.1).

Ejecutar: python test_model_version.py
"""
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))


def version_python():
    texto = open(os.path.join(BASE, 'pronosticos.py'), encoding='utf-8').read()
    m = re.search(r'MODEL_VERSION\s*=\s*["\']([^"\']+)["\']', texto)
    return m.group(1) if m else None


def version_js():
    texto = open(os.path.join(BASE, 'packages', 'domain', 'version.js'), encoding='utf-8').read()
    m = re.search(r'MODEL_VERSION\s*=\s*["\']([^"\']+)["\']', texto)
    return m.group(1) if m else None


def main():
    vp, vj = version_python(), version_js()
    assert vp, 'MODEL_VERSION no definido en pronosticos.py'
    assert vj, 'MODEL_VERSION no definido en packages/domain/version.js'
    assert vp == vj, f'Versiones desincronizadas: python={vp} js={vj}'
    print(f'  [OK] versiones sincronizadas: {vp}')
    print('=== RESULTADO: OK ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())
