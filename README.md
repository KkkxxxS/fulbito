# Fulbito

Pronósticos de fútbol basados en un modelo estadístico **Poisson + Dixon-Coles**
sobre las principales ligas europeas. Muestra probabilidades calibradas, un
historial de aciertos auditable (Brier Score) y se recalibra con cada partido
verificado.

> Herramienta de análisis, no un oráculo. Ningún pronóstico es 100%. Solo +18.

## Stack

- **Frontend:** HTML/CSS/JS vanilla (sin build). `index.html` + `style.css` +
  `app-model.js`, `app-ui.js`, `app-init.js`, `app-animaciones.js`, `menu-toggle.js`.
  PWA instalable vía `manifest.json` y `sw.js`.
- **Backend:** Node.js + Express (`server/server.js`), proxy/caché de
  [football-data.org v4](https://www.football-data.org/) y persistencia del historial.
- **Motor / pipeline:** Python (`pronosticos.py`, `recalibracion.py`) con paridad
  numérica verificada contra el motor JS (`test_paridad.py`).

## Estructura

```
index.html            Shell de la app (vistas SPA por #hash)
style.css             Estilos
app-model.js          Modelo JS (fallback), API y datos
app-ui.js             Render de las vistas
app-init.js           Arranque, modales y lógica de combinadas
app-animaciones.js    Animaciones de UI
menu-toggle.js        Menú móvil
sw.js / manifest.json Service worker + manifiesto PWA
pronosticos.py        Genera pronosticos.json + históricos (motor canónico)
recalibracion.py      Diagnóstico y propuesta de recalibración supervisada
parametros_aprobados.json  Overrides aprobados que consume el motor
server/server.js      API Express (partidos, stats, H2H, standings, historial)
server/data/          SQLite local del historial (ignorado por git)
.github/workflows/    CI + bot diario de pronósticos
```

## Puesta en marcha

### Frontend

El frontend es estático. Como usa `fetch()` y módulos, hay que servirlo por HTTP
(no abrir con doble clic):

```bash
npx serve .
# o: python -m http.server 8000  ->  http://localhost:8000
```

> Nota: `app-model.js` apunta el backend a `https://fulbito-forh.onrender.com`
> (`BACKEND_URL`). Para desarrollo local, cambialo a `http://localhost:3000`.

### Backend

```bash
npm install
npm start        # equivale a: cd server && node server.js
npm run dev      # recarga automática (node --watch)
```

Variables de entorno (copiá `.env.example` a `.env`):

| Variable | Requerida | Descripción |
| --- | --- | --- |
| `FOOTBALL_DATA_API_KEY` | Sí (backend) | API key de football-data.org |
| `HISTORIAL_API_KEY` | Sí (prod) | Protege las escrituras de `/api/historial` (`X-Api-Key`) |
| `DATABASE_URL` | Recomendada (prod) | Postgres gestionado; si falta usa SQLite local |
| `PORT` | No | Puerto del server (Render lo inyecta; local `3000`) |

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run check` | Chequeo de sintaxis de todo el JS y el server |
| `npm test` | Suite de recalibración (12 escenarios) |
| `npm run test:parity` | Paridad numérica Python ↔ JS |
| `npm run test:server` | Persistencia del historial (arranca el server y prueba el storage) |
| `npm run verify` | Verificación del modelo JS |
| `npm run smoke` | Smoke test del frontend (carga de módulos) |

## Pipeline diario

`.github/workflows/actualizar_pronosticos.yml` corre a las **08:00 UTC**:
ejecuta paridad + recalibración, regenera `pronosticos.json`, commitea el
artefacto y la telemetría, y abre un **PR de recalibración** para aprobación
manual (los overrides aprobados se guardan en `parametros_aprobados.json`).

El workflow `ci.yml` valida todo en cada push/PR (sintaxis, paridad, recalibración,
persistencia, modelo, smoke y utilidades de frontend).

## Privacidad, i18n y observabilidad

- **Legal:** `privacidad.html` y `terminos.html`, enlazadas desde el footer y el sitemap.
- **i18n:** `i18n.js` traduce el chrome marcado con `data-i18n` (ES/EN) y persiste la
  preferencia en `localStorage`. Se cambia desde el menú de perfil. Los textos del
  motor siguen en español.
- **Escapado:** `escaparHTML()` (en `app-model.js`) sanea todo dato externo antes de
  entrar a un `innerHTML` (anti-XSS).
- **Errores:** manejador global + banner de aviso; las llamadas de red tienen timeout
  de 15 s y los errores no capturados se reportan a `POST /api/log` (best-effort, sin
  persistir datos personales).

## Despliegue

- **Frontend:** GitHub Pages (sitio canónico: `https://kkkxxxs.github.io/fulbito/`).
- **Backend:** Render (free tier). Configurá `DATABASE_URL` (Neon/Supabase/Render)
  para que el historial sobreviva a los redeploys; sin ella usa SQLite efímero.

## Deuda técnica conocida

- **Persistencia del pipeline:** `pronosticos.json` / `pronosticos_historicos.jsonl`
  se commitean a diario con `git add -f`: el repo crecerá sin límite. Migrarlos a
  la DB/objeto es una decisión de arquitectura (ver `ARQUITECTURA_PENDIENTE.md`).
- **Identidad de usuario:** no hay login. El historial global es un pool anónimo;
  el personal vive en `localStorage`. Añadir auth (JWT/Supabase) es un cambio mayor.
- **Frontend monolítico:** sin build ni tests por módulo; `style.css` es grande.
- **i18n parcial:** solo se traduce el chrome con `data-i18n`, no los textos del motor.
- **CSP:** se aplica vía `<meta>` con `'unsafe-inline'` (hay handlers/estilos inline);
  migrar a un build permitiría endurecerla.
</content>
