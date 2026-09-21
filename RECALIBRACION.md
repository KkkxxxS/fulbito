# Sistema de Recalibración Supervisada — Guía de operación

> Diseño aprobado el 20/09/2026. Este documento explica cómo operar el sistema
> implementado en `recalibracion.py`. La especificación completa está en el
> historial de conversación del diseño (fases 1-3 implementadas; fase 4 —
> consumo de overrides en `pronosticos.py`— queda pendiente de la primera
> aprobación real).

## Qué hace

1. **Telemetría**: cada corrida diaria de `python pronosticos.py` (workflow de
   GitHub Actions, 08:00 UTC) agrega una línea a `pronosticos_historicos.jsonl`
   con los insumos por partido: lambdas, factores multiplicativos usados
   (localía, liga, tabla, H2H, EWMA, descanso), rho, y probabilidades finales.
   Es append-only y nunca rompe la generación.
2. **Diagnóstico**: `recalibracion.py` descarga el historial de picks
   verificados (`GET /api/historial`), aplica sanity-checks (marcadores válidos,
   deduplicación, fechas coherentes, cruce anti-manipulación contra el
   histórico oficial) y diagnostica sesgos con Brier Score y curvas de
   calibración.
3. **Propuesta**: si hay cambios con mejora de Brier validada (holdout
   temporal 70/30, mejora ≥ 0.005, mínimos de muestra por subgrupo), genera
   `propuesta_recalibracion.json` con el valor actual vs el propuesto (movimiento
   máximo 5% por corrida + shrinkage bayesiano K=100). **Nunca aplica nada
   directo**: la propuesta espera tu revisión.

## Gates activos (diseño aprobado)

| Gate | Valor |
|---|---|
| Partidos verificados mínimos | 50 |
| Ligas distintas para tocar localía global | ≥4, con ≥5 partidos cada una |
| Muestra mínima por liga (ajuste por liga) | 30 partidos |
| Muestra mínima por categoría (Platt/ajuste) | 30 mercados |
| Muestra mínima EWMA/H2H/rho | 40 mercados |
| Verificaciones nuevas entre propuestas | ≥10 |
| Mejora mínima de Brier (holdout) | 0.005 |
| Movimiento máximo por corrida | 5% relativo (ρ: ±0.01 abs; multiplicadores: ±0.10) |
| Shrinkage bayesiano | K=100 |
| Veto multi-liga (localía) | si el ajuste empeora ≥3 ligas, no se propone |

Si el histórico oficial proviene de datos de ejemplo, el sistema aborta sin
proponer nada (no se recalibra contra datos ficticios).

### Sensibilidad de cada ruta (verificado con sonda determinista)

| Ruta | Umbral de detección observado |
|---|---|
| `platt` / `porCategoria` (recalibración de probabilidades) | sesgos moderados (un factor de sobre-estimación de 1.35 en una categoría ya dispara propuesta) |
| pesos internos (`factorLocalia`, `rhoDixonColes`, EWMA, H2H, `limiteTabla`) | desvíos groseros: un nivel de goles real 2.2x mayor que el modelado es lo primero que pasa el gate (1.1x-1.8x **no** propone) |

Esto es consecuencia esperada del diseño conservador (cap de 5% por corrida +
shrinkage K=100 + umbral de mejora 0.005): la ruta de pesos **no** reacciona a
ruido ni a señales débiles, y necesita que la evidencia se acumule en varias
corridas. La ruta por categorías es la que detecta sesgos finos.

## Sanity-checks de entrada (mitigación parcial del pool público sin auth)

| Check | Regla | Efecto |
|---|---|---|
| Marcador válido | dos enteros en [0, 12] | registro descartado (`sinMarcadorValido`) |
| Fechas coherentes | no futuras (> hoy+1d), no anteriores a 2020 | registro descartado (`fechaInvalida`) |
| Histórico oficial | el `partidoId` debe existir en la telemetría del motor | partido descartado (`sinHistoricoOficial`) |
| Cruce anti-manipulación | probabilidad del pick == oficial ±3 puntos, para la misma categoría+selección | registro descartado (`cruceFallido`) |
| Deduplicación | mismo `partidoId` con marcadores contradictorios | se descarta el partido completo (`duplicadosEnConflicto`) |
| Deduplicación (anti-poisoning) | mismo `partidoId` duplicado con el mismo marcador: se prueban todos los registros en orden y se usa el primero que pase el cruce | un duplicado alterado **no** elimina el partido limpio |
| Integridad del motor | ≥50% de las probabilidades en el techo del clamp (0.92) **y** ≤3 valores distintos | la corrida de propuesta **aborta** (`abortado_probabilidades_degeneradas`); el diagnóstico advierte y sigue |

