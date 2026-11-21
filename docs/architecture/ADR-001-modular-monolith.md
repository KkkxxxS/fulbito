# ADR-001: Adoptar un monolito modular con migración incremental

- **Estado:** Aceptado
- **Fecha:** 2026-11-20
- **Decisores:** Equipo Fulbito (arquitectura y producto)
- **Relacionado:** [ARCHITECTURE.md](./ARCHITECTURE.md), [ROADMAP.md](./ROADMAP.md)

---

## 1. Contexto

Fulbito funciona hoy como un sistema en producción con:

- Una SPA estática en GitHub Pages, con JavaScript clásico en scope global y sin build.
- Una API Express en Render (`server/server.js`, 1.926 líneas) que concentra auth, proveedores, historial, liquidación y deportes.
- Un pipeline Python diario (`pronosticos.py`) que genera pronósticos y un sistema de recalibración supervisada (`recalibracion.py`).
- Persistencia híbrida: PostgreSQL, SQLite, `pronosticos.json`, JSONL y `localStorage`.
- Un motor estadístico duplicado parcialmente en Python y JavaScript, con pruebas de paridad numérica.

El sistema tiene usuarios reales, un track record público y gates de recalibración que deben preservarse. Al mismo tiempo, la concentración de responsabilidades y la duplicación de reglas ya produjeron una divergencia real de liquidación (ver `ARCHITECTURE.md` §8).

El equipo es pequeño y el despliegue es único. No hay evidencia de que la escala actual exija servicios independientes, pero sí de que la falta de límites internos está generando defectos.

---

## 2. Decisión

Adoptar un **monolito modular** como arquitectura objetivo, con **migración incremental tipo strangler**, preservando:

1. Los endpoints HTTP y sus contratos actuales.
2. El motor estadístico canónico en Python y su paridad con JS donde corresponda.
3. Los gates y la aprobación humana de la recalibración.
4. PostgreSQL como fuente de verdad.

El monolito se organiza en módulos con responsabilidad única y reglas de dependencia explícitas:

- `auth`, `users`, `matches`, `predictions`, `history`, `providers`, `models` en la API.
- `settlement`, `markets`, `evaluation`, `ratings` como dominio puro.
- `analytics` en Python para generación, métricas y backtesting.
- `persistence` como infraestructura detrás de puertos.
- `web` y `landing` en la presentación.

No se crean servicios de red nuevos. Los módulos se comunican en proceso mediante interfaces.

---

## 3. Alternativas consideradas

### A. Microservicios inmediatos

**Ventajas:** aislamiento de fallos, escalado independiente, equipos autónomos.

**Desventajas para el estado actual:**

- Un solo equipo pequeño; el costo operativo (descubrimiento, red, tracing, contratos distribuidos, despliegues) supera el beneficio.
- El dominio aún no está estabilizado; los límites correctos no se conocen.
- Aumentaría el riesgo de divergencia entre motores y de inconsistencia transaccional en liquidación.
- No resuelve el problema real: duplicación de reglas y falta de pruebas.

**Veredicto:** rechazada por ahora. Los seams del monolito modular permiten extraer un módulo más adelante si aparece una razón medida (escala, equipo, requisito regulatorio).

### B. Reescritura completa

**Ventajas:** código más limpio desde cero.

**Desventajas:**

- Alto riesgo de perder comportamiento no documentado (ajustes de liga, clamps, casos borde de liquidación).
- El track record y la confianza del usuario dependen de continuidad numérica.
- Viola la regla de no reemplazar implementaciones funcionales sin pruebas de equivalencia.

**Veredicto:** rechazada.

### C. Mantener el estado actual sin cambios

**Ventajas:** cero riesgo inmediato.

**Desventajas:**

- La duplicación ya causó un defecto P0 de liquidación.
- El costo de cambio crece con cada funcionalidad nueva.
- La evaluación y la recalibración heredan datos contaminados.

**Veredicto:** rechazada; no es sostenible.

### D. Monolito modular con migración incremental (elegida)

**Ventajas:**

- Un solo despliegue y una sola transacción donde importa.
- Límites internos testeables y documentados.
- Camino de extracción futura sin reescritura.
- Compatibilidad total con los contratos y el motor actuales.
- Permite corregir el P0 con pruebas antes de mover código.

**Desventajas:**

