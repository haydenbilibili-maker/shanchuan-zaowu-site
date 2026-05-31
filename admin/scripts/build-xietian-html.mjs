/**
 * 将谢天命理 Markdown 转为可嵌入 `public/partner-destiny-center.html` 的 HTML 片段。
 * 默认输出 `public/xietian-destiny-fragment.html`，需手动替换主文件中 `id="tab-xt"` 整块（见文件内「谢天」注释锚点）。
 * 运行：npm run build:xietian-fragment
 * 或：node scripts/build-xietian-html.mjs [源.md路径]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { marked } from 'marked'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const mdPath =
  process.argv[2] || '/Users/hayden_lee/Downloads/谢天_命理全书_完整扩展版.md'

const md = readFileSync(mdPath, 'utf8')

marked.setOptions({
  gfm: true,
  breaks: false
})

let inner = marked.parse(md)

inner = inner.replace(/<table>/g, '<table class="stbl">')

const fragment = `<!-- ══ 谢天 · 命理全书 完整扩展版（Markdown 渲染） ══ -->
<div class="tc" id="tab-xt">
<div class="xietian-hero">
<div class="hero-label">山 海 造 物 · 命 理 全 书</div>
<h1 class="xietian-hero-title">谢天</h1>
<div class="hero-sub">乙木日主 · 比劫格 · 食神泄秀 · 双印透干</div>
<div class="hero-meta"><span>癸酉年 乙卯月 乙未日 壬午时</span><span>1993.03.15 · 真太阳时</span></div>
</div>
<div class="xietian-md">
${inner}
</div>
</div>
`

const out = join(root, 'public', 'xietian-destiny-fragment.html')
writeFileSync(out, fragment, 'utf8')
console.log('Wrote', out, 'chars', fragment.length)
