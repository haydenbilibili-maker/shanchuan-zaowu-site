/**
 * 商品知识卡本地出图（开发工具，不进守卫链）
 *
 * 用 @napi-rs/canvas 跑与小程序**同一份** subpackages/feature/utils/knowledgeCard.js 的
 * drawKnowledgeCard，商品数据按详情页 loadKnowledgeCardAssets 的同款取数（pickCaptionSource）。
 * 证明的是排版与版式；真机字体（Android 无宋体时回退）以真机为准（E8）。
 *
 * 用法：node miniprogram/scripts/render-knowledge-card.mjs --cases <cases.json> --out-dir <目录> [--qr <png>] [--sans]
 * cases.json：[{ name, product: {商品原始字段}, image: <本地路径或 https> }]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

let napi
try {
  napi = require('@napi-rs/canvas')
} catch (e) {
  console.error('✗ 未找到 @napi-rs/canvas（预览工具，不参与守卫）')
  process.exit(1)
}
const { createCanvas, loadImage } = napi

/** 仓根是 "type":"module"，小程序源码是 CJS → 自己喂 module/exports 执行真源码 */
function loadCjs(file) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', readFileSync(file, 'utf8'))(module, module.exports)
  return module.exports
}
const KC = loadCjs(resolve(HERE, '../subpackages/feature/utils/knowledgeCard.js'))
const { sanitizeLatinName } = loadCjs(resolve(HERE, '../utils/latinDisplay.js'))

const cases = JSON.parse(readFileSync(resolve(argOf('--cases', '')), 'utf8'))
const outDir = resolve(argOf('--out-dir', join(HERE, '..', '..', '.tmp', 'knowledge-card')))
const qrPath = argOf('--qr', '')
/** --sans：模拟真机没有宋体、回退到苹方时的样子 */
const SANS = argv.includes('--sans')
mkdirSync(outDir, { recursive: true })

async function load(src) {
  if (!src) return null
  try {
    if (/^https?:\/\//.test(src)) {
      const res = await fetch(src)
      return await loadImage(Buffer.from(await res.arrayBuffer()))
    }
    return await loadImage(readFileSync(src))
  } catch (e) {
    console.warn(`  图片加载失败 ${src}: ${e.message}`)
    return null
  }
}

const qr = await load(qrPath)
const summary = []
for (const c of cases) {
  const p = c.product || {}
  const remote = { title: p.title, latinName: p.latinName || '', category: p.category || '', brief: p.brief || '', description: p.description || p.brief || '' }
  const assets = {
    productId: p._id,
    title: remote.title || p.title || '藏品',
    latinName: sanitizeLatinName(remote.latinName || p.latin || p.scientificName || ''),
    category: remote.category,
    taxonomy: p.taxonomy || null,
    origin: p.origin || '',
    caption: KC.pickCaptionSource(p, remote),
    brand: '山海造物',
    brandEn: "NATURE'S CREATIONS",
    tagline: '把山海带回家'
  }
  const canvas = createCanvas(KC.CARD_W * 2, KC.CARD_H * 2)
  const raw = canvas.getContext('2d')
  raw.scale(2, 2)
  const ctx = SANS
    ? new Proxy(raw, {
      get: (t, k) => (typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
      set: (t, k, v) => {
        t[k] = k === 'font' ? String(v).replace(/"Songti SC".*serif$/, '"PingFang SC", "Hiragino Sans GB", sans-serif') : v
        return true
      }
    })
    : raw
  const image = await load(c.image)
  const L = KC.drawKnowledgeCard(ctx, assets, { image, qr })
  const file = join(outDir, `${c.name}.png`)
  writeFileSync(file, canvas.toBuffer('image/png'))
  summary.push({ name: c.name, file, captionSize: L.caption.size, captionLines: L.caption.lines, cut: L.caption.cut, window: L.win, slack: L.slack })
  console.log(`✓ ${file}  简介 ${L.caption.lines.length} 行 / ${L.caption.size}px / 收尾=${L.caption.cut}`)
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
