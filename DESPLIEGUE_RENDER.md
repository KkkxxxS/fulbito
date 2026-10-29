# Configurar Fulbito en Render (backend + PostgreSQL)

Guía para dejar el backend de Fulbito con cuentas, sesiones e historial persistente.
La app sigue en GitHub Pages; Render solo hospeda la API.

> **Decisión rápida**
>
> - **Gratis y persistente:** crear PostgreSQL en **Neon** (free) y conectar Render
>   por `DATABASE_URL`. Recomendado si no quieres pagar.
> - **Todo en Render:** Render Postgres **pago**. El plan Free de Render Postgres
>   **expira a los 30 días** y no tiene backups; sirve para probar, no para producción.
> - El plan Free de Render Web Service **se duerme a los 15 minutos** sin tráfico.
>   La primera petición puede tardar ~1 minuto en despertar.

## 1. Configuración del Web Service

En Render, abre el servicio del backend (por ejemplo `fulbito-forh`) y revisa
**Settings**:

| Campo | Valor |
| --- | --- |
| Runtime | Node |
| Node Version | 22 o superior (`NODE_VERSION=22`) |
| Root Directory | raíz del repo (recomendado) |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Auto-Deploy | Yes (rama `main`) |
| Region | la misma que la base de datos |

> **Node 22 es obligatorio.** `better-sqlite3@13` declara `engines: node >= 22`;
> con Node 20 el servidor no arranca y el health check falla. Si Render usa una
> versión anterior por defecto, agrega la variable de entorno `NODE_VERSION=22`.

El `npm start` de la raíz ya hace `cd server && node server.js`. Si tu servicio
usa `server/` como Root Directory, entonces Build Command y Start Command son
`npm install` y `npm start` dentro de esa carpeta; ambas configuraciones sirven.

No configures `PORT`: Render lo inyecta automáticamente.

## 2. Crear la base de datos

### Opción A — Neon free (recomendado para no pagar)

1. Entra a <https://neon.tech> y crea un proyecto.
2. Elige la región más cercana al servicio de Render (idealmente la misma:
   por ejemplo `AWS us-west-2` si Render está en Oregon).
3. Copia la **connection string** de la base. Usa la variante **pooled** si Neon
   la ofrece; debe incluir `sslmode=require`:
   ```text
   postgresql://usuario:password@ep-xxx-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Esa URL va en `DATABASE_URL` (paso 3). **No** pongas `DATABASE_SSL=false`:
   Neon exige TLS y el servidor ya usa TLS por defecto.

### Opción B — Render Postgres

1. En Render: **New + → Postgres**.
2. Nombre: `fulbito-db`; base: `fulbito`; usuario: `fulbito`.
3. Región: la misma del Web Service.
4. Plan: pago para producción. El Free expira a los 30 días.
5. Cuando esté **Available**, abre la base y copia:
   - **Internal Database URL** si el Web Service está en la misma región y en Render.
   - **External Database URL** si vas a probar desde tu PC.
6. Usa la Internal URL en `DATABASE_URL` del Web Service.

> Si usas Render Postgres y el servidor falla con un error de SSL, prueba
> `DATABASE_SSL=false` **solo** para la conexión interna. Para Neon o una URL
> externa, deja `DATABASE_SSL` sin definir.

## 3. Variables de entorno en Render

Dashboard → servicio → **Environment** → **Add Environment Variable**:

| Variable | Valor | Obligatoria |
| --- | --- | --- |
| `DATABASE_URL` | Internal URL de Render o connection string de Neon | Sí, para cuentas e historial persistente |
| `HISTORIAL_API_KEY` | secreto aleatorio de 32+ bytes | Sí en producción |
| `NODE_ENV` | `production` | Sí |
| `FOOTBALL_DATA_API_KEY` | tu clave de football-data.org | Sí para pronósticos |
| `THE_ODDS_API_KEY` | tu clave de The Odds API | Opcional (cuotas/multideporte) |
| `RAPIDAPI_KEY` | tu clave de RapidAPI | Opcional (vóley) |
| `RAPIDAPI_VOLLEY_HOST` | host de RapidAPI | Opcional (vóley) |
| `RAPIDAPI_VOLLEY_PATH` | ruta, por defecto `/matches/upcoming` | Opcional |
| `CORS_ORIGINS` | orígenes extra separados por coma | Opcional |
| `DATABASE_SSL` | `false` solo si tu Postgres no usa TLS | Opcional |

Genera `HISTORIAL_API_KEY` en PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Guarda ese valor: debe ser **el mismo** que el secret `HISTORIAL_API_KEY` de
GitHub Actions (paso 6).

### CORS

Ya están permitidos GitHub Pages, el Vercel actual y localhost (`3000`, `4321`,
`8000`). Si publicas la landing de Astro en otro dominio o preview, agrega:

```text
CORS_ORIGINS=https://fulbito-preview.vercel.app,https://tu-dominio.com
```

Sin barra final y separado por comas. Si no hay llamadas del navegador a la API,
puedes omitirlo.

## 4. Desplegar y verificar

1. **Save Changes** en Environment. Render redepliega solo.
2. Espera a que el deploy termine y revisa **Logs**. Debe aparecer:
   - `Iniciando migraciones de base de datos...`
   - `Servidor de fulbito corriendo en el puerto ...`
3. Prueba salud:
   ```powershell
   Invoke-RestMethod https://fulbito-forh.onrender.com/health
   # { ok = True }
   ```
4. Prueba que la base responde de verdad (no solo `/health`):
   ```powershell
   $u = "prueba_$(Get-Date -Format 'yyyyMMddHHmmss')"
   $body = @{ usuario = $u; password = 'ClaveSegura123' } | ConvertTo-Json
   $r = Invoke-RestMethod -Method Post `
     -Uri 'https://fulbito-forh.onrender.com/api/auth/register' `
     -ContentType 'application/json' -Body $body
   $r.token
   ```
   Si devuelve un token, las tablas y migraciones están bien.
5. Comprueba la sesión:
   ```powershell
   Invoke-RestMethod -Uri 'https://fulbito-forh.onrender.com/api/auth/me' `
     -Headers @{ Authorization = "Bearer $($r.token)" }
   ```
