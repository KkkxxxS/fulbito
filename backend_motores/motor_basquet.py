"""
Motor de predicción para Básquet (NBA / Euroleague / FIBA).
Basado en rating Elo dinámico ajustado por localía y ritmo de juego.
"""

import math
from typing import Dict, List, Optional
from dataclasses import dataclass

from .base_motor import BaseMotor

BASE_ELO = 1500
HOME_ADVANTAGE = 3.5
K_FACTOR = 20


@dataclass
class EquipoBasquet:
    nombre: str
    elo: float = BASE_ELO
    partidos_jugados: int = 0
    puntos_favor: float = 0.0
    puntos_contra: float = 0.0
    ritmo: float = 100.0
    eficiencia_ofensiva: float = 1.1
    eficiencia_defensiva: float = 1.1

    def actualizar_estadisticas(self, pf: float, pc: float, posesiones: float):
        self.partidos_jugados += 1
        self.puntos_favor += pf
        self.puntos_contra += pc
        alpha = 0.2
        if posesiones > 0:
            self.eficiencia_ofensiva = (1 - alpha) * self.eficiencia_ofensiva + alpha * (pf / posesiones)
            self.eficiencia_defensiva = (1 - alpha) * self.eficiencia_defensiva + alpha * (pc / posesiones)
            self.ritmo = (1 - alpha) * self.ritmo + alpha * posesiones


class MotorBasquet(BaseMotor):
    def __init__(self):
        self.equipos: Dict[str, EquipoBasquet] = {}
        self.historial_partidos: List[Dict] = []

    def _get_equipo(self, nombre: str) -> EquipoBasquet:
        if nombre not in self.equipos:
            self.equipos[nombre] = EquipoBasquet(nombre=nombre)
        return self.equipos[nombre]

    def _probabilidad_ganar(self, elo_local: float, elo_visita: float) -> float:
        diff = elo_local - elo_visita + HOME_ADVANTAGE * 25
        return 1 / (1 + 10 ** (-diff / 400))

    def _puntos_esperados(self, eq_local: EquipoBasquet, eq_visita: EquipoBasquet) -> tuple:
        ritmo_esperado = (eq_local.ritmo + eq_visita.ritmo) / 2
        eff_local = (eq_local.eficiencia_ofensiva + eq_visita.eficiencia_defensiva) / 2
        eff_visita = (eq_visita.eficiencia_ofensiva + eq_local.eficiencia_defensiva) / 2
        eff_local *= 1.025
        eff_visita *= 0.975
        return ritmo_esperado * eff_local, ritmo_esperado * eff_visita

    def procesar_resultado(self, local: str, visita: str, pts_local: int, pts_visita: int,
                           posesiones: float = 100, fecha: str = ""):
        eq_l = self._get_equipo(local)
        eq_v = self._get_equipo(visita)
        prob = self._probabilidad_ganar(eq_l.elo, eq_v.elo)
        resultado = 1 if pts_local > pts_visita else 0
        cambio = K_FACTOR * (resultado - prob)
        eq_l.elo += cambio
        eq_v.elo -= cambio
        eq_l.actualizar_estadisticas(pts_local, pts_visita, posesiones)
        eq_v.actualizar_estadisticas(pts_visita, pts_local, posesiones)
        self.historial_partidos.append({
            "fecha": fecha, "local": local, "visita": visita,
            "pts_local": pts_local, "pts_visita": pts_visita,
            "elo_local_antes": eq_l.elo - cambio, "elo_visita_antes": eq_v.elo + cambio,
            "posesiones": posesiones
        })

    def predecir(self, data_partido: Dict = None, local: str = None, visita: str = None, **kwargs) -> Dict:
        if isinstance(data_partido, dict):
            local = data_partido.get("local", local) or data_partido.get("home_team", local)
            visita = data_partido.get("visita", visita) or data_partido.get("away_team", visita)
        assert local and visita, "MotorBasquet.predecir requiere local y visita"
        eq_l = self._get_equipo(local)
        eq_v = self._get_equipo(visita)
        prob_local = self._probabilidad_ganar(eq_l.elo, eq_v.elo)
        prob_visita = 1 - prob_local
        pts_l, pts_v = self._puntos_esperados(eq_l, eq_v)
        return {
            "deporte": "basquet",
            "local": local, "visita": visita,
            "moneyline": {
                "local": {"probabilidad": round(prob_local * 100, 1), "cuota_justa": round(1 / max(prob_local, 0.01), 2)},
                "visita": {"probabilidad": round(prob_visita * 100, 1), "cuota_justa": round(1 / max(prob_visita, 0.01), 2)}
            },
            "spread": {"linea": round(pts_l - pts_v, 1), "probabilidad_local_cubre": round(self._prob_spread(pts_l - pts_v), 1)},
            "total": {"linea": round(pts_l + pts_v, 1), "over_prob": 50.0},
            "elo": {"local": round(eq_l.elo, 1), "visita": round(eq_v.elo, 1)},
            "ritmo_esperado": round((eq_l.ritmo + eq_v.ritmo) / 2, 1)
        }

    def _prob_spread(self, spread: float) -> float:
        sd = 11.5
        if spread >= 0:
            return 1 - 0.5 * (1 + math.erf(spread / (sd * math.sqrt(2))))
        return 0.5 * (1 + math.erf(abs(spread) / (sd * math.sqrt(2))))

    def entrenar_desde_historial(self, partidos: List[Dict]):
        for p in partidos:
            self.procesar_resultado(p["local"], p["visita"], p["pts_local"], p["pts_visita"],
                                    p.get("posesiones", 100), p.get("fecha", ""))

    def importar_estado(self, estado: Dict):
        for k, v in estado.get("equipos", {}).items():
            eq = self._get_equipo(k)
            eq.elo = v.get("elo", BASE_ELO)
            eq.partidos_jugados = v.get("partidos", 0)
            eq.ritmo = v.get("ritmo", 100)
            eq.eficiencia_ofensiva = v.get("eff_off", 1.1)
            eq.eficiencia_defensiva = v.get("eff_def", 1.1)

    def exportar_estado(self) -> Dict:
        return {
            "equipos": {k: {"elo": v.elo, "partidos": v.partidos_jugados, "ritmo": v.ritmo,
                            "eff_off": v.eficiencia_ofensiva, "eff_def": v.eficiencia_defensiva}
                        for k, v in self.equipos.items()},
            "historial_len": len(self.historial_partidos)
        }


def crear_motor_basquet(estado_guardado: Optional[Dict] = None) -> MotorBasquet:
    motor = MotorBasquet()
    if estado_guardado:
        motor.importar_estado(estado_guardado)
    return motor


if __name__ == "__main__":
    motor = MotorBasquet()
    historico = [
        {"local": "Boston Celtics", "visita": "Miami Heat", "pts_local": 119, "pts_visita": 111, "posesiones": 102},
        {"local": "Denver Nuggets", "visita": "LA Lakers", "pts_local": 119, "pts_visita": 107, "posesiones": 98},
        {"local": "Milwaukee Bucks", "visita": "Philadelphia 76ers", "pts_local": 118, "pts_visita": 117, "posesiones": 101},
    ]
    motor.entrenar_desde_historial(historico)
    pred = motor.predecir(local="Boston Celtics", visita="Miami Heat")
    print("Predicción Celtics vs Heat:", pred)
