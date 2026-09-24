import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  adapter: cloudflare(),
  site: 'https://fastbgremove.com',
  redirects: {
    '/passport-photo': '/passport-photo-white-background',
    '/signature': '/transparent-signature-maker',
    '/vs-remove-bg': '/remove-bg-alternative'
  },
  integrations: [sitemap()],
  devToolbar: {
    enabled: false
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['@imgly/background-removal']
    }
  }
});
