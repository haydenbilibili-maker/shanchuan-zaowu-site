# 五感页占位图目录

按文档约定，这里应放置 5 张占位图：

- `sight-placeholder.jpg` — 维多利亚博物馆灯光下的标本展柜
- `sound-placeholder.jpg` — 工坊里的工具与日常声音
- `smell-placeholder.jpg` — 老纸 + 木材 + 咖啡豆的气味意象
- `touch-placeholder.jpg` — 黄铜 / 玻璃 / 纸 / 果壳的触感
- `taste-placeholder.jpg` — 咖啡区的茶、咖啡与简餐

**v0.1 状态**：尚未放置真实素材，`SenseSpread` 组件会自动渲染黄铜色占位块（参考文档 §6.1 方案 B）。

**替换方法**：拍摄到位后，把 5 张 JPG 放在本目录，然后在 `src/pages/how/senses.astro` 里给每个 `SenseSpread` 加上 `image="/images/senses/xxx.jpg"` 即可。
