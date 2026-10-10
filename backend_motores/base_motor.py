from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseMotor(ABC):
    """
    Clase base para todos los motores de predicción deportiva.
    Asegura una interfaz consistente para el generador.
    """
    
    @abstractmethod
    def predecir(self, data_partido: Dict[str, Any]) -> Dict[str, Any]:
        """
        Genera una predicción basada en los datos del partido y cuotas.
        Debe devolver un diccionario con el formato esperado por el frontend.
        """
        pass

    @abstractmethod
    def importar_estado(self, estado: Dict[str, Any]):
        """Carga el estado del modelo (Elo, stats, etc.)."""
        pass

    @abstractmethod
    def exportar_estado(self) -> Dict[str, Any]:
        """Guarda el estado del modelo."""
        pass
