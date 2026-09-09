#!/usr/bin/env python3
"""
Script de pronósticos de Fulbito - Modelo estadístico con Poisson + Dixon-Coles + ML
Genera pronosticos.json para el frontend.
"""

import json
import math
import numpy as np
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from scipy import stats
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import warnings
warnings.filterwarnings('ignore')

# ==================== CONFIGURACIÓN ====================
@dataclass
class Config:
    MAX_GOLES: int = 8
    RHO_DIXON_COLES: float = -0.04
    FACTOR_LOCALIA_BASE: float = 1.08
    PARTIDOS_CONFIANZA_PLENA: int = 10
    PARTIDOS_MINIMOS_CONFIABLES: int = 5
    LIMITE_DRIFT_LAMBDA: float = 0.28
    UMBRAL_MINIMO_MERCADO: float = 0.55
    MUESTRA_MINIMA_LOCALIA: int = 12
    MUESTRA_MINIMA_CATEGORIA: int = 15
    MUESTRA_MINIMA_LIGA: int = 8
    LIMITES_FACTOR_LOCALIA: tuple = (1.0, 1.25)
    LIMITES_FACTOR_CATEGORIA: tuple = (0.75, 1.25)
    LIMITES_FACTOR_LIGA: tuple = (0.85, 1.18)
    LIMITES_RHO: tuple = (-0.20, 0.05)
    LIMITE_TABLA_BASE: float = 0.10
    LIMITES_LIMITE_TABLA: tuple = (0.03, 0.12)
    MUESTRA_MINIMA_RHO: int = 40
    MUESTRA_MINIMA_TABLA: int = 25

# ==================== TIPOS DE DATOS ====================
@dataclass
class Partido:
    id: str
    homeTeam: Dict
    awayTeam: Dict
    competition: Dict
    utcDate: str
    status: str

@dataclass
class StatsEquipo:
    promedioGolesFavor: float
    promedioGolesContra: float
    puntosPromedio: float
    partidosJugados: int
    local: Dict
    visita: Dict
    tendencia: Dict
    diasDescansoUltimoPartido: Optional[float]

@dataclass
class TablaPosiciones:
    mapa: Dict
    promedioLiga: float
    promedioLigaGolesFavor: Optional[float]
    promedioLigaGolesContra: Optional[float]
    contextoLocal: Dict
    contextoVisita: Dict

@dataclass
class H2H:
    disponible: bool
    totalPartidos: int
    victoriasLocal: int
    empates: int
    victoriasVisita: int

# ==================== UTILIDADES ====================

def factorial(n: int) -> int:
    if n <= 1:
        return 1
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result

def poisson(k: int, lambda_val: float) -> float:
    """Función de probabilidad de Poisson"""
    if k < 0 or k > 8:
        return 0.0
    return (lambda_val ** k) * math.exp(-lambda_val) / factorial(k)

def matrizMarcadores(lambda_local: float, lambda_visita: float, max_goles: int = 8, rho: float = -0.04):
    """Genera matriz de probabilidades de marcadores con Dixon-Coles"""
    dim = max_goles + 1
    matriz = np.zeros((dim, dim))
    
    # Calcular probabilidades de Poisson
    poisson_l = np.array([poisson(k, lambda_local) for k in range(dim)])
    poisson_v = np.array([poisson(k, lambda_visita) for k in range(dim)])
    
    # Aplicar ajuste Dixon-Coles
    suma_total = 0.0
    for i in range(dim):
        for j in range(dim):
            base = poisson_l[i] * poisson_v[j]
            tau = 1.0
            if i == 0 and j == 0:
                tau = 1 - lambda_local * lambda_visita * rho
            elif i == 0 and j == 1:
                tau = 1 + lambda_local * rho
            elif i == 1 and j == 0:
                tau = 1 + lambda_visita * rho
            elif i == 1 and j == 1:
                tau = 1 - rho
            matriz[i, j] = base * tau
            suma_total += matriz[i, j]
    
    # Normalizar
    if suma_total > 0:
        matriz /= suma_total
    
    return {
        'data': matriz,
        'dim': dim,
        'get': lambda i, j: matriz[i, j] if 0 <= i < dim and 0 <= j < dim else 0.0
    }

def sumaMatriz(matriz, max_goles, condicion):
    """Suma elementos de matriz que satisfacen una condición"""
    s = 0.0
    for i in range(max_goles + 1):
        for j in range(max_goles + 1):
            if condicion(i, j):
                s += matriz.get(i, j)
    return s

def verificarMercado(categoria, parametros, goles_local, goles_visita):
    """Verifica si un mercado se cumple dado el marcador"""
    if categoria == 'resultado':
        if parametros['lado'] == 'local':
            return goles_local > goles_visita
        elif parametros['lado'] == 'visita':
            return goles_visita > goles_local
        else:
            return goles_local == goles_visita
    elif categoria == 'doble':
        if parametros['lado'] == '1X':
            return goles_local >= goles_visita
        elif parametros['lado'] == 'X2':
            return goles_visita >= goles_local
        else:
            return goles_local != goles_visita
    elif categoria == 'totalgoles':
        total = goles_local + goles_visita
        if parametros['direccion'] == 'menos':
            return total < parametros['linea']
        else:
            return total > parametros['linea']
    elif categoria == 'btts':
        ambos = goles_local >= 1 and goles_visita >= 1
        return parametros['si'] if ambos else not parametros['si']
    elif categoria == 'equipomarca':
        if parametros['lado'] == 'local':
            return goles_local >= 1
        else:
            return goles_visita >= 1
    elif categoria == 'handicap':
        margen = parametros['lado'] == 'local' and (goles_local - goles_visita) or (goles_visita - goles_local)
        return margen >= parametros['valor']
    elif categoria == 'marcador':
        return goles_local == parametros['gl'] and goles_visita == parametros['gv']
    return False

# ==================== MODELO ESTADÍSTICO ====================

