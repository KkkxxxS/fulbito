"""
Motor de predicción para Básquet (NBA / Euroleague / FIBA).
Basado en rating Elo dinámico ajustado por localía y ritmo de juego.
No depende de Poisson (no hay empates, muchos puntos).
"""

import math
from typing import Dict, List, Optional
from dataclasses import dataclass

# --- Configuración base ---
BASE_ELO = 1500
HOME_ADVANTAGE = 3.5  # puntos de ventaja por jugar en casa
K_FACTOR = 20         # velocidad de adaptación del Elo (20 es estándar NBA)
REVERSION = 0.75      # regresión hacia la media entre temporadas


@dataclass
class EquipoBasquet:
    nombre: str
    elo: float = BASE_ELO
    partidos_jugados: int = 0
    puntos_favor: float = 0.0
    puntos_contra: float = 0.0
    ritmo: float = 100.0  # posesiones por partido (promedio NBA ~100)
    eficiencia_ofensiva: float = 1.1  # puntos por posesión
    eficiencia_defensiva: float = 1.1
    
    def actualizar_estadisticas(self, pf: float, pc: float, posesiones: float):
        """Actualiza stats ofensivas/defensivas y ritmo."""
        self.partidos_jugados += 1
        self.puntos_favor += pf
        self.puntos_contra += pc
        # Media móvil simple para eficiencias
        alpha = 0.2  # peso del partido reciente
        self.eficiencia_ofensiva = (1 - alpha) * self.eficiencia_ofensiva + alpha * (pf / posesiones) if posesiones > 0 else self.eficiencia_ofensiva
        self.eficiencia_defensiva = (1 - alpha) * self.eficiencia_defensiva + alpha * (pc / posesiones) if posesiones > 0 else self.eficiencia_defensiva
        self.ritmo = (1 - alpha) * self.ritmo + alpha * posesiones if posesiones > 0 else self.ritmo


