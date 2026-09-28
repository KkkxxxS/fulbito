# Reglas de trabajo (basadas en el skill tdd-workflow de ECC)

## Pruebas primero
- Antes de cambiar o agregar lógica (por ejemplo, el cálculo de pronósticos), escribe una prueba que falle, luego el código mínimo para que pase, y después refactoriza.
- Una prueba por comportamiento, con nombres que expliquen qué se prueba.
- Estructura Arrange-Act-Assert.
- Cubre casos borde (null, vacío, valores grandes) y rutas de error, no solo el caso feliz.
- Aísla dependencias externas con mocks (por ejemplo, la fuente de datos de partidos).
- Las pruebas unitarias deben ser rápidas y no dejar efectos secundarios.

## Antes de dar algo por terminado
- Todas las pruebas pasan, sin pruebas omitidas ni desactivadas.
- Revisa qué partes de la lógica quedan sin cubrir y avísame.