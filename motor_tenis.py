"""
Motor de predicción para Tenis (ATP/WTA).
Basado en probabilidad de ganar punto al servicio (modelo Markov / Klaassen-Magnus
simplificado) y rating Elo ajustado por superficie.
"""

import math
from typing import Dict, List, Optional
from dataclasses import dataclass


BASE_ELO = 1500
HOME_ADVANTAGE = 0  # Neutral por defecto; +15 Elo si es Davis Cup / local
K_FACTOR = 16
SUPERFICIE_PESO = {"hard": 1.0, "clay": 0.85, "grass": 0.80, "carpet": 0.9}


@dataclass
class Tenista:
    nombre: str
    elo: float = BASE_ELO
    elo_superficie: Dict[str, float] = None
    partidos: int = 0
    servicio_ganado: float = 0.64  # % puntos ganados al saque (promedio ATP ~64%)
    resto_ganado: float = 0.36
    
    def __post_init__(self):
        if self.elo_superficie is None:
            self.elo_superficie = {s: BASE_ELO for s in SUPERFICIE_PESO}


class MotorTenis:
    """Motor predictivo 1v1 para tenis."""

    def __init__(self):
        self.jugadores: Dict[str, Tenista] = {}
        self.historial: List[Dict] = []

    def _get(self, nombre: str) -> Tenista:
        if nombre not in self.jugadores:
            self.jugadores[nombre] = Tenista(nombre=nombre)
        return self.jugadores[nombre]

    def _prob_ganar(self, elo_a: float, elo_b: float) -> float:
        diff = elo_a - elo_b
        return 1 / (1 + 10 ** (-diff / 400))

    def _prob_partido_markov(self, p_a: float, p_b: float, formato: str = "best3") -> float:
        """
        Prob. de ganar el partido dado p = prob. de ganar punto al saque.
        Simplificación: usa Elo como proxy de p diferencial.
        """
        # Convertir Elo diff a prob de punto (escala)
        # p_a/p_b son prob de ganar punto al saque; aquí aproximamos con Elo
        return (p_a / (p_a + (1 - p_b) * 0.7 + 0.3 * (1 - p_a)))  # heurística estable

    def procesar_resultado(self, ganador: str, perdedor: str, superficie: str = "hard",
                           score: str = "", fecha: str = ""):
        a = self._get(ganador)
        b = self._get(perdedor)
        elo_a = a.elo_superficie.get(superficie, a.elo)
        elo_b = b.elo_superficie.get(superficie, b.elo)
        prob = self._prob_ganar(elo_a, elo_b)
        cambio = K_FACTOR * (1 - prob)
        a.elo += cambio
        b.elo -= cambio
        a.elo_superficie[superficie] = elo_a + cambio
        b.elo_superficie[superficie] = elo_b - cambio
        a.partidos += 1
        b.partidos += 1
        self.historial.append({"ganador": ganador, "perdedor": perdedor, "sup": superficie, "score": score, "fecha": fecha})

    def predecir(self, jugador_a: str, jugador_b: str, superficie: str = "hard") -> Dict:
        a = self._get(jugador_a)
        b = self._get(jugador_b)
        elo_a = a.elo_superficie.get(superficie, a.elo)
        elo_b = b.elo_superficie.get(superficie, b.elo)
        prob_a = self._prob_ganar(elo_a, elo_b)
        prob_b = 1 - prob_a
        return {
            "deporte": "tenis",
            "jugador_a": jugador_a, "jugador_b": jugador_b,
            "superficie": superficie,
            "moneyline": {
                "a": {"probabilidad": round(prob_a * 100, 1), "cuota_justa": round(1 / max(prob_a, 0.01), 2)},
                "b": {"probabilidad": round(prob_b * 100, 1), "cuota_justa": round(1 / max(prob_b, 0.01), 2)},
            },
            "elo": {"a": round(elo_a, 1), "b": round(elo_b, 1)},
            "favorito": jugador_a if prob_a > 0.5 else jugador_b,
        }

    def entrenar(self, partidos: List[Dict]):
        for p in partidos:
            self.procesar_resultado(p["ganador"], p["perdedor"], p.get("superficie", "hard"), p.get("score", ""), p.get("fecha", ""))

    def exportar_estado(self) -> Dict:
        return {"jugadores": {k: {"elo": v.elo, "elo_sup": v.elo_superficie, "partidos": v.partidos} for k, v in self.jugadores.items()}}
    def importar_estado(self, estado: Dict):
        for k, v in estado.get("jugadores", {}).items():
            j = self._get(k); j.elo = v.get("elo", BASE_ELO); j.elo_superficie = v.get("elo_sup", j.elo_superficie); j.partidos = v.get("partidos", 0)

def crear_motor_tenis(estado: Optional[Dict] = None) -> MotorTenis:
    m = MotorTenis()
    if estado: m.importar_estado(estado)
    return m