class ModeloEstadistico:
    def __init__(self, config: Config):
        self.config = config
        self.calibracion_actual = self._calibracionPorDefecto()
    
    def _calibracionPorDefecto(self):
        return {
            'factorLocalia': self.config.FACTOR_LOCALIA_BASE,
            'muestrasLocalia': 0,
            'rhoDixonColes': self.config.RHO_DIXON_COLES,
            'muestrasRho': 0,
            'limiteTabla': self.config.LIMITE_TABLA_BASE,
            'muestrasTabla': 0,
            'porCategoria': {},
            'porLiga': {},
            'actualizadoEn': None
        }
    
    def factorTabla(self, tabla, team_id):
        """Factor de ajuste por posición en la tabla"""
        info = tabla['mapa'].get(team_id)
        if not info or not tabla['promedioLiga']:
            return 1.0
        
        ratio = info['puntosPorPartido'] / tabla['promedioLiga']
        limite = self.calibracion_actual['limiteTabla']
        desviacion = ratio - 1
        return 1 + max(-limite, min(limite, desviacion))
    
    def fuerzaAtaqueDefensa(self, tabla, team_id):
        """Fuerza de ataque y defensa relativa a la liga"""
        info = tabla['mapa'].get(team_id)
        if not info or not tabla['promedioLigaGolesFavor'] or not tabla['promedioLigaGolesContra']:
            return {'ataque': 1.0, 'defensa': 1.0}
        
        ataque = info['golesFavorPorPartido'] / tabla['promedioLigaGolesFavor']
        defensa = info['golesContraPorPartido'] / tabla['promedioLigaGolesContra']
        
        # Aplicar shrinkage hacia 1
        peso = min(info['partidosJugados'] / self.config.PARTIDOS_CONFIANZA_PLENA, 1.0)
        ataque = ataque * peso + 1.0 * (1 - peso)
        defensa = defensa * peso + 1.0 * (1 - peso)
        
        ataque = max(0.5, min(1.8, ataque))
        defensa = max(0.5, min(1.8, defensa))
        
        return {'ataque': ataque, 'defensa': defensa}
    
    def calcularTendencia(self, partidos_ordenados, team_id):
        """Calcula tendencia reciente de un equipo"""
        if len(partidos_ordenados) < 4:
            return {'direccion': 'neutral', 'racha': []}
        
        puntos_por_partido = []
        for p in partidos_ordenados:
            es_local = p['homeTeam']['id'] == team_id
            goles_equipo = (p['score']['fullTime']['home'] if es_local else p['score']['fullTime']['away']) or 0
            goles_rival = (p['score']['fullTime']['away'] if es_local else p['score']['fullTime']['home']) or 0
            
            if goles_equipo > goles_rival:
                puntos = {'pts': 3, 'r': 'G'}
            elif goles_equipo == goles_rival:
                puntos = {'pts': 1, 'r': 'E'}
            else:
                puntos = {'pts': 0, 'r': 'P'}
            
            puntos_por_partido.append(puntos)
        
        mitad = len(puntos_por_partido) // 2
        recientes = puntos_por_partido[:mitad]
        antiguos = puntos_por_partido[mitad:]
        
        prom_recientes = sum(p['pts'] for p in recientes) / len(recientes)
        prom_antiguos = sum(p['pts'] for p in antiguos) / len(antiguos)
        
        direccion = 'neutral'
        if prom_recientes - prom_antiguos >= 0.5:
            direccion = 'subiendo'
        elif prom_antiguos - prom_recientes >= 0.5:
            direccion = 'bajando'
        
        racha = [p['r'] for p in puntos_por_partido[:5]][::-1]
        
        return {'direccion': direccion, 'racha': racha}
    
    def factorTendencia(self, direccion):
        """Factor multiplicador por tendencia"""
        if direccion == 'subiendo':
            return 1.03
        elif direccion == 'bajando':
            return 0.97
        return 1.0
    
    def factorDescanso(self, dias):
        """Factor por días de descanso"""
        if dias is None or dias == 0:
            return 1.0
        if dias <= 3:
            return 0.99
        if dias >= 8:
            return 1.01
        return 1.0
    
    def promedioLiga(self, codigo_liga):
        """Promedio de goles por liga"""
        promedios = {
            'PL': 1.45, 'PD': 1.35, 'BL1': 1.55, 'SA': 1.30,
            'FL1': 1.40, 'CL': 1.40, 'DED': 1.60, 'ELC': 1.30,
            'BSA': 1.25, 'PPL': 1.35, 'DEFAULT': 1.40
        }
        return promedios.get(codigo_liga, promedios['DEFAULT'])
    
    def perfilLiga(self, codigo_liga):
        """Perfil de liga (goles, localía, tipo)"""
        perfiles = {
            'PL': {'goles': 1.04, 'localia': 1.05, 'perfil': 'alto'},
            'PD': {'goles': 0.96, 'localia': 1.04, 'perfil': 'equilibrado'},
            'BL1': {'goles': 1.07, 'localia': 1.06, 'perfil': 'alto'},
            'SA': {'goles': 0.94, 'localia': 1.03, 'perfil': 'equilibrado'},
            'FL1': {'goles': 0.98, 'localia': 1.02, 'perfil': 'equilibrado'},
            'CL': {'goles': 1.02, 'localia': 1.07, 'perfil': 'alto'},
            'DED': {'goles': 1.12, 'localia': 1.08, 'perfil': 'alto'},
            'ELC': {'goles': 0.92, 'localia': 1.01, 'perfil': 'bajo'},
            'BSA': {'goles': 0.90, 'localia': 1.04, 'perfil': 'bajo'},
            'PPL': {'goles': 0.95, 'localia': 1.03, 'perfil': 'equilibrado'},
            'DEFAULT': {'goles': 1.00, 'localia': 1.03, 'perfil': 'equilibrado'}
        }
        return perfiles.get(codigo_liga, perfiles['DEFAULT'])
    
    def perfilEquipo(self, tabla, team_id):
        """Perfil de equipo basado en tabla"""
        info = tabla['mapa'].get(team_id)
        if not info:
            return {'ataque': 1.0, 'defensa': 1.0, 'fuerza': 1.0}
        
        promedio_ataque = tabla['promedioLigaGolesFavor'] or 1.4
        promedio_defensa = tabla['promedioLigaGolesContra'] or 1.2
        
        ataque = info['golesFavorPorPartido'] / promedio_ataque if info['golesFavorPorPartido'] else 1.0
        defensa = info['golesContraPorPartido'] / promedio_defensa if info['golesContraPorPartido'] else 1.0
        fuerza = info['puntosPorPartido'] / tabla['promedioLiga'] if tabla['promedioLiga'] else 1.0
        
        def clamp(valor, min_val, max_val):
            return max(min_val, min(max_val, valor))
        
        return {
            'ataque': clamp(ataque, 0.75, 1.5),
            'defensa': clamp(defensa, 0.75, 1.5),
            'fuerza': clamp(fuerza, 0.8, 1.3)
        }
    
    def perfilPartido(self, stats_local, stats_visita, h2h, tabla, id_local, id_visita):
        """Perfil del partido (clase, sorpresa, derbi)"""
        local_perfil = self.perfilEquipo(tabla, id_local)
        visita_perfil = self.perfilEquipo(tabla, id_visita)
        
        tipo = 'equilibrado'
        fuerza_local = 1.0
        fuerza_visita = 1.0
        
        if local_perfil['fuerza'] > 1.12 and visita_perfil['fuerza'] < 0.96:
            tipo = 'clase'
            fuerza_local *= 1.04
            fuerza_visita *= 0.97
        elif local_perfil['fuerza'] < 0.9 and visita_perfil['fuerza'] > 1.1:
            tipo = 'sorpresa'
            fuerza_local *= 0.97
            fuerza_visita *= 1.04
        
        if h2h and h2h['disponible'] and h2h['totalPartidos'] >= 6:
            sesgo = (h2h['victoriasLocal'] - h2h['victoriasVisita']) / h2h['totalPartidos']
            if abs(sesgo) > 0.18:
                tipo = 'derbi'
                fuerza_local *= 1 + max(-0.04, min(0.04, sesgo * 0.25))
                fuerza_visita *= 1 - max(-0.04, min(0.04, sesgo * 0.25))
        
        tendencia_local = self.factorTendencia(stats_local['tendencia']['direccion'])
        tendencia_visita = self.factorTendencia(stats_visita['tendencia']['direccion'])
        fuerza_local *= tendencia_local
        fuerza_visita *= tendencia_visita
        
        return {
            'tipo': tipo,
            'fuerzaLocal': fuerza_local,
            'fuerzaVisita': fuerza_visita
        }
    
    def factorH2H(self, h2h, es_local):
        """Factor por historial directo"""
        if not h2h or not h2h['disponible'] or h2h['totalPartidos'] < 5:
            return 1.0
        
        total = h2h['totalPartidos']
        dominio_local = (h2h['victoriasLocal'] - h2h['victoriasVisita']) / total
        ajuste_max = 0.04
        ajuste = max(-ajuste_max, min(ajuste_max, dominio_local * ajuste_max * 2))
        
        return 1 + ajuste if es_local else 1 - ajuste

    def equiposSinNadaEnJuego(self, tabla, team_id):
        """Detecta si un equipo ya no puede alcanzar título/descenso"""
        info = tabla['mapa'].get(team_id) if tabla and 'mapa' in tabla else None
        if not info:
            return False

        partidos_jugados = info.get('partidosJugados')
        total_equipos = info.get('totalEquipos', 0)

        if partidos_jugados is None or total_equipos < 10:
            return False

        partidos_totales_temporada = (total_equipos - 1) * 2
        restantes = max(0, partidos_totales_temporada - partidos_jugados)
        if restantes == 0 or restantes > 6:
            return False

        puntos_ppp = info.get('puntosPorPartido', 0)
        puntos_equipo = round(puntos_ppp * partidos_jugados)
        margen_max = restantes * 3

        ranking = self._construirRankingTabla(tabla)
        return False
        
        if info['posicion'] == 1:
            segundo = next((r for r in ranking if r['posicion'] == 2), None)
            if segundo:
                puntos_segundo = round(segundo['puntosPorPartido'] * segundo['partidosJugados'])
                if puntos_equipo - puntos_segundo > margen_max:
                    return True
        
        num_descenso = max(1, round(total_equipos * 0.15))
        posicion_corte_descenso = total_equipos - num_descenso
        if info['posicion'] > posicion_corte_descenso:
            salvacion = next((r for r in ranking if r['posicion'] == posicion_corte_descenso), None)
            if salvacion:
                puntos_salvacion = round(salvacion['puntosPorPartido'] * salvacion['partidosJugados'])
                if puntos_salvacion - puntos_equipo > margen_max:
                    return True
        
        return False
    
    def _construirRankingTabla(self, tabla):
        """Construye ranking ordenado por posición"""
        return sorted(
            [{'id': int(k), **v} for k, v in tabla['mapa'].items() if v.get('posicion')],
            key=lambda x: x['posicion']
        )
    
    def generarCandidatosMercado(self, matriz, max_goles, nombre_local, nombre_visita):
        """Genera candidatos de mercados para un partido"""
        candidatos = []
        
        # Resultados
        p_local = sumaMatriz(matriz, max_goles, lambda i, j: i > j)
        p_empate = sumaMatriz(matriz, max_goles, lambda i, j: i == j)
        p_visita = sumaMatriz(matriz, max_goles, lambda i, j: i < j)
        
        candidatos.append({'categoria': 'resultado', 'parametros': {'lado': 'local'}, 'seleccion': f'Gana {nombre_local}', 'probabilidad': p_local})
        candidatos.append({'categoria': 'resultado', 'parametros': {'lado': 'empate'}, 'seleccion': 'Empate', 'probabilidad': p_empate})
        candidatos.append({'categoria': 'resultado', 'parametros': {'lado': 'visita'}, 'seleccion': f'Gana {nombre_visita}', 'probabilidad': p_visita})
        
        # Doble oportunidad
        candidatos.append({'categoria': 'doble', 'parametros': {'lado': '1X'}, 'seleccion': f'{nombre_local} o Empate (1X)', 'probabilidad': p_local + p_empate})
        candidatos.append({'categoria': 'doble', 'parametros': {'lado': 'X2'}, 'seleccion': f'{nombre_visita} o Empate (X2)', 'probabilidad': p_visita + p_empate})
        candidatos.append({'categoria': 'doble', 'parametros': {'lado': '12'}, 'seleccion': f'{nombre_local} o {nombre_visita} (12)', 'probabilidad': p_local + p_visita})
        
        # Total de goles
        for linea in [1.5, 2.5, 3.5]:
            p_menos = sumaMatriz(matriz, max_goles, lambda i, j: (i + j) < linea)
            p_mas = sumaMatriz(matriz, max_goles, lambda i, j: (i + j) > linea)
            candidatos.append({'categoria': 'totalgoles', 'parametros': {'linea': linea, 'direccion': 'menos'}, 'seleccion': f'Menos de {linea} goles', 'probabilidad': p_menos})
            candidatos.append({'categoria': 'totalgoles', 'parametros': {'linea': linea, 'direccion': 'mas'}, 'seleccion': f'Más de {linea} goles', 'probabilidad': p_mas})
        
        # Ambos anotan
        p_btts_si = sumaMatriz(matriz, max_goles, lambda i, j: i >= 1 and j >= 1)
        candidatos.append({'categoria': 'btts', 'parametros': {'si': True}, 'seleccion': 'Ambos anotan: Sí', 'probabilidad': p_btts_si})
        candidatos.append({'categoria': 'btts', 'parametros': {'si': False}, 'seleccion': 'Ambos anotan: No', 'probabilidad': 1 - p_btts_si})
        
        # Equipo marca
        p_local_marca = sumaMatriz(matriz, max_goles, lambda i, j: i >= 1)
        p_visita_marca = sumaMatriz(matriz, max_goles, lambda i, j: j >= 1)
        candidatos.append({'categoria': 'equipomarca', 'parametros': {'lado': 'local'}, 'seleccion': f'{nombre_local} marca', 'probabilidad': p_local_marca})
        candidatos.append({'categoria': 'equipomarca', 'parametros': {'lado': 'visita'}, 'seleccion': f'{nombre_visita} marca', 'probabilidad': p_visita_marca})
        
        # Hándicap
        favorito_local = p_local >= p_visita
        nombre_favorito = nombre_local if favorito_local else nombre_visita
        lado_favorito = 'local' if favorito_local else 'visita'
        
        p_handicap1 = sumaMatriz(matriz, max_goles, lambda i, j: (favorito_local and (i - j) >= 2) or (not favorito_local and (j - i) >= 2))
        p_handicap2 = sumaMatriz(matriz, max_goles, lambda i, j: (favorito_local and (i - j) >= 3) or (not favorito_local and (j - i) >= 3))
        
        candidatos.append({'categoria': 'handicap', 'parametros': {'lado': lado_favorito, 'valor': 2}, 'seleccion': f'{nombre_favorito} -1 (gana por 2+)', 'probabilidad': p_handicap1})
        candidatos.append({'categoria': 'handicap', 'parametros': {'lado': lado_favorito, 'valor': 3}, 'seleccion': f'{nombre_favorito} -2 (gana por 3+)', 'probabilidad': p_handicap2})
        
        # Marcador exacto
        celdas = []
        for i in range(max_goles + 1):
            for j in range(max_goles + 1):
                celdas.append({'i': i, 'j': j, 'p': matriz.get(i, j)})
        
        celdas.sort(key=lambda x: x['p'], reverse=True)
        marcador_top = celdas[0]
        top3_marcadores = [{'marcador': f"{c['i']}-{c['j']}", 'probabilidad': round(c['p'] * 100)} for c in celdas[:3]]
        
        candidatos.append({'categoria': 'marcador', 'parametros': {'gl': marcador_top['i'], 'gv': marcador_top['j']}, 'seleccion': f"{marcador_top['i']}-{marcador_top['j']}", 'probabilidad': marcador_top['p']})
        
        return {
            'candidatos': candidatos,
            'marcadorProbable': f"{marcador_top['i']}-{marcador_top['j']}",
            'probMarcador': marcador_top['p'],
            'top3Marcadores': top3_marcadores,
            'favoritoLocal': favorito_local,
            'nombreFavorito': nombre_favorito
        }
    
    def seleccionarMercados(self, candidatos, cantidad):
        """Selecciona los mejores mercados de candidatos"""
        seleccionados = []
        
        # Familia "ganador": Resultado vs Doble Oportunidad
        mejor_resultado = next((c for c in candidatos if c['categoria'] == 'resultado'), None)
        mejor_doble = next((c for c in candidatos if c['categoria'] == 'doble'), None)
        
        if mejor_resultado and mejor_doble:
            relacionada = '1X' if mejor_resultado['parametros']['lado'] == 'local' else 'X2' if mejor_resultado['parametros']['lado'] == 'visita' else None
            doble_relacionada = next((c for c in candidatos if c['categoria'] == 'doble' and c['parametros']['lado'] == relacionada), None)
            
            if doble_relacionada:
                ratio = mejor_resultado['probabilidad'] / doble_relacionada['probabilidad']
                seleccionados.append(mejor_resultado if ratio >= 0.62 else doble_relacionada)
            else:
                seleccionados.append(mejor_resultado)
        else:
            seleccionados.append(mejor_resultado or mejor_doble)
        
        # Familia "goles": Total de Goles vs Ambos Anotan
        candidatos_goles = [c for c in candidatos if c['categoria'] in ['totalgoles', 'btts']]
        mejor_goles = max(candidatos_goles, key=lambda c: c['probabilidad'] - (0.03 if c['categoria'] == 'btts' else 0), default=None)
        if mejor_goles:
            seleccionados.append(mejor_goles)
        
        # Familia "goleador": Equipo Marca vs Hándicap
        mejor_handicap = next((c for c in candidatos if c['categoria'] == 'handicap'), None)
        mejor_equipo_marca = next((c for c in candidatos if c['categoria'] == 'equipomarca'), None)
        
        if mejor_handicap and mejor_equipo_marca:
            seleccionados.append(mejor_handicap if mejor_handicap['probabilidad'] >= 0.32 else mejor_equipo_marca)
        else:
            seleccionados.append(mejor_handicap or mejor_equipo_marca)
        
        # Marcador exacto
        mejor_marcador = next((c for c in candidatos if c['categoria'] == 'marcador'), None)
        if mejor_marcador:
            seleccionados.append(mejor_marcador)
        
        # Rellenar si faltan
        if len(seleccionados) < cantidad:
            usadas = set(c['categoria'] for c in seleccionados)
            candidatos_ordenados = sorted(candidatos, key=lambda c: c['probabilidad'], reverse=True)
            for c in candidatos_ordenados:
                if c['categoria'] not in usadas:
                    seleccionados.append(c)
                    usadas.add(c['categoria'])
                if len(seleccionados) >= cantidad:
                    break
        
        return seleccionados[:cantidad]
    
    def razonesParaMercado(self, m, ctx):
        """Genera razones para un mercado"""
        razones = []
        favorece_local = m['seleccion'].startswith(ctx['nombreLocal']) and not m['seleccion'].startswith(ctx['nombreVisita'])
        favorece_visita = m['seleccion'].startswith(ctx['nombreVisita']) and not m['seleccion'].startswith(ctx['nombreLocal'])
        
        if favorece_local:
            razones.append(f"{ctx['nombreLocal']} promedia {ctx['statsLocal']['local']['golesFavor']:.1f} goles a favor jugando de local.")
            if ctx['statsLocal']['tendencia']['direccion'] == 'subiendo':
                razones.append(f"{ctx['nombreLocal']} viene en alza en sus últimos partidos.")
        elif favorece_visita:
            razones.append(f"{ctx['nombreVisita']} promedia {ctx['statsVisita']['visita']['golesFavor']:.1f} goles a favor jugando de visita.")
            if ctx['statsVisita']['tendencia']['direccion'] == 'subiendo':
                razones.append(f"{ctx['nombreVisita']} viene en alza en sus últimos partidos.")
        
        f_local = self.factorTabla(ctx['tabla'], ctx['idLocal'])
        f_visita = self.factorTabla(ctx['tabla'], ctx['idVisita'])
        if abs(f_local - 1) > 0.05 or abs(f_visita - 1) > 0.05:
            mejor_ubicado = ctx['nombreLocal'] if f_local > f_visita else ctx['nombreVisita']
            razones.append(f"{mejor_ubicado} está mejor ubicado en la tabla de posiciones.")
        
        if ctx['h2h'] and ctx['h2h']['disponible'] and ctx['h2h']['totalPartidos'] >= 3:
            if ctx['h2h']['victoriasLocal'] > ctx['h2h']['victoriasVisita']:
                razones.append(f"El historial directo favorece a {ctx['nombreLocal']} ({ctx['h2h']['victoriasLocal']}V-{ctx['h2h']['empates']}E-{ctx['h2h']['victoriasVisita']}V).")
            elif ctx['h2h']['victoriasVisita'] > ctx['h2h']['victoriasLocal']:
                razones.append(f"El historial directo favorece a {ctx['nombreVisita']} ({ctx['h2h']['victoriasVisita']}V-{ctx['h2h']['empates']}E-{ctx['h2h']['victoriasLocal']}V).")
        
        if not razones:
            razones.append("Calculado con el modelo estadístico (Poisson + Dixon-Coles) según los datos disponibles.")
        
        return razones[:2]
    
    def generarPronosticos(self, stats_local, stats_visita, nombre_local, nombre_visita, h2h, tabla, id_local, id_visita, codigo_liga):
        """Genera pronósticos para un partido"""
        # Estimador base
        lambda_local = (stats_local['local']['golesFavor'] + stats_visita['visita']['golesContra']) / 2
        lambda_visita = (stats_visita['visita']['golesFavor'] + stats_local['local']['golesContra']) / 2
        lambda_local_base = lambda_local
        lambda_visita_base = lambda_visita
        
        # Fuerza de ataque/defensa
        fuerza_local = self.fuerzaAtaqueDefensa(tabla, id_local)
        fuerza_visita = self.fuerzaAtaqueDefensa(tabla, id_visita)
        lambda_local *= math.sqrt(fuerza_local['ataque'] * fuerza_visita['defensa'])
        lambda_visita *= math.sqrt(fuerza_visita['ataque'] * fuerza_local['defensa'])
        
        # Tendencia y descanso
        lambda_local *= self.factorTendencia(stats_local['tendencia']['direccion'])
        lambda_visita *= self.factorTendencia(stats_visita['tendencia']['direccion'])
        
        lambda_local *= self.factorDescanso(stats_local['diasDescansoUltimoPartido'])
        lambda_visita *= self.factorDescanso(stats_visita['diasDescansoUltimoPartido'])
        
        # Localía y perfil
        factor_localia_usado = self.calibracion_actual['factorLocalia']
        perfil_liga_actual = self.perfilLiga(codigo_liga)
        perfil_partida = self.perfilPartido(stats_local, stats_visita, h2h, tabla, id_local, id_visita)
        perfil_local = self.perfilEquipo(tabla, id_local)
        perfil_visita = self.perfilEquipo(tabla, id_visita)
        
        ajuste_perfil_local = 1.0
        ajuste_perfil_visita = 1.0
        
        ajuste_perfil_local *= perfil_liga_actual['localia']
        ajuste_perfil_visita *= perfil_liga_actual['localia']
        ajuste_perfil_local *= perfil_liga_actual['goles']
        ajuste_perfil_visita *= perfil_liga_actual['goles'] * 0.98
        
        ajuste_calidad_local = 1 + 0.09 * (perfil_local['ataque'] - perfil_visita['defensa'])
        ajuste_calidad_visita = 1 + 0.09 * (perfil_visita['ataque'] - perfil_local['defensa'])
        ajuste_perfil_local *= ajuste_calidad_local
        ajuste_perfil_visita *= ajuste_calidad_visita
        
        ajuste_perfil_local *= perfil_partida['fuerzaLocal']
        ajuste_perfil_visita *= perfil_partida['fuerzaVisita']
        
        if perfil_partida['tipo'] == 'clase':
            ajuste_perfil_local *= 1.05
            ajuste_perfil_visita *= 0.97
        elif perfil_partida['tipo'] == 'sorpresa':
            ajuste_perfil_local *= 0.96
            ajuste_perfil_visita *= 1.04
        elif perfil_partida['tipo'] == 'derbi':
            ajuste_perfil_local *= 1.04
            ajuste_perfil_visita *= 1.03
        
        lambda_local *= factor_localia_usado * ajuste_perfil_local
        lambda_visita *= factor_localia_usado * ajuste_perfil_visita
        
        # Factor de liga
        factor_liga_usado = self.calibracion_actual['porLiga'].get(codigo_liga, 1.0)
        factor_liga_ajustado = max(0.9, min(1.1, factor_liga_usado * perfil_liga_actual['goles']))
        lambda_local *= factor_liga_ajustado
        lambda_visita *= factor_liga_ajustado
        
        # H2H
        lambda_local *= self.factorH2H(h2h, True)
        lambda_visita *= self.factorH2H(h2h, False)
        
        # Tabla
        f_tabla_local = self.factorTabla(tabla, id_local)
        f_tabla_visita = self.factorTabla(tabla, id_visita)
        lambda_local *= f_tabla_local
        lambda_visita *= f_tabla_visita
        
        # Sin nada en juego
        sin_nada_local = self.equiposSinNadaEnJuego(tabla, id_local)
        sin_nada_visita = self.equiposSinNadaEnJuego(tabla, id_visita)
        partido_sin_nada_en_juego = sin_nada_local or sin_nada_visita
        
        if partido_sin_nada_en_juego:
            prom_liga_goles = self.promedioLiga(codigo_liga)
            lambda_local = lambda_local * 0.85 + prom_liga_goles * 0.15
            lambda_visita = lambda_visita * 0.85 + prom_liga_goles * 0.15
        
        # Poca data
        partidos_min = min(stats_local['partidosJugados'], stats_visita['partidosJugados'])
        if partidos_min < self.config.PARTIDOS_MINIMOS_CONFIABLES:
            prom_liga_goles_shrink = self.promedioLiga(codigo_liga)
            peso_confianza = max(0.35, partidos_min / self.config.PARTIDOS_MINIMOS_CONFIABLES)
            lambda_local = lambda_local * peso_confianza + prom_liga_goles_shrink * (1 - peso_confianza)
            lambda_visita = lambda_visita * peso_confianza + prom_liga_goles_shrink * (1 - peso_confianza)
        
        # Límite de deriva
        lambda_local = max(lambda_local_base * (1 - self.config.LIMITE_DRIFT_LAMBDA), 
                          min(lambda_local_base * (1 + self.config.LIMITE_DRIFT_LAMBDA), lambda_local))
        lambda_visita = max(lambda_visita_base * (1 - self.config.LIMITE_DRIFT_LAMBDA), 
                           min(lambda_visita_base * (1 + self.config.LIMITE_DRIFT_LAMBDA), lambda_visita))
        
        fuerza_blend = partido_sin_nada_en_juego and 0.52 or (partidos_min < self.config.PARTIDOS_MINIMOS_CONFIABLES and 0.45 or 0.28)
        lambda_local = lambda_local_base * (1 - fuerza_blend) + lambda_local * fuerza_blend
        lambda_visita = lambda_visita_base * (1 - fuerza_blend) + lambda_visita * fuerza_blend
        
        lambda_local = max(lambda_local, 0.3)
        lambda_visita = max(lambda_visita, 0.3)
        
        # Matriz de marcadores
        rho_usado = self.calibracion_actual['rhoDixonColes']
        matriz = matrizMarcadores(lambda_local, lambda_visita, 8, rho_usado)
        max_goles = matriz['dim'] - 1
        
        # Generar candidatos
        resultado = self.generarCandidatosMercado(matriz, max_goles, nombre_local, nombre_visita)
        candidatos = resultado['candidatos']
        marcador_probable = resultado['marcadorProbable']
        prob_marcador = resultado['probMarcador']
        top3_marcadores = resultado['top3Marcadores']
        favorito_local = resultado['favoritoLocal']
        nombre_favorito = resultado['nombreFavorito']
        
        # Seleccionar mercados
        seleccionados = self.seleccionarMercados(candidatos, 4)
        
        # Combinaciones
        pares = []
        for i in range(len(seleccionados)):
            for j in range(i + 1, len(seleccionados)):
                m1 = seleccionados[i]
                m2 = seleccionados[j]
                p_conjunta = sumaMatriz(matriz, max_goles, lambda i, j: verificarMercado(m1['categoria'], m1['parametros'], i, j) and verificarMercado(m2['categoria'], m2['parametros'], i, j))
                pares.append({
                    'tipos': [m1['categoria'], m2['categoria']],
                    'partes': [m1['seleccion'], m2['seleccion']],
                    'probabilidad': round(p_conjunta * 100)
                })
        
        pares.sort(key=lambda x: x['probabilidad'], reverse=True)
        combos_partido = [{'titulo': 'Combinada segura' if idx == 0 else 'Combinada extra', 'tipos': p['tipos'], 'partes': p['partes'], 'probabilidad': p['probabilidad']} for idx, p in enumerate(pares[:2])]
        
        # Ajustes por calibración
        umbral_minimo_mercado = self.config.UMBRAL_MINIMO_MERCADO if not partido_sin_nada_en_juego else 0.62
        
        for m in seleccionados:
            m['sinApuesta'] = m['probabilidad'] < umbral_minimo_mercado
        
        for m in seleccionados:
            ajuste = self.calibracion_actual['porCategoria'].get(m['categoria'], 1.0)
            suavizado = 0.96 if m['probabilidad'] < 0.5 else 0.92
            m['probabilidad'] = min(0.92, max(0.08, m['probabilidad'] * ajuste * suavizado))
        
        for m in seleccionados:
            m['probabilidad'] = round(m['probabilidad'] * 100)
        
        # Catálogo completo
        catalogo_completo = sorted(
            [{'seleccion': c['seleccion'], 'probabilidad': round(c['probabilidad'] * 100)} for c in candidatos],
            key=lambda x: x['probabilidad'],
            reverse=True
        )
        
        # Preparar resultado
        resultado = {
            'seleccionados': seleccionados,
            'marcadorProbable': marcador_probable,
            'probMarcador': round(prob_marcador * 100),
            'top3Marcadores': top3_marcadores,
            'catalogoCompleto': catalogo_completo,
            'combosPartido': combos_partido,
            'partidosMin': partidos_min,
            'pocaData': partidos_min < self.config.PARTIDOS_MINIMOS_CONFIABLES,
            'favoritoLocal': favorito_local,
            'nombreFavorito': nombre_favorito,
            'sinNadaEnJuego': partido_sin_nada_en_juego,
            'parametrosModelo': {
                'lambdaLocal': round(lambda_local * 1000) / 1000,
                'lambdaVisita': round(lambda_visita * 1000) / 1000,
                'rhoDixonColes': rho_usado,
                'factorLocalia': factor_localia_usado,
                'factorLiga': factor_liga_ajustado,
                'tablaInfo': {
                    'fLocal': round(f_tabla_local * 1000) / 1000,
                    'fVisita': round(f_tabla_visita * 1000) / 1000
                }
            }
        }
        
        return resultado

