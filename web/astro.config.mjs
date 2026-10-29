import { defineConfig } from 'astro/config';

// El sitio público puede cambiar de dominio sin tocar el código:
//   SITE_URL=https://tu-dominio.com npm run build
// El valor por defecto es solo para el preview de la fase 0.
export default defineConfig({
  site: process.env.SITE_URL || 'https://fulbito-preview.vercel.app',
  output: 'static',
  build: {
    format: 'directory'
  },
  compressHTML: true
});
