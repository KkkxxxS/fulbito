import type { APIRoute } from 'astro';

const routes = ['/'];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://fulbito-preview.vercel.app');
  const urls = routes
    .map((route) => `  <url>\n    <loc>${new URL(route, base).href}</loc>\n    <changefreq>daily</changefreq>\n    <priority>${route === '/' ? '1.0' : '0.7'}</priority>\n  </url>`)
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
};