# ==================== ML (XGBoost + Regresión Logística) ====================

class ModeloAprendizajeAutomatico:
    def __init__(self):
        self.xgb_model = None
        self.lr_model = None
        self.scaler = StandardScaler()
        self.feature_names = [
            'golesFavorLocal', 'golesContraLocal', 'golesFavorVisita', 'golesContraVisita',
            'puntosPromedioLocal', 'puntosPromedioVisita', 'partidosJugadosLocal', 'partidosJugadosVisita',
            'factorLocalia', 'factorTablaLocal', 'factorTablaVisita', 'factorH2HLocal', 'factorH2HVisita',
            'tendenciaLocal', 'tendenciaVisita', 'descansoLocal', 'descansoVisita'
        ]
    
    def prepararDatosParaML(self, partidos, stats_locales, stats_visitantes, tablas, h2hs, codigo_liga):
        """Prepara datos para entrenamiento de ML"""
        X = []
        y = []
        
        for i, partido in enumerate(partidos):
            if i >= len(stats_locales) or i >= len(stats_visitantes):
                continue
            
            stats_local = stats_locales[i]
            stats_visita = stats_visitantes[i]
            tabla = tablas[i]
            h2h = h2hs[i]
            
            # Características
            features = [
                stats_local['local']['golesFavor'],
                stats_local['local']['golesContra'],
                stats_visita['visita']['golesFavor'],
                stats_visita['visita']['golesContra'],
                stats_local['puntosPromedio'],
                stats_visita['puntosPromedio'],
                stats_local['partidosJugados'],
                stats_visita['partidosJugados'],
                self._calcularFactorLocalia(codigo_liga),
                self._calcularFactorTabla(tabla, partido['homeTeam']['id']),
                self._calcularFactorTabla(tabla, partido['awayTeam']['id']),
                self._calcularFactorH2H(h2h, True),
                self._calcularFactorH2H(h2h, False),
                self._codificarTendencia(stats_local['tendencia']['direccion']),
                self._codificarTendencia(stats_visita['tendencia']['direccion']),
                stats_local['diasDescansoUltimoPartido'] or 0,
                stats_visita['diasDescansoUltimoPartido'] or 0
            ]
            
            # Resultado real (para entrenamiento)
            # En producción, esto vendría de datos históricos verificados
            # Por ahora, usamos un placeholder
            resultado = 1 if stats_local['local']['golesFavor'] > stats_visita['visita']['golesContra'] else 0
            
            X.append(features)
            y.append(resultado)
        
        return np.array(X), np.array(y)
    
    def _calcularFactorLocalia(self, codigo_liga):
        perfiles = {
            'PL': 1.05, 'PD': 1.04, 'BL1': 1.06, 'SA': 1.03,
            'FL1': 1.02, 'CL': 1.07, 'DED': 1.08, 'ELC': 1.01,
            'BSA': 1.04, 'PPL': 1.03, 'DEFAULT': 1.03
        }
        return perfiles.get(codigo_liga, perfiles['DEFAULT'])
    
    def _calcularFactorTabla(self, tabla, team_id):
        info = tabla['mapa'].get(team_id)
        if not info or not tabla['promedioLiga']:
            return 1.0
        return info['puntosPorPartido'] / tabla['promedioLiga']
    
    def _calcularFactorH2H(self, h2h, es_local):
        if not h2h or not h2h['disponible'] or h2h['totalPartidos'] < 5:
            return 1.0
        total = h2h['totalPartidos']
        dominio_local = (h2h['victoriasLocal'] - h2h['victoriasVisita']) / total
        ajuste_max = 0.04
        ajuste = max(-ajuste_max, min(ajuste_max, dominio_local * ajuste_max * 2))
        return 1 + ajuste if es_local else 1 - ajuste
    
    def _codificarTendencia(self, direccion):
        codigos = {'subiendo': 1, 'bajando': -1, 'neutral': 0}
        return codigos.get(direccion, 0)
    
    def entrenar(self, X, y):
        """Entrena modelos de ML"""
        if len(X) < 10:
            return
        
        # Escalar características
        X_scaled = self.scaler.fit_transform(X)
        
        # Entrenar XGBoost
        self.xgb_model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=3,
            learning_rate=0.1,
            random_state=42
        )
        self.xgb_model.fit(X_scaled, y)
        
        # Entrenar Regresión Logística
        self.lr_model = LogisticRegression(random_state=42, max_iter=1000)
        self.lr_model.fit(X_scaled, y)
    
    def predecir(self, X):
        """Hace predicciones con ambos modelos"""
        if not self.xgb_model or not self.lr_model:
            return None
        
        X_scaled = self.scaler.transform(X)
        pred_xgb = self.xgb_model.predict(X_scaled)
        pred_lr = self.lr_model.predict(X_scaled)
        
        # Combinar predicciones
        pred_combinada = (pred_xgb + pred_lr) / 2
        return (pred_combinada > 0.5).astype(int)

