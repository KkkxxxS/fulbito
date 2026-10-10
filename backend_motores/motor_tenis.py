"""
Motor de predicción para Tenis (ATP / WTA).
Basado en rating Elo por superficie (Dura, Arcilla, Hierba) y probabilidad de ganar puntos al servicio.
"""

from typing import Dict, Any, Optional
from dataclasses import dataclass
from .base_motor import BaseMotor

BASE_ELO = 1500
K_FACTOR = 32

@dataclass
class JugadorTenis:
    nombre: str
    elo_general: float = BASE_ELO
    elo_dura: float = BASE_ELO
    elo_arcilla: float = BASE_ELO
    elo_hierba: float = BASE_ELO
    retencion_servicio: float = 0.65  # Puntos ganados al saque

class MotorTenis(BaseMotor):
    def __init__(self):
        self.jugadores: Dict[str, JugadorTenis] = {}

    def _get_jugador(self, nombre: str) -> JugadorTenis:
        if nombre not in self.jugadores:
            self.jugadores[nombre] = JugadorTenis(nombre=nombre)
        return self.jugadores[nombre]

    def predecir(self, data_partido: Dict[str, Any]) -> Dict[str, Any]:
        """
        Espera data_partido con:
        - jugador1: str
        - jugador2: str
        - superficie: 'dura' | 'arcilla' | 'hierba' (opcional, default 'dura')
        - al_mejor_de: 3 | 5 (sets, default 3)
        """
        j1_nom = data_partido.get("jugador1", "Jugador 1")
        j2_nom = data_partido.get("jugador2", "Jugador 2")
        superficie = data_partido.get("superficie", "dura").lower()
        al_mejor_de = data_partido.get("al_mejor_de", 3)

        j1 = self._get_jugador(j1_nom)
        j2 = self._get_jugador(j2_nom)

        elo1 = getattr(j1, f"elo_{superficie}", j1.elo_general)
        elo2 = getattr(j2, f"elo_{superficie}", j2.elo_general)

        # Probabilidad de partido usando Elo logístico
        diff = elo1 - elo2
        prob_j1_match = 1 / (1 + 10 ** (-diff / 400))
        prob_j2_match = 1 - prob_j1_match

        # Estimación de sets (al mejor de 3: 2-0, 2-1, 0-2, 1-2)
        # Aproximación simple: P(2-0) ~ prob_match^1.5
        if al_mejor_de == 3:
            p_2_0 = prob_j1_match ** 1.6
            p_2_1 = max(0.0, prob_j1_match - p_2_0)
            p_0_2 = prob_j2_match ** 1.6
            p_1_2 = max(0.0, prob_j2_match - p_0_2)
            
            # Normalizar
            total_sets = p_2_0 + p_2_1 + p_0_2 + p_1_2
            if total_sets > 0:
                p_2_0 /= total_sets
                p_2_1 /= total_sets
                p_0_2 /= total_sets
                p_1_2 /= total_sets

            sets_pred = {
                "2-0": round(p_2_0 * 100, 1),
                "2-1": round(p_2_1 * 100, 1),
                "0-2": round(p_0_2 * 100, 1),
                "1-2": round(p_1_2 * 100, 1)
            }
        else:
            sets_pred = {"3-0": 25.0, "3-1": 25.0, "3-2": 25.0} # Placeholder para Grand Slam

        # Cuotas justas
        cuota_j1 = round(1 / prob_j1_match, 2) if prob_j1_match > 0 else 99
        cuota_j2 = round(1 / prob_j2_match, 2) if prob_j2_match > 0 else 99

        return {
            "deporte": "tenis",
            "jugador1": j1_nom,
            "jugador2": j2_nom,
            "superficie": superficie,
            "ganador": {
                "jugador1": {"probabilidad": round(prob_j1_match * 100, 1), "cuota_justa": cuota_j1},
                "jugador2": {"probabilidad": round(prob_j2_match * 100, 1), "cuota_justa": cuota_j2}
            },
            "marcador_sets": sets_pred,
            "games_totales_estimados": round(21.5 + (0.5 - abs(prob_j1_match - 0.5)) * 6, 1)
        }

    def importar_estado(self, estado: Dict[str, Any]):
        for k, v in estado.get("jugadores", {}).items():
            j = self._get_jugador(k)
            j.elo_general = v.get("elo_general", BASE_ELO)
            j.elo_dura = v.get("elo_dura", BASE_ELO)
            j.elo_arcilla = v.get("elo_arcilla", BASE_ELO)
            j.elo_hierba = v.get("elo_hierba", BASE_ELO)

    def exportar_estado(self) -> Dict[str, Any]:
        return {
            "jugadores": {
                k: {
                    "elo_general": v.elo_general,
                    "elo_dura": v.elo_dura,
                    "elo_arcilla": v.elo_arcilla,
                    "elo_hierba": v.elo_hierba
                } for k, v in self.jugadores.items()
            }
        }
