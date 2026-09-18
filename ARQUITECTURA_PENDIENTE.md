# Propuesta Arquitectura Server-Side (Historial y Verificación Automatizada)

## Estado Actual y Limitación
Actualmente, el sistema de historial y pronósticos depende del cliente (`localStorage` y la interacción del usuario). Si el usuario no abre la aplicación en días específicos (ej. 14, 15, 16 de septiembre), los partidos de esos días nunca se registran localmente como pronosticados, por lo que no pueden aparecer en la pestaña "Finalizados" ni ser verificados automáticamente.

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
