import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://shanchuanzaowu.pages.dev',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
});