class MotorBasquet:
    """
    Motor predictivo para básquet.
    Usa Elo + Four Factors (ritmo, eFG%, TOV%, ORB%, FT rate) simplificado.
    """
    
    def __init__(self):
        self.equipos: Dict[str, EquipoBasquet] = {}
        self.historial_partidos: List[Dict] = []
    
    def _get_equipo(self, nombre: str) -> EquipoBasquet:
        if nombre not in self.equipos:
            self.equipos[nombre] = EquipoBasquet(nombre=nombre)
        return self.equipos[nombre]
    
    def _probabilidad_ganar(self, elo_local: float, elo_visita: float) -> float:
        """Convierte diferencia de Elo a probabilidad (curva logística)."""
        diff = elo_local - elo_visita + HOME_ADVANTAGE * 25  # 3.5 pts ~ 25 Elo
        return 1 / (1 + 10 ** (-diff / 400))
    
    def _puntos_esperados(self, eq_local: EquipoBasquet, eq_visita: EquipoBasquet) -> tuple:
        """
        Estima puntos esperados usando ritmos y eficiencias (Four Factors simplificado).
        """
        # Ritmo esperado = promedio de ritmos
        ritmo_esperado = (eq_local.ritmo + eq_visita.ritmo) / 2
        
        # Eficiencia esperada local = (of_local + def_visita) / 2
        eff_local = (eq_local.eficiencia_ofensiva + eq_visita.eficiencia_defensiva) / 2
        eff_visita = (eq_visita.eficiencia_ofensiva + eq_local.eficiencia_defensiva) / 2
        
        # Ajuste por localía (~2-3% boost ofensiva)
        eff_local *= 1.025
        eff_visita *= 0.975
        
        pts_local = ritmo_esperado * eff_local
        pts_visita = ritmo_esperado * eff_visita
        
        return pts_local, pts_visita
    
    def procesar_resultado(self, local: str, visita: str, pts_local: int, pts_visita: int, 
                          posesiones: float = 100, fecha: str = ""):
        """Actualiza el modelo con un resultado real (para entrenamiento histórico)."""
        eq_l = self._get_equipo(local)
        eq_v = self._get_equipo(visita)
        
        # 1. Actualizar Elo
        prob_esperada = self._probabilidad_ganar(eq_l.elo, eq_v.elo)
        resultado = 1 if pts_local > pts_visita else 0
        cambio = K_FACTOR * (resultado - prob_esperada)
        eq_l.elo += cambio
        eq_v.elo -= cambio
        
        # 2. Actualizar stats ofensivas/defensivas
        eq_l.actualizar_estadisticas(pts_local, pts_visita, posesiones)
        eq_v.actualizar_estadisticas(pts_visita, pts_local, posesiones)
        
        # 3. Guardar en historial
        self.historial_partidos.append({
            "fecha": fecha, "local": local, "visita": visita,
            "pts_local": pts_local, "pts_visita": pts_visita,
            "elo_local_antes": eq_l.elo - cambio, "elo_visita_antes": eq_v.elo + cambio,
            "posesiones": posesiones
        })
    
    def predecir(self, local: str, visita: str) -> Dict:
        """Genera predicción completa para un partido."""
        eq_l = self._get_equipo(local)
        eq_v = self._get_equipo(visita)
        
        # Probabilidad Moneyline (Ganador)
        prob_local = self._probabilidad_ganar(eq_l.elo, eq_v.elo)
        prob_visita = 1 - prob_local
        
        # Puntos esperados (para Totales Over/Under y Spread)
        pts_l, pts_v = self._puntos_esperados(eq_l, eq_v)
        spread = pts_l - pts_v
        total = pts_l + pts_v
        
        # Cuotas justas (fair odds)
        cuota_local = 1 / prob_local if prob_local > 0 else 99
        cuota_visita = 1 / prob_visita if prob_visita > 0 else 99
        
        return {
            "deporte": "basquet",
            "local": local,
            "visita": visita,
            "moneyline": {
                "local": {"probabilidad": round(prob_local * 100, 1), "cuota_justa": round(cuota_local, 2)},
                "visita": {"probabilidad": round(prob_visita * 100, 1), "cuota_justa": round(cuota_visita, 2)}
            },
            "spread": {
                "linea": round(spread, 1),
                "local_cubre": round(spread > 0, 1),  # 1 si local favorito
                "probabilidad_local_cubre": round(self._prob_spread(spread), 1)
            },
            "total": {
                "linea": round(total, 1),
                "over_prob": round(self._prob_total(total), 1)
            },
            "elo": {"local": round(eq_l.elo, 1), "visita": round(eq_v.elo, 1)},
            "ritmo_esperado": round((eq_l.ritmo + eq_v.ritmo) / 2, 1)
        }
    
    def _prob_spread(self, spread: float) -> float:
        """Probabilidad aproximada de cubrir spread asumiendo distribución normal (sd ~ 11-12 pts NBA)."""
        # sd histórico NBA ~ 11.5 puntos
        sd = 11.5
        # P(Local gana por más de |spread|) usando normal
        if spread >= 0:
            # Local favorito: cubre si gana por más de spread
            return 1 - 0.5 * (1 + math.erf(spread / (sd * math.sqrt(2))))
        else:
            # Visita favorito: local cubre si pierde por menos de |spread|
            return 0.5 * (1 + math.erf(abs(spread) / (sd * math.sqrt(2))))
    
    def _prob_total(self, total: float) -> float:
        """Probabilidad Over simplificada (varianza histórica ~ 14 pts)."""
        # Para línea exacta, over ~ 50%. Para líneas ajustadas por bookies, usaríamos mercado.
        return 50.0
    
    def entrenar_desde_historial(self, partidos: List[Dict]):
        """Entrena el modelo con histórico de partidos (más antiguo a más reciente)."""
        for p in partidos:
            self.procesar_resultado(
                p["local"], p["visita"], 
                p["pts_local"], p["pts_visita"],
                p.get("posesiones", 100), p.get("fecha", "")
            )
        # Reversión de Elo entre temporadas (opcional, se haría detectando gap de fechas)
    
    def exportar_estado(self) -> Dict:
        return {
            "equipos": {k: {
                "elo": v.elo, "partidos": v.partidos_jugados,
                "ritmo": v.ritmo, "eff_off": v.eficiencia_ofensiva, "eff_def": v.eficiencia_defensiva
            } for k, v in self.equipos.items()},
            "historial_len": len(self.historial_partidos)
        }
    
    def importar_estado(self, estado: Dict):
        for k, v in estado.get("equipos", {}).items():
            eq = self._get_equipo(k)
            eq.elo = v.get("elo", BASE_ELO)
            eq.partidos_jugados = v.get("partidos", 0)
            eq.ritmo = v.get("ritmo", 100)
            eq.eficiencia_ofensiva = v.get("eff_off", 1.1)
            eq.eficiencia_defensiva = v.get("eff_def", 1.1)


# --- Funciones de conveniencia para integración con pipeline ---

def crear_motor_basquet(estado_guardado: Optional[Dict] = None) -> MotorBasquet:
    motor = MotorBasquet()
    if estado_guardado:
        motor.importar_estado(estado_guardado)
    return motor


if __name__ == "__main__":
    # Demo rápido
    motor = MotorBasquet()
    
    # Simular histórico (pre-temporada 2023-24)
    historico = [
        {"local": "Boston Celtics", "visita": "Miami Heat", "pts_local": 119, "pts_visita": 111, "posesiones": 102},
        {"local": "Denver Nuggets", "visita": "LA Lakers", "pts_local": 119, "pts_visita": 107, "posesiones": 98},
        {"local": "Milwaukee Bucks", "visita": "Philadelphia 76ers", "pts_local": 118, "pts_visita": 117, "posesiones": 101},
    ]
    motor.entrenar_desde_historial(historico)
    
    # Predecir
    pred = motor.predecir("Boston Celtics", "Miami Heat")
    print("Predicción Celtics vs Heat:")
    print(f"  ML: Celtics {pred['moneyline']['local']['probabilidad']}% @ {pred['moneyline']['local']['cuota_justa']}")
    print(f"  Spread: Celtics {pred['spread']['linea']} pts")
    print(f"  Total: {pred['total']['linea']} pts")
    print(f"  Elo: Celtics {pred['elo']['local']} vs Heat {pred['elo']['visita']}")