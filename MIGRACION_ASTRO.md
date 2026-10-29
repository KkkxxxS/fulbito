# Migración incremental del frontend a Astro (decisión y plan)

> Estado: **fase 0 ejecutada**: scaffold en `web/` con landing estática y
> preview local; la app de producción sigue intacta. Fases 1–4 pendientes.
>
> Este documento registra por qué no conviene reescribir Fulbito de golpe y cómo
> migrar las páginas públicas sin poner en riesgo la app que ya funciona.
>
> Contexto: análisis de `choco.bet` con REA (2026-10), comparación con Fulbito y
> decisión de producto de **no** incorporar suscripciones/paywall por ahora.

## 1. Qué hace `choco.bet` (observado)

- **Astro** con islas hidratadas para las partes interactivas.
- API separada en `https://choco-bets.onrender.com`; el HTML estático no habla
  directo con Supabase para datos de negocio (Supabase aparece en `img-src` de
  la CSP, no como backend confirmado del frontend).
- Rutas públicas estáticas y bien indexables (`/`, `/resultados`,
  `/como-funciona`, `/tecnologia`, `/pricing`), JSON-LD, `sitemap`, `robots`,
  PWA, i18n ES/EN y tema claro/oscuro.
- Modelo comercial Free/Pro en PEN (S/ 39.90 mensual, S/ 219.90 semestral,
  S/ 349.90 anual). **No se adopta**: Fulbito sigue sin paywall.

Astro le sirve a `choco.bet` porque su producto es, sobre todo, contenido
público (landing, resultados, explicaciones) con islas de interactividad. La
app de Fulbito es lo contrario: un dashboard SPA que vive de estado local,
cálculos en el cliente y un service worker.

## 2. Estado de Fulbito

- SPA vanilla con routing por hash (`#/...`), módulos globales
  (`bootstrap.js`, `app-model.js`, `app-ui.js`, `app-init.js`, `events.js`,
  `auth.js`, etc.).
- PWA con `sw.js`, `manifest`, caché offline y GitHub Pages como hosting.
- `style.css` grande, CSP con `'unsafe-inline'` por handlers/estilos inline.
- Backend Express + PostgreSQL para cuentas/sesiones e historial personal.
  El historial global sigue funcionando con SQLite local cuando no hay
  `DATABASE_URL`.
- No hay build ni tests por componente; sí hay smoke tests y paridad numérica.

Una reescritura total a Astro obligaría a reconstruir routing, estado,
service worker, CSP, i18n y estilos a la vez. El riesgo de regresión es alto y
el beneficio inmediato (SEO del dashboard) es bajo: el dashboard no necesita
indexarse.

## 3. Decisión

**Migración incremental, no big-bang.**

1. **Astro se usa primero para lo público**: landing, legales, cómo funciona,
   tecnología, resultados históricos públicos y blog/guías. Esas páginas se
   benefician de HTML estático, SEO, sitemap y contenido versionado.
2. **La app actual sigue siendo la app** en una ruta estable (`/app/` o el
   hash actual) durante la transición. No se toca el motor ni el estado.
3. **Islas solo cuando aporten**: calculadora de pronóstico, tabla de
   resultados con filtros o comparador. Nada de hidratar el dashboard entero.
4. **Un solo backend**: Astro consume la misma API de Fulbito. No se duplica
   lógica de negocio ni se crea un segundo sistema de auth.
5. **Sin suscripciones por ahora**: no se migra `/pricing` ni se agrega paywall.

### Por qué no Astro para todo el dashboard todavía

- El routing por hash y el estado global no se traducen 1:1 a rutas de archivo.
- El service worker y la caché offline requieren revisión manual.
- La CSP actual depende de inline; Astro no la endurece por sí solo.
- El equipo (una persona) no gana velocidad reescribiendo lo que ya está
  probado; gana velocidad separando contenido de aplicación.

## 4. Plan por fases

### Fase 0 — Inventario y línea base (1–2 h)

- Listar rutas públicas reales y enlaces internos.
- Medir Lighthouse/SEO actual de la landing.
- Confirmar que GitHub Pages puede servir `dist/` de Astro (o mover el sitio a
  Vercel/Cloudflare Pages si hace falta).
