# Propuesta Arquitectura Server-Side (Historial y Verificación Automatizada)

> Estado: documento vivo. Las secciones "Resuelto" reflejan lo ya implementado
> (verificado 2026-10-06); "Pendiente" agrupa lo que queda por hacer.

## Estado Actual y Limitación
Históricamente, el sistema de historial y pronósticos dependía del cliente
(`localStorage` y la interacción del usuario). Si el usuario no abría la app en
días específicos, esos partidos nunca se registraban como pronosticados y no
podían verificarse automáticamente.

### Resuelto
- Generación diaria de pronósticos vía GitHub Actions (`actualizar_pronosticos.yml`,
  08:00 UTC): corre `python pronosticos.py`, valida paridad Python<->JS
  (`test_paridad.py`) y commitea el artefacto + telemetría.
- Escrituras sobre `/api/historial` protegidas con `X-Api-Key`
  (`server/server.js`, `requireHistorialWriteKey`). El frontend ya **no** escribe
  en el pool global: `sincronizarHistorialRemoto` es un no-op y el historial
  personal vive en `localStorage`.
- `GET /api/historial/stats` expone el resumen sin transferir los picks completos.
- El motor Python consume los overrides aprobados (`cargar_parametros_aprobados`,
  `pronosticos.py:28`), cerrando el ciclo de recalibración supervisada (fase 4).

## Riesgos Conocidos (afectan la confiabilidad del track record)
Advirtamos explícitamente por qué los números que hoy se muestran en el panel de "Métricas de Confianza" (PASO 1 de este ticket) **no deben presentarse como una métrica global infalible del motor**:

### 2.1. Persistencia efímera en infraestructura bare-metal (Render free tier) — **Resuelto (requiere activar DB en prod)**
- **Implementado:** el servidor persiste el historial en una DB en vez de solo el filesystem:
  Postgres gestionado si existe `DATABASE_URL` (recomendado) o SQLite local por defecto
  (`server/data/historial.db`). El cache en memoria + debounce de 500ms se mantienen y el
  shutdown fuerza flush del pendiente. `server/data/historial.json` queda como espejo legacy
  legible. Cubierto por `npm run test:server` (`server/test-persistence.js`).
- **Acción pendiente:** en Render configurar `DATABASE_URL` (Postgres free: Neon/Supabase/Render)
  para que el dyno deje de resetear el pool en cada redeploy/restart. `GET /api/historial/stats`
  ya evita sincronizar los picks completos al cliente.
- **Nota:** `pronosticos.json` y `pronosticos_historicos.jsonl` siguen commiteándose al repo con
  `git add -f` diario; persistirlos en la DB/objeto sería el siguiente paso de esta línea.
- **Cómo activar (1 min, requiere cuenta en un proveedor de Postgres):**
  1. Crear un Postgres free en Neon (`neon.tech`) o Supabase, o en Render
     (`New +` → `PostgreSQL`). Obtener la connection string.
  2. En Render → tu servicio web → `Environment` → `Add Environment Variable`:
     `DATABASE_URL` = esa connection string (con `?sslmode=require` si la trae).
  3. Re-deploy (o se aplica solo). El log de arranque debe mostrar
     `Historial cargado desde postgres (N entradas).`
  4. Verificar: `GET /api/historial/stats` — el `total` sobrevive a restarts del dyno.

### 2.2. Autenticación y autoridad sobre `/api/historial` — **Resuelto (parcial)**
- Las escrituras `POST/PUT /api/historial` exigen `X-Api-Key` (`requireHistorialWriteKey`) y el frontend ya no escribe en el pool global (no-op); el historial personal vive en `localStorage`.
- **Pendiente:** no hay identidad de usuario (cookies/JWT/Supabase), por lo que el track record sigue siendo un pool anónimo que solo puebla backend/CI. Las lecturas (`GET /api/historial`) son públicas y los sanity-checks de `recalibracion.py` mitigan, no eliminan, el riesgo de un pool contaminado vía la propia CI.

## Plan de Arquitectura a Mediano/Largo Plazo

### 1. Generación Diaria de Pronósticos — **Resuelto**
- GitHub Actions (`actualizar_pronosticos.yml`, 08:00 UTC) ejecuta `pronosticos.py` con paridad verificada y commitea `pronosticos.json` + telemetría.
- **Pendiente:** guardar cada jornada en una estructura persistente y versionada (DB) en vez de `git add -f pronosticos.json` diario sobre el repo.

### 2. Verificación Autónoma de Resultados — **Parcial**
- El frontend liquida el historial personal consultando partidos `FINISHED` (`actualizarHistorialConResultados` en `app-ui.js`).
- **Pendiente:** un proceso server-side (cron) que cruce resultados contra los pronósticos del pool sin depender de que el usuario abra la app.

### 3. Sincronización Transparente con el Cliente — **Pendiente**
- `GET /api/historial` y `/api/historial/stats` existen, pero el cliente sigue
  local-first (el remoto es solo respaldo), así que los partidos que el usuario no
  visitó siguen fuera del track record visible.
- **Pendiente:** frontend por defecto en `GET /api/historial` consolidado.

### 4. Deuda técnica restante (no cubierta por este documento)
- **Motor canónico**: el frontend consume `pronosticos.json` (Python) por defecto
  (`obtenerPronosticosDePartido` en `app-model.js`, con normalizador al shape de la
  tarjeta); el cálculo JS (`app-model.js`) queda como *offline fallback* y sigue
  validado por `test_paridad.py`. Pendiente: deprecar gradualmente el motor JS si
  la cobertura del artefacto alcanza el 100% de los partidos.
- **CI incompleta**: el workflow no corre `test_recalibracion.py`, `npm check` ni hay CI en push; `server.js` no tiene tests.
- **Frontend monolítico**: 4 archivos JS globals + `style.css` de 256KB, sin build ni tests por módulo.
