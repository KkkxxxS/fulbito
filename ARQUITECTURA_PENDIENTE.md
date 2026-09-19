# Propuesta Arquitectura Server-Side (Historial y Verificación Automatizada)

## Estado Actual y Limitación
Actualmente, el sistema de historial y pronósticos depende del cliente (`localStorage` y la interacción del usuario). Si el usuario no abre la aplicación en días específicos (ej. 14, 15, 16 de septiembre), los partidos de esos días nunca se registran localmente como pronosticados, por lo que no pueden aparecer en la pestaña "Finalizados" ni ser verificados automáticamente.

## Riesgos Conocidos (afectan la confiabilidad del track record)
Advirtamos explícitamente por qué los números que hoy se muestran en el panel de "Métricas de Confianza" (PASO 1 de este ticket) **no deben presentarse como una métrica global infalible del motor**:

### 2.1. Persistencia efímera en infraestructura bare-metal (Render free tier)
- El historial global se persiste en `server/data/historial.json` dentro del filesystem del dyno (`server/server.js`, `HISTORIAL_PATH = path.join(__dirname, 'data', 'historial.json')`).
- Render **free tier** (web service gratis) usa filesystem efímero: **se pierde en cada redeploy, restart o wake-up desde sleep por inactividad**.
- El debounce de escritura (500ms) y el graceful shutdown (SIGTERM) reducen el riesgo, pero **no garantizan** persistencia. En cada ciclo de vida del dyno el archivo puede resetearse al snapshot del último deploy.
- **Consecuencia:** el "Track record del motor" derivado de `GET /api/historial` puede estar *vacío* o *parcialmente perdido* sin que se note. Mientras tanto el localStorage del cliente actúa como fallback, pero aporta una muestra sesgada (solo lo que visitó el usuario).
- **Mitigation necesaria (ticket aparte):** migrar a un storage persistente (PostgreSQL / base de datos gestionada o bucket S3) y exponer `GET /api/historial/stats` para evitar sincronizar 200 picks pesados al cliente.

### 2.2. Sin autenticación ni autoridad sobre `/api/historial` (vulnerabilidad de integridad)
- Las rutas `GET/POST/PUT /api/historial` (`server/server.js`) **no piden autenticación de ningún tipo**: sin cookies, JWT, headers de usuario, ni siquiera distingue origen/IP.
- Cualquiera con la URL puede hacer `PUT /api/historial` con un array manipulado y **contaminar el pool global** (p.ej. picks falsos marcados como acertados, inflando la tasa).
- El merge del cliente prioriza el remoto (`fusionado = [...remoto, ...soloLocal]`), así que un remoto comprometido propaga el engaño a todos los visitantes.
- **Mitigation necesaria (ticket aparte):** exigir un token de servicio o una clave de API con `X-Api-Key` para escrituras (`/POST /PUT /api/historial`), y/o migrar a autenticación de usuario (Supabase/Firebase). Para lecturas (`GET`) podría quedar público si se filtran los picks marcados `verificado`... pero el pool sigue vulnerable a escrituras maliciosas.

## Plan de Arquitectura a Mediano/Largo Plazo

### 1. Generación Diaria de Pronósticos en el Servidor (Backend / Cron)
- Automatizar la ejecución de `pronosticos.py` (o un script equivalente en Node.js/Python en el servidor) diariamente mediante un cron job o GitHub Actions.
- Guardar los pronósticos generados de cada jornada en una estructura persistente en el servidor (ej. base de datos SQLite/PostgreSQL o un archivo JSON histórico persistente `pronosticos_historicos.json`).

### 2. Verificación Autónoma de Resultados
- El servidor debe consultar periódicamente la API de fútbol (`football-data.org`) para las fechas pasadas recientes.
- Cruzar los resultados finalizados (`status === 'FINISHED'`) contra los pronósticos almacenados en el servidor, calculando aciertos y marcadores finales sin depender de la interacción del usuario.

### 3. Sincronización Transparente con el Cliente
- El cliente (frontend) deja de ser responsable de trackear y calcular los pronósticos desde cero basándose únicamente en lo que visitó.
- Al abrir la app, el frontend simplemente realiza un `GET /api/historial` consolidado desde el servidor, reflejando de inmediato todos los partidos finalizados y verificados de la semana.
