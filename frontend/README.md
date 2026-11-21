# Frontend — Estructura modular (Fase 7 / Fase 10 en curso)

Módulos cargados por `index.html` en orden:

| Archivo | Namespace objetivo (Fase 10.1) | Rol |
|---|---|---|
| `bootstrap.js` | — (shell, registra SW) | Red de arranque + registro del Service Worker |
| `menu-toggle.js` | `FULBITO.menu` |toggle del menú móvil |
| `i18n.js` | `FULBITO.i18n` | Internacionalización (localStorage + trampas) |
| `auth.js` | `FULBITO.auth` | API key de historial y auth en storage |
| `v-multideporte.js` | `FULBITO.deportes` | Configuración por deporte, odds, layout |
| `app-animaciones.js` | `FULBITO.animaciones` | Animaciones dinámicas |
| `app-model.js` | `FULBITO.model` | Motor de pronósticos (Poisson/Dixon-Coles, H2H) |
| `app-ui.js` | `FULBITO.render` | Renders DOM + controles de UI |
| `app-init.js` | `FULBITO.app` | Boot: archivos estáticos, carga inicial |
| `events.js` | `FULBITO.events` | Dispatcher central de `data-action` |
| `sw.js` | (worker, no es app) | Service Worker |

Reglas actuales (verificadas por `server/test-frontend-namespaces.js`):

1. No hay `<script>` inline en `index.html` (solo `<script type="application/ld+json">`, que no ejecuta código).
2. `bootstrap.js` es el único script sincrónico en `<head>` y se carga sin `defer`.
3. Resto de los módulos usan `defer`.
4. `window.FULBITO` es el único namespace y se crea por `app-init.js`.

Trabajo pendiente de Fase 10.1 (migración de ES modules):

1. Convertir `app-model.js`, `app-ui.js`, `app-init.js`, `app-animaciones.js`,
   `menu-toggle.js`, `i18n.js`, `auth.js`, `v-multideporte.js`, `events.js`
   a `export`s ES modules y `import`s en un orden alto → bajo.
2. Mover `sw.js` a `frontend/sw.js` y registrarlo con path dinámico
   (`navigator.serviceWorker.register('/sw.js', { scope: '/' })`).
3. Actualizar hashes de CSP (`server/server.js`, Fase 6.1) si cambian los
   scripts públicos.
4. Calibrar trampas de test `smoke-frontend.js` y `test:frontend-namespaces.js`.

Referencias: `docs/architecture/MODULES.md`, `docs/architecture/ROADMAP.md` (Fase 10).
