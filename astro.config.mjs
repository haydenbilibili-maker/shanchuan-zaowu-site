import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  /** 生产 canonical / sitemap / OG 绝对地址；开发时仍用 localhost */
  site: 'https://shanhaizaowu.com',
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
