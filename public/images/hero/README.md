# Hero 图目录

⚠️ 2026-09-17 审计 E5：本目录**没有** `home-hero.jpg`，而 `Layout.astro` 曾把它当全站默认
OpenGraph 分享图 → 14 个页面的 og:image 指向 404。

现在全站默认分享图是 `public/specimens/hero-specimen.jpg`（首页也用它做 preload）。
若要放专门的 OG 图，请同时改 `Layout.astro` 的 `image` 默认值，避免再次出现「引用不存在的占位图」。

**v0.1 状态**：未放置；OG 图缺失不影响站点运行，只是分享卡片会显示空。