- Definir la ruta de la app durante la transición (`/app/` recomendado).

**Criterio de salida:** inventario escrito y build de Astro vacío desplegado en
un preview, sin tocar producción.

### Fase 1 — Scaffold y páginas públicas (1–2 días)

- Crear `web/` (o rama `astro`) con Astro estático.
- Reutilizar tokens de color/tipografía de `style.css`; no copiar el CSS global.
- Migrar: landing, `privacidad.html`, `terminos.html`, cómo funciona y una
  página de resultados públicos.
- Sitemap, `robots.txt`, canonical, Open Graph y JSON-LD.
- Enlaces “Abrir la app” apuntando a la SPA existente.

**Criterio de salida:** preview con las páginas públicas navegables y la app
actual intacta.

### Fase 2 — Contenido y SEO (2–3 días)

- Content collections para guías/artículos y datos de resultados.
- i18n ES/EN si se mantiene el alcance; si no, dejar ES primero.
- Redirecciones 301 desde las URLs viejas.
- Medir indexación y Core Web Vitals.

**Criterio de salida:** mismas URLs públicas (o redirecciones) y mejora medible
en SEO/rendimiento; cero cambios en la app.

### Fase 3 — Islas interactivas (opcional, por demanda)

- Calculadora de pronóstico, filtros de resultados, comparador de cuotas.
- Hidratación `client:visible` o `client:idle`; nunca `client:load` masivo.
- Compartir el motor JS actual como módulo, no reimplementarlo.

**Criterio de salida:** cada isla tiene dueño, test y fallback sin JS.

### Fase 4 — Evaluar el dashboard (decisión futura)

Solo después de las fases anteriores, decidir si alguna vista del dashboard
migra a Astro/React. Si no hay una razón medida (rendimiento, SEO o
mantenibilidad), **no se migra**.

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Duplicar la app y divergir | La SPA sigue siendo la única app hasta la fase 4 |
| Romper deep links (`#/...`) | Mantener la ruta actual y redirigir `/app/` a ella |
| Perder el service worker/PWA | No tocar `sw.js` hasta la fase 4; probar instalación |
| CSP más laxa | Migrar estilos inline a clases en las páginas nuevas |
| Auth duplicada | Astro usa la misma API/sesiones; no crear Supabase Auth |
| Coste de dos despliegues | Mismo repo, dos artefactos; documentar el flujo |

## 6. Qué no se hará en esta fase

- No se reescribe el dashboard en Astro.
- No se agrega Stripe, paywall ni planes.
- No se migra la autenticación a Supabase Auth: se mantiene Express +
  PostgreSQL con sesiones opacas, ahora con rate limit, comparación en tiempo
  constante y cierre de sesiones en todos los dispositivos.
- No se elimina el fallback SQLite del historial global.

## 7. Recomendación operativa

Si el objetivo inmediato es **terminar y estabilizar** Fulbito, el orden es:

1. Cerrar la fase 1 de auth/seguridad (hecha en este cambio).
2. Configurar `DATABASE_URL` en Render y correr `npm run test:auth` contra esa
   base.
3. Recién entonces ejecutar la fase 0/1 de Astro en un preview.

Astro es una buena inversión para las páginas públicas, pero no es un atajo
para el dashboard. La migración incremental conserva lo que funciona y agrega
SEO donde sí importa.

## 8. Estado de implementación (fase 0)

- `web/` contiene un proyecto Astro 7.4.4 estático (`output: 'static'`).
- Landing en español con hero, producto, cómo funciona, transparencia y FAQ.
- `robots.txt` y `sitemap.xml` generados desde `SITE_URL`; canonical, OG,
  Twitter Card y JSON-LD.
- Sin JavaScript de cliente, sin cookies y sin llamadas a la API en esta fase.
- `npm run build` pasa; preview local en `http://localhost:4321` con
  `npm run preview`.
- La app actual (`index.html`, SPA, service worker) no se modificó.
- Pendiente: desplegar el preview en Vercel/Cloudflare Pages y migrar las
  páginas legales/metodología en fase 1.