6. Cierra la sesión de prueba:
   ```powershell
   Invoke-RestMethod -Method Post -Uri 'https://fulbito-forh.onrender.com/api/auth/logout' `
     -Headers @{ Authorization = "Bearer $($r.token)" }
   ```

Si `/api/auth/register` responde **503**, el servicio no está viendo
`DATABASE_URL`. Si responde **500**, revisa los logs: URL mal copiada, SSL o
permisos de creación de tablas.

## 5. Ejecutar el test de auth contra la base real

El test `npm run test:auth` levanta un servidor local en el puerto `33222` y usa
la `DATABASE_URL` que le pases. Sirve para validar migraciones, registro, login,
`logout-all` e historial personal contra la base real.

El test usa un directorio temporal para SQLite/ELO: **no toca `server/data`** ni
el historial local. Sí crea un usuario `tester_*` en la base configurada.

Usa la **External URL** (tu PC no puede acceder a la red privada de Render) y
ejecuta desde la raíz del repo:

```powershell
cd "C:\Users\Windows Lite BR\fulbito"
$env:DATABASE_URL = "postgresql://...URL_EXTERNA..."
npm run test:auth
```

- Neon o Render con TLS: no definas `DATABASE_SSL`.
- Postgres local/CI sin TLS: `$env:DATABASE_SSL = "false"`.
- Sin `DATABASE_URL`, el test se omite y termina con código 0; no confundas
  "OMITIDO" con "pasó".

El test crea un usuario `tester_*`. Puedes limpiarlo desde el SQL editor de Neon
o con `psql`:

```sql
DELETE FROM usuarios WHERE usuario LIKE 'tester_%';
```

Las sesiones se borran en cascada.

## 6. Conectar GitHub Actions (liquidación diaria)

El workflow `actualizar_pronosticos.yml` llama a `POST /api/historial/liquidar`
con `X-Api-Key`. En GitHub: **Settings → Secrets and variables → Actions**:

| Secret | Valor |
| --- | --- |
| `FULBITO_BACKEND_URL` | `https://fulbito-forh.onrender.com` |
| `HISTORIAL_API_KEY` | el mismo valor configurado en Render |

Sin estos secrets, el workflow omite la liquidación (no falla), pero el historial
global no se actualiza desde el pipeline.

## 7. Problemas comunes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `/api/auth/*` devuelve 503 | Falta `DATABASE_URL` en el servicio | Agregarla en Environment y redeploy |
| `ECONNREFUSED` o timeout desde tu PC | Usaste la Internal URL fuera de Render | Usar la External URL |
| `server does not support SSL` | Postgres local sin TLS | `DATABASE_SSL=false` |
| `password authentication failed` | URL incompleta o password rotado | Copiar de nuevo la connection string |
| `relation "usuarios" does not exist` | Migraciones no ejecutadas | Revisar logs; reiniciar el servicio |
| Error de CORS en el navegador | Origen no listado | Agregar el origen exacto a `CORS_ORIGINS` |
| `too many connections` | URL sin pooler en Neon | Usar la connection string **pooled** |
| Primera petición tarda ~1 min | Free Web Service dormido | Es normal; reintentar |
| Datos desaparecen tras redeploy | Sin `DATABASE_URL`, SQLite es efímero en Render | Configurar Postgres |

## 8. Seguridad

- Nunca commitees `.env` ni la `DATABASE_URL`: contienen credenciales.
- Si `HISTORIAL_API_KEY` se filtra, rótala en Render y en GitHub Actions.
- `NODE_ENV=production` evita que se acepte el origen `null` y mantiene el modo
  estricto de CORS.
- El plan Free de Render no tiene backups. Para datos reales, usa un Postgres
  pago con backups o Neon con su plan correspondiente.

## 9. Postgres local (opcional)

Para probar cuentas en tu PC necesitas un PostgreSQL real. Sin él,
`npm run test:auth` se omite (no falla, pero no prueba nada).

### Con Docker

```powershell
docker run --name fulbito-pg `
  -e POSTGRES_USER=fulbito `
  -e POSTGRES_PASSWORD=fulbito `
  -e POSTGRES_DB=fulbito `
  -p 5432:5432 -d postgres:16
```

### Con PostgreSQL instalado

```powershell
psql -U postgres -c "CREATE USER fulbito WITH PASSWORD 'fulbito';"
psql -U postgres -c "CREATE DATABASE fulbito OWNER fulbito;"
```

Luego crea `C:\Users\Windows Lite BR\fulbito\.env` (está en `.gitignore`):

```dotenv
DATABASE_URL=postgresql://fulbito:fulbito@localhost:5432/fulbito
DATABASE_SSL=false
HISTORIAL_API_KEY=una_clave_local
```

Y ejecuta:

```powershell
cd "C:\Users\Windows Lite BR\fulbito"
npm run test:auth
```

El resultado debe decir **TODAS LAS COMPROBACIONES PASARON**, no **OMITIDO**.