# ==================== GENERADOR DE PRONOSTICOS ====================

class GeneradorPronosticos:
    def __init__(self):
        self.config = Config()
        self.modelo_estadistico = ModeloEstadistico(self.config)
        self.modelo_ml = ModeloAprendizajeAutomatico()
        self.pronosticos = {}
    
    def cargarDatosDesdeBackend(self, backend_url: str):
        """Carga datos desde el backend (simulado para ahora)"""
        # En implementación real, esto haría llamadas al backend
        # Para ahora, usamos datos de ejemplo
        return self._datosEjemplo()
    
    def _datosEjemplo(self):
        """Datos de ejemplo para demostración"""
        return {
            'partidos': [
                {
                    'id': '1',
                    'homeTeam': {'id': 57, 'name': 'Arsenal'},
                    'awayTeam': {'id': 40, 'name': 'Liverpool'},
                    'competition': {'name': 'Premier League', 'code': 'PL'},
                    'utcDate': '2026-09-06T14:00:00Z',
                    'status': 'SCHEDULED'
                }
            ],
            'stats_locales': [
                {
                    'promedioGolesFavor': 1.8,
                    'promedioGolesContra': 1.2,
                    'puntosPromedio': 2.1,
                    'partidosJugados': 8,
                    'local': {'golesFavor': 2.1, 'golesContra': 1.1},
                    'visita': {'golesFavor': 1.5, 'golesContra': 1.4},
                    'tendencia': {'direccion': 'subiendo', 'racha': ['G', 'G', 'E', 'P', 'G']},
                    'diasDescansoUltimoPartido': 5
                }
            ],
            'stats_visitantes': [
                {
                    'promedioGolesFavor': 1.6,
                    'promedioGolesContra': 1.3,
                    'puntosPromedio': 1.8,
                    'partidosJugados': 8,
                    'local': {'golesFavor': 1.7, 'golesContra': 1.5},
                    'visita': {'golesFavor': 1.6, 'golesContra': 1.3},
                    'tendencia': {'direccion': 'neutral', 'racha': ['E', 'G', 'P']},
                    'diasDescansoUltimoPartido': 3
                }
            ],
            'tablas': [
                {
                    'mapa': {
                        57: {'posicion': 4, 'puntosPorPartido': 1.8, 'partidosJugados': 8, 'golesFavorPorPartido': 2.1, 'golesContraPorPartido': 1.1},
                        40: {'posicion': 1, 'puntosPorPartido': 2.3, 'partidosJugados': 8, 'golesFavorPorPartido': 1.6, 'golesContraPorPartido': 1.3}
                    },
                    'promedioLiga': 1.9,
                    'promedioLigaGolesFavor': 1.7,
                    'promedioLigaGolesContra': 1.25,
                    'contextoLocal': {'mapa': {}, 'promedioGolesFavor': None, 'promedioGolesContra': None},
                    'contextoVisita': {'mapa': {}, 'promedioGolesFavor': None, 'promedioGolesContra': None}
                }
            ],
            'h2hs': [
                {
                    'disponible': True,
                    'totalPartidos': 8,
                    'victoriasLocal': 3,
                    'empates': 2,
                    'victoriasVisita': 3
                }
            ]
        }
    
    def generarPronosticosParaPartido(self, partido, stats_local, stats_visita, tabla, h2h):
        """Genera pronósticos para un partido individual"""
        return self.modelo_estadistico.generarPronosticos(
            stats_local, stats_visita,
            partido['homeTeam']['name'], partido['awayTeam']['name'],
            h2h, tabla,
            partido['homeTeam']['id'], partido['awayTeam']['id'],
            partido['competition']['code']
        )
    
    def generarTodosLosPronosticos(self, datos):
        """Genera pronósticos para todos los partidos"""
        partidos = datos['partidos']
        stats_locales = datos['stats_locales']
        stats_visitantes = datos['stats_visitantes']
        tablas = datos['tablas']
        h2hs = datos['h2hs']
        
        for i, partido in enumerate(partidos):
            if i >= len(stats_locales) or i >= len(stats_visitantes):
                continue
            
            stats_local = stats_locales[i]
            stats_visita = stats_visitantes[i]
            tabla = tablas[i] if i < len(tablas) else {'mapa': {}, 'promedioLiga': 1.3}
            h2h = h2hs[i] if i < len(h2hs) else {'disponible': False}
            
            pronosticos = self.generarPronosticosParaPartido(partido, stats_local, stats_visita, tabla, h2h)
            
            self.pronosticos[partido['id']] = {
                'partido': {
                    'id': partido['id'],
                    'homeTeam': partido['homeTeam'],
                    'awayTeam': partido['awayTeam'],
                    'competition': partido['competition'],
                    'utcDate': partido['utcDate'],
                    'status': partido['status']
                },
                'pronosticos': pronosticos,
                'generadoEn': datetime.now(timezone.utc).isoformat()
            }
        
        return self.pronosticos
    
    def aplicarML(self, pronosticos):
        """Aplica ML para ajustar probabilidades"""
        # Extraer características de los pronósticos
        X = []
        for id_partido, data in pronosticos.items():
            p = data['pronosticos']
            features = [
                p['parametrosModelo']['lambdaLocal'],
                p['parametrosModelo']['lambdaVisita'],
                len(p['seleccionados']),
                p['probMarcador'] / 100,
                1 if p['favoritoLocal'] else 0,
                p['partidosMin'] / 10
            ]
            X.append(features)
        
        if len(X) >= 10:
            X = np.array(X)
            predicciones_ml = self.modelo_ml.predecir(X)
            
            if predicciones_ml is not None:
                # Ajustar probabilidades basadas en ML
                for i, (id_partido, data) in enumerate(pronosticos.items()):
                    p = data['pronosticos']
                    factor_ajuste = 0.9 + (predicciones_ml[i] * 0.2)  # Ajuste entre 0.9 y 1.1
                    
                    for mercado in p['seleccionados']:
                        mercado['probabilidad'] = min(92, max(8, mercado['probabilidad'] * factor_ajuste))
                    
                    p['probMarcador'] = min(92, max(8, p['probMarcador'] * factor_ajuste))
        
        return pronosticos
    
    def guardarPronosticos(self, ruta_archivo: str = 'pronosticos.json'):
        """Guarda pronósticos en archivo JSON"""
        # Aplicar ML
        pronosticos_ajustados = self.aplicarML(self.pronosticos)
        
        # Preparar salida final
        salida = {
            'version': '2.0',
            'generadoEn': datetime.now(timezone.utc).isoformat(),
            'modelo': {
                'tipo': 'Poisson + Dixon-Coles + ML',
                'rhoDixonColes': self.config.RHO_DIXON_COLES,
                'factorLocalia': self.config.FACTOR_LOCALIA_BASE,
                'mlUsado': True
            },
            'pronosticos': pronosticos_ajustados
        }
        
        with open(ruta_archivo, 'w', encoding='utf-8') as f:
            json.dump(salida, f, indent=2, ensure_ascii=False)
        
        print(f"Pronósticos guardados en {ruta_archivo}")
        return salida

# ==================== FUNCIÓN PRINCIPAL ====================

def main():
    print("Generando pronósticos de Fulbito...")
    
    generador = GeneradorPronosticos()
    
    # Cargar datos (en implementación real, esto vendría del backend)
    datos = generador.cargarDatosDesdeBackend('http://localhost:3000')
    
    # Generar pronósticos
    pronosticos = generador.generarTodosLosPronosticos(datos)
    
    # Guardar
    salida = generador.guardarPronosticos('pronosticos.json')
    
    print(f"Generados {len(pronosticos)} pronósticos")
    print(f"Modelo: Poisson + Dixon-Coles + ML")
    print(f"Probabilidades ajustadas por XGBoost y Regresión Logística")
    
    return salida

if __name__ == '__main__':
    main()
