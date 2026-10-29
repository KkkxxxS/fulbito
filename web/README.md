# Fulbito Web (preview Astro)

Landing pública de Fulbito, fase 0 de la migración incremental descrita en
[`../MIGRACION_ASTRO.md`](../MIGRACION_ASTRO.md). **No reemplaza la app actual**:
es un artefacto estático separado que se puede desplegar en un preview sin tocar
`index.html` ni la SPA.

## Qué incluye

- Landing en español con hero, producto, cómo funciona, transparencia y FAQ.
- SEO base: canonical, Open Graph, Twitter Card, JSON-LD `WebApplication`,
  `robots.txt` y `sitemap.xml` generados en build.
- Tokens visuales alineados con `../style.css`, sin copiar el CSS global de la app.
- Todos los CTA llevan a la app existente en GitHub Pages.
- Sin JavaScript de cliente, sin cookies y sin llamadas a la API en esta fase.
- Accesibilidad: skip link, foco visible, contraste y `prefers-reduced-motion`.

## Comandos

Requiere Node **22.23.4 o superior** (lo exige Astro 7).

```bash
cd web
npm install
npm run dev      # http://localhost:4321
npm run build    # genera dist/
npm run preview  # sirve dist/ localmente
```

## Configurar el dominio

`astro.config.mjs` usa `SITE_URL` para canonical, sitemap y `robots.txt`:

```bash
# PowerShell
$env:SITE_URL="https://tu-preview.vercel.app"; npm run build
```

Sin variable, el valor por defecto es `https://fulbito-preview.vercel.app`.
En producción, usar el dominio final (por ejemplo `https://fulbito.app`).

> El preview asume que el sitio se sirve en la **raíz** del dominio. Si algún día
> se publica en un subpath (por ejemplo GitHub Pages `/fulbito/`), hay que
> configurar `base` en `astro.config.mjs` y ajustar canonical/sitemap.

## Deploy de preview

El proyecto es estático (`output: 'static'`), así que cualquier hosting de
archivos sirve. Tres opciones sin tocar el repo principal:

### Render Static Site (todo en Render)

1. Render Dashboard → **New + → Static Site**.
2. Conectar el repositorio.
3. **Root Directory:** `web`.
4. **Build Command:** `npm run build`.
5. **Publish Directory:** `dist`.
6. Variable `SITE_URL` con la URL del static site (ej. `https://fulbito-web.onrender.com`).
7. Node **22.23.4+** (Astro 7 lo exige).

No reemplaza el Web Service del backend: son dos servicios separados.

### Vercel

1. Importar el repositorio en Vercel.
2. **Root Directory:** `web`.
3. **Framework Preset:** Astro.
4. **Build Command:** `npm run build`.
5. **Output Directory:** `dist`.
6. Añadir `SITE_URL` con la URL del preview.

### Cloudflare Pages

1. Crear un proyecto Pages conectado al repo.
2. **Root directory:** `web`.
3. **Build command:** `npm run build`.
4. **Build output directory:** `dist`.
5. Variable de entorno `SITE_URL` con la URL de Pages.

No se necesita Node adapter ni runtime: es HTML/CSS estático.

## Relación con la app

| Artefacto | Ruta | Estado |
| --- | --- | --- |
| App SPA/PWA | `/` (GitHub Pages) | Sin cambios, sigue siendo la app |
| Landing Astro | `web/` | Preview de fase 0 |
| Backend | `server/` en Render | Sin cambios |

Cuando la landing esté aprobada, la fase 1 migra las páginas públicas
(`privacidad`, `terminos`, `metodologia`, `resultados`) y define la ruta estable
de la app (`/app/`). Hasta entonces, este directorio es solo un preview.

## Qué no hace todavía

- No migra el dashboard ni el service worker.
- No crea autenticación nueva: la app sigue usando Express + PostgreSQL.
- No agrega paywall, Stripe ni planes.
- No reemplaza `/` en producción.