- Requiere disciplina sostenida para que los límites no se erosionen.
- No elimina por sí solo la duplicación; hay que reducirla explícitamente.
- El beneficio es gradual y menos visible que una reescritura.

**Veredicto:** aceptada.

---

## 4. Consecuencias

### 4.1 Positivas

- Reglas de negocio con una única fuente de verdad y pruebas compartidas.
- Rutas HTTP delgadas, servicios de aplicación testeables sin red.
- Dominio puro reutilizable por API, pipeline y pruebas.
- Menor riesgo de regresión en cada cambio.
- Base para observabilidad y seguridad consistentes.
- Posibilidad futura de extraer módulos sin reescribir el dominio.

### 4.2 Negativas y costos

- Trabajo de refactorización sin valor visible inmediato para el usuario.
- Necesidad de mantener disciplina de dependencias (revisión de imports, límites de paquete).
- Riesgo de “monolito modular de papel” si los módulos comparten estado global o tablas sin contrato.
- Curva de aprendizaje para el equipo.

### 4.3 Neutrales

- El número de despliegues no cambia.
- La tecnología base (Node/Express, Python, PostgreSQL) se mantiene.
- El frontend puede seguir siendo estático durante varias fases.

---

## 5. Invariantes que la decisión protege

1. **Continuidad numérica:** el motor de fútbol no cambia de fórmula sin backtesting y aprobación.
2. **Trazabilidad:** toda predicción es rastreable a partido, versión de modelo, fecha, insumos y resultado.
3. **Liquidación única:** cliente, servidor y analítica comparten la misma especificación de mercados.
4. **Aprobación humana:** ninguna recalibración altera producción automáticamente.
5. **Compatibilidad HTTP:** no se rompen endpoints ni campos existentes.
6. **PostgreSQL como verdad:** SQLite y JSON quedan para desarrollo, caché o intercambio.
7. **Secretos fuera del repositorio:** solo variables de entorno.

---

## 6. Plan de implementación (resumen)

| Fase | Objetivo | Verificación |
|---|---|---|
| 0 | Auditoría y documentación | Documentos revisados; baseline de pruebas registrado |
| 1 | Corregir P0 de liquidación y fijar contratos | Paridad 100%; pruebas de todas las categorías |
| 2 | Repositorios y PostgreSQL como única verdad | Migración idempotente; pruebas de persistencia |
| 3 | Extraer dominio puro | `settlement`, `markets`, `evaluation` sin I/O |
| 4 | Adelgazar la API | Rutas sin lógica de negocio; servicios probados |
| 5 | Seguridad y observabilidad | Hallazgos altos cerrados; métricas activas |
| 6 | Frontend modular | Sin globals; módulos ES; pruebas de UI |
| 7 | Evaluación avanzada | Log Loss, calibración con IC, OOS, versiones |

Detalle y criterios de salida en [ROADMAP.md](./ROADMAP.md).

---

## 7. Cómo se reconoce el éxito

- `npm run test:parity` pasa al 100% y sigue pasando en CI.
- No existen dos implementaciones de una misma regla de liquidación.
- `server.js` deja de contener lógica de negocio y solo compone módulos.
- Las pruebas de dominio corren sin PostgreSQL, sin red y sin navegador.
- Un cambio de parámetro de modelo requiere versión nueva y auditoría.
- Un incidente se diagnostica con logs y métricas, no con `console.log` dispersos.

---

## 8. Condiciones para revisar esta decisión

Se reconsiderará la extracción de un servicio cuando ocurra al menos una de estas condiciones, con evidencia medida:

1. Un módulo necesita escalar de forma independiente y el monolito no puede hacerlo sin afectar a los demás.
2. Un equipo distinto necesita ciclos de despliegue autónomos.
3. Un requisito regulatorio o de aislamiento de datos lo exige.
4. La latencia o el consumo de recursos de un módulo dominan el presupuesto total.

La extracción, si ocurre, será de un módulo con límites ya probados, no de una rebanada horizontal del monolito.

---

## 9. Notas de implementación

- No se crean carpetas ni paquetes nuevos en esta fase; el documento describe el destino.
- La primera extracción real será `settlement`, porque es pura, crítica y ya está duplicada.
- Ningún movimiento de archivos debe mezclarse con cambios de comportamiento; primero se mueve con pruebas, luego se mejora.
- Toda decisión posterior que contradiga este ADR debe registrarse como un ADR nuevo que lo reemplace, no como una edición silenciosa.
