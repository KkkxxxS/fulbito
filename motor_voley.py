"""
Motor de predicción para Vóley Indoor / Playa (best-of-5 / best-of-3).
Modelo por sets: cada set es una carrera a 25 (15 en 5º) con ventaja de 2.
Usa Elo por equipo + eficiencia de ataque/bloqueo como proxy.
"""

import math
from typing import Dict, List, Optional
from dataclasses import dataclass

BASE_ELO = 1500
K_FACTOR = 18
HOME_ADVANTAGE_ELO = 35  # ~2-3% boost por localía en vóley


@dataclass
class EquipoVoley:
    nombre: str
    elo: float = BASE_ELO
    partidos: int = 0
    sets_ganados: int = 0
    sets_perdidos: int = 0
    puntos_ratio: float = 1.0  # puntos anotados / recibidos promedio


class MotorVoley:
    def __init__(self):
        self.equipos: Dict[str, EquipoVoley] = {}
        self.historial: List[Dict] = []

    def _get(self, nombre: str) -> EquipoVoley:
        if nombre not in self.equipos:
            self.equipos[nombre] = EquipoVoley(nombre=nombre)
        return self.equipos[nombre]

    def _prob_ganar_partido(self, elo_l: float, elo_v: float) -> float:
        diff = elo_l - elo_v + HOME_ADVANTAGE_ELO
        return 1 / (1 + 10 ** (-diff / 400))

    def _prob_sets(self, p_set: float, formato: str = "best5") -> Dict:
        """
        Distribución de marcadores de sets dado p = prob de ganar un set.
        best5: gana el primero en 3 sets.
        """
        q = 1 - p_set
        if formato == "best3":
            # 2-0, 2-1, 1-2, 0-2
            return {
                "2-0": p_set ** 2,
                "2-1": 2 * (p_set ** 2) * q,
                "1-2": 2 * (q ** 2) * p_set,
                "0-2": q ** 2,
            }
        # best5: 3-0, 3-1, 3-2, 2-3, 1-3, 0-3
        p = p_set
        return {
            "3-0": p ** 3,
            "3-1": 3 * (p ** 3) * q,
            "3-2": 6 * (p ** 3) * (q ** 2),
            "2-3": 6 * (q ** 3) * (p ** 2),
            "1-3": 3 * (q ** 3) * p,
            "0-3": q ** 3,
        }

    def procesar_resultado(self, local: str, visita: str, sets_local: int, sets_visita: int,
                           puntos_local: int = 0, puntos_visita: int = 0, fecha: str = ""):
        eq_l = self._get(local)
        eq_v = self._get(visita)
        prob = self._prob_ganar_partido(eq_l.elo, eq_v.elo)
        resultado = 1 if sets_local > sets_visita else 0
        cambio = K_FACTOR * (resultado - prob)
        eq_l.elo += cambio
        eq_v.elo -= cambio
        eq_l.partidos += 1; eq_v.partidos += 1
        eq_l.sets_ganados += sets_local; eq_l.sets_perdidos += sets_visita
        eq_v.sets_ganados += sets_visita; eq_v.sets_perdidos += sets_local
        # ratio de puntos como proxy de forma
        if puntos_local and puntos_visita:
            ratio_l = puntos_local / max(puntos_visita, 1)
            ratio_v = puntos_visita / max(puntos_local, 1)
            alpha = 0.15
            eq_l.puntos_ratio = (1 - alpha) * eq_l.puntos_ratio + alpha * ratio_l
            eq_v.puntos_ratio = (1 - alpha) * eq_v.puntos_ratio + alpha * ratio_v
        self.historial.append({"local": local, "visita": visita, "sets": f"{sets_local}-{sets_visita}", "fecha": fecha})

    def predecir(self, local: str, visita: str, formato: str = "best5") -> Dict:
        eq_l = self._get(local)
        eq_v = self._get(visita)
        # Ajuste fino por ratio de puntos
        elo_l = eq_l.elo + math.log(max(eq_l.puntos_ratio, 0.7)) * 35
        elo_v = eq_v.elo + math.log(max(eq_v.puntos_ratio, 0.7)) * 35
        p = self._prob_ganar_partido(elo_l, elo_v)
        dist = self._prob_sets(p if p < 0.92 else 0.92, formato)  # cap para evitar 99%
        # Totales Over/Under sets (best5: línea 3.5 y 4.5)
        over35 = dist.get("3-0", 0) + dist.get("0-3", 0)  # 3 sets exactos vs 4-5
        # Simplificación: Over 3.5 = partido a 4 o 5 sets
        p_over35 = 1 - (dist.get("3-0", 0) + dist.get("0-3", 0))
        return {
            "deporte": "voley",
            "local": local, "visita": visita, "formato": formato,
            "moneyline": {
                "local": {"probabilidad": round(p * 100, 1), "cuota_justa": round(1 / max(p, 0.01), 2)},
                "visita": {"probabilidad": round((1 - p) * 100, 1), "cuota_justa": round(1 / max(1 - p, 0.01), 2)},
            },
            "sets": {k: round(v * 100, 1) for k, v in dist.items()},
            "totales": {"over_3_5_prob": round(p_over35 * 100, 1)},
            "elo": {"local": round(elo_l, 1), "visita": round(elo_v, 1)},
        }

    def entrenar(self, partidos: List[Dict]):
        for p in partidos:
            self.procesar_resultado(p["local"], p["visita"], p["sets_local"], p["sets_visita"],
                                    p.get("puntos_local", 0), p.get("puntos_visita", 0), p.get("fecha", ""))

    def exportar_estado(self) -> Dict:
        return {"equipos": {k: {"elo": v.elo, "partidos": v.partidos, "ratio": v.puntos_ratio} for k, v in self.equipos.items()}}
    def importar_estado(self, estado: Dict):
        for k, v in estado.get("equipos", {}).items():
            e = self._get(k); e.elo = v.get("elo", BASE_ELO); e.partidos = v.get("partidos", 0); e.puntos_ratio = v.get("ratio", 1.0)

def crear_motor_voley(estado: Optional[Dict] = None) -> MotorVoley:
    m = MotorVoley()
    if estado: m.importar_estado(estado)
    return m
