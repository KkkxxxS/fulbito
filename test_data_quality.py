# -*- coding: utf-8 -*-
"""Pruebas de control de calidad de datos (data_quality.py).

Ejecutar: python test_data_quality.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data_quality import verificar_calidad


def muestra(liga='liga-A', sel='local', p=0.5, y=0, gl=1, gv=0, fecha=None, partidoId=None):
    return {
        'partidoId': partidoId or f'{liga}|{sel}|{fecha}',
        'liga': liga,
        'categoria': '1X2',
        'seleccion': sel,
        'pPredicha': p,
        'y': y,
        'gl': gl,
        'gv': gv,
        'fecha': fecha,
    }


RECENTE = datetime.now(timezone.utc).isoformat()
ANTIGUA = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()


def tipos(r):
    return [p['tipo'] for p in r['problemas']]


def main():
    # Vacío.
    r = verificar_calidad([])
    assert r['total'] == 0 and not r['ok'] and 'vacío' in tipos(r)

    # limpio: 4 ligas con 5 muestras cada una.
    muestras = [muestra(liga=f'l{i}', partidoId=f'p{i}-{j}', p=0.4, y=j % 2, fecha=RECENTE)
                for i in range(4) for j in range(5)]
    r = verificar_calidad(muestras)
    assert r['total'] == 20 and r['ok'] and r['problemas'] == [], r

    # duplicados.
    base = muestra(liga='lX', partidoId='dup', fecha=RECENTE)
    r = verificar_calidad([base, base, muestra(liga='lX', partidoId='otro', fecha=RECENTE)])
    assert 'duplicados' in tipos(r), r

    # frescura.
    r = verificar_calidad([muestra(liga='lF', partidoId='f1', fecha=ANTIGUA)])
    assert 'frescura' in tipos(r), r

    # cobertura de ligas: 2 ligas de 3 no alcanzan >=4.
    muestras = [muestra(liga=f'l{i}', partidoId=f'c{i}-{j}', fecha=RECENTE) for i in range(2) for j in range(3)]
    r = verificar_calidad(muestras)
    assert 'cobertura_ligas' in tipos(r), r

    # marcadores inválidos.
    r = verificar_calidad([muestra(liga='lM', partidoId='m1', p=1.5, fecha=RECENTE),
                           muestra(liga='lM', partidoId='m2', p=0.5, y=2, fecha=RECENTE)])
    assert 'marcadores_invalidos' in tipos(r), r

    print('  [OK] data_quality: vacío, limpio, duplicados, frescura, cobertura, marcadores')
    print('=== RESULTADO: OK ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())
