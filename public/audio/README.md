# 音频目录

按文档约定，这里应放置：

- `ambient-30s.mp3` — 工作室 30 秒环境音（钢笔沙沙、玻璃柜低响、咖啡机蒸汽、室内乐底噪）

**v0.1 状态**：尚未录制。`senses.astro` 中"听 · Sound"段落 **未传入 `audio` 属性**，因此页面只显示文字；不会有空音频播放器或 404。

**接入方法**：录好后放本目录，然后在 `src/pages/senses.astro` 中给 `<SenseSpread sense="听" ...>` 加上 `audio="/audio/ambient-30s.mp3"` 即可。
