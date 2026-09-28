# Hero 图目录

⚠️ 2026-09-17 审计 E5：本目录**没有** `home-hero.jpg`，而 `Layout.astro` 曾把它当全站默认
OpenGraph 分享图 → 构建页面的 `og:image` 指向 404。

**现状（已收口）**：全站默认分享图是 `public/specimens/hero-specimen.jpg`
（1920×1081，首页 preload / 大多数页 OG 共用）。价目表覆写为
`public/images/price-list/cover.jpg`（1024×684）。

若要放专门的 OG 图到本目录，请同时改 `src/components/Layout.astro` 的默认
`image` / `imageWidth` / `imageHeight`，并跑 `astro build` + `npm run verify:site-dist`，
避免再次出现「引用不存在的占位图」。