### Guardia de integridad del motor

El último check existe porque se encontró un bug en el motor de cálculo**
(`pronosticos.py`, `sumaMatriz`): `matriz.get(i, j)` sobre un `dict` **no** llama
a la lambda `'get'` guardada en el diccionario, sino al método nativo del dict
(busca la clave `i`, con default `j`). El resultado es que las "probabilidades"
son sumas de índices, no de celdas de la matriz; tras el `clamp` todas quedan
pegadas a 0.92.

Evidencia del bug en los datos publicados:

- `pronosticos.json` (18/09/2026): los 4 mercados tienen `probabilidad: 92`
  (handicap, totalgoles, btts y marcador) — imposible que cuatro mercados
  distintos tengan la misma probabilidad exacta.
- Reproducción aislada: `sumaMatriz(matrizMarcadores(0.98, 1.099, 8, -0.04), 8, lambda i, j: i > j)`
  devuelve **84.0** (suma de índices), cuando la probabilidad real de victoria
  local para esos lambdas es ~0.33.
- **El frontend NO está afectado**: `app-model.js:1240` devuelve un objeto con
  `get(i, j) { ... }`, que en JS es un método real de un objeto propio (no un
  `Map` ni un dict nativo), por lo que `matriz.get(i, j)` sí lo invoca. Verificado
  con Node: `{ get(i, j) {...} }.get(1, 2)` devuelve el valor esperado. El bug es
  exclusivo de Python, donde `matriz` es un `dict` y `dict.get` es un método
  nativo que gana sobre la clave `'get'`.
- `pronosticos.json` **no lo consume la web** (no hay `fetch` de ese archivo en
  `index.html`/`app-model.js`): el sitio calcula todo client-side, así que las
  probabilidades que ve el usuario vienen del motor JS (correcto). El bug degrada
  el artefacto Python publicado y la telemetría.

### Efecto colateral en este sistema

`recalibracion.py` importaba `sumaMatriz` del motor para garantizar equivalencia
matemática. Con el bug, esa equivalencia propagaba el error al backtesting: las
probabilidades derivadas eran sumas de índices (hasta 84.0 en vez de ~0.33), lo
que explica que ninguna perturbación de pesos superara nunca el gate de mejora
(el "Brier" apenas cambiaba entre candidatos). El sistema ahora usa su propia
`suma_matriz` (misma semántica que el motor **pretende**, aplicada correcta) y hay
una prueba de regresión que detecta si el motor cambia.

**El fix del motor no está aplicado** (fuera del alcance del diseño aprobado):
requiere tu aprobación explícita porque toca `pronosticos.py`. Es un cambio de
una línea (`matriz.get(i, j)` → `matriz['get'](i, j)`), pero mueve todas las
probabilidades publicadas, así que va en un PR aparte.

El cruce contra la telemetría oficial es la defensa principal: la probabilidad
que entra al cálculo siempre es la que publicó el motor, no la que reporta el
pool. Los descartes se reportan en cada corrida (`Descartes por sanity: {...}`)
y quedan en la bitácora. Estos checks **no** resuelven la falta de autenticación
del pool (riesgo documentado en `ARQUITECTURA_PENDIENTE.md`): un atacante aún
puede enviar marcadores falsos con la probabilidad oficial correcta.

## Guardia de integridad del motor (probabilidades degeneradas)

Antes de proponer nada, `modo_propuesta` verifica que las probabilidades oficiales
de la telemetría sean usables. Si casi todas están pegadas al techo del clamp
(0.92) y hay muy pocos valores distintos, **aborta** con
`abortado_probabilidades_degeneradas` en la bitácora.

Motivo: `sumaMatriz` de `pronosticos.py` hace `matriz.get(i, j)` sobre un **dict**.
En Python, `dict.get(i, j)` no invoca la lambda `'get'` de la matriz: busca la
clave `i` y devuelve `j` como default. El resultado son "probabilidades" que en
realidad son sumas de índices (ej. 84.0), que el post-proceso clampa a 0.92: todos
los mercados quedan idénticos. Recalibrar sobre eso produciría propuestas
"confiables" sobre ruido puro, así que el sistema se niega a proponer.

`recalibracion.py` no usa esa función: define `sumar_matriz`, que sí invoca la
lambda `'get'` de la matriz. El modo `diagnostico` no aborta: advierte con
`ADVERTENCIA: ...` y sigue informando.

**Estado:** la corrección en `pronosticos.py` NO está aplicada (requiere
aprobación explícita, ver "Pendiente"). Hasta entonces, la telemetría del motor
seguirá marcándose como degenerada y el sistema no propondrá cambios.

## Sobre el instrumento `factorLocalia`

El motor aplica `factor_localia_usado` **tanto al lambda local como al visitante**
(`pronosticos.py:790-791`), igual que `factorLiga` (líneas 796-797). Es decir que
`factorLocalia` en la práctica no expresa "ventaja de localía" sino el **nivel
global de goles** del partido. La consecuencia es importante para leer las
propuestas:

- Una desviación de *nivel de goles* global (ambos lados) sí es representable y
  detectable → se propone un ajuste de `factorLocalia`.
- Una desviación de *ventaja local* pura (local anota más, visita menos, mismo
  total) **no** es representable con ninguno de los parámetros actuales de
  `Config`: requiere un instrumento nuevo (asimétrico). El sistema no la propone
  y no debe inventarla.


```bash
python recalibracion.py --modo status        # estado (archivos, overrides vigentes)
python recalibracion.py --modo diagnostico   # solo lectura: sesgos, Brier, curvas
python recalibracion.py --modo propuesta     # genera propuesta si hay cambios

# Revisión manual de una propuesta:
python recalibracion.py --aprobar prop-2026-09-21-ab12cd34
python recalibracion.py --rechazar prop-2026-09-21-ab12cd34 --motivo "muestra muy corta"
```

## Cómo se aprueba o rechaza

- **Automático (workflow):** si una corrida diaria genera propuesta, el bot crea
  un **Pull Request** con `propuesta_recalibracion.json`. La bitácora y la
  telemetría se commitean siempre a `main` (registro público para Transparencia).
  - Aprobar = hacer **merge** del PR.
  - Rechazar = **cerrar** el PR y registrar el motivo con
    `--rechazar <id> --motivo "..."`.
- **Manual (local):** con la propuesta en tu copia del repo, usa `--aprobar` /
  `--rechazar` y commitea los archivos resultantes.

Al aprobar, se escribe `parametros_aprobados.json` con los overrides. **Ese
archivo todavía no es consumido por `pronosticos.py`** (fase 4 pendiente):
queda como contrato auditado; el consumo se implementará en un PR separado
solo después de tu primera aprobación.

## Archivos

| Archivo | Rol |
|---|---|
| `recalibracion.py` | Sistema completo (ingesta, sanity, diagnóstico, backtesting, propuesta, bitácora, CLI) |
| `pronosticos_historicos.jsonl` | Telemetría oficial del motor (append por corrida) |
| `propuesta_recalibracion.json` | Propuesta activa (estado: propuesta / aprobada / rechazada) |
| `bitacora_recalibracion.jsonl` | Registro histórico (corridas, propuestas, resoluciones) para Transparencia |
| `parametros_aprobados.json` | Overrides aprobados (contrato de fase 4, aún no consumido) |
| `test_recalibracion.py` | Pruebas end-to-end con dataset sintético determinista (9 escenarios) |

## Pendiente de aprobación (NO aplicar sin visto bueno)

**Corrección del bug de suma en `pronosticos.py`** — evidencia:

- `sumaMatriz` (línea 132) usa `matriz.get(i, j)` sobre el dict que devuelve
  `matrizMarcadores` (línea 126-130); `dict.get` devuelve el índice `j`.
- Efecto medido en el artefacto publicado: **los 4 mercados de `pronosticos.json`
  tienen `probabilidad = 92`** (el techo del clamp), uno por categoría
  (handicap, totalgoles, btts, marcador).
- `matriz` es local a `generarPronosticos`, así que el fix es acotado: invocar la
  lambda `'get'` en vez de `dict.get` (idéntico a `sumar_matriz` de
  `recalibracion.py`).

No se tocó nada de esto: el sistema de recalibración está diseñado para *detectar*
el problema y abstenerse, no para arreglar el motor.

