#!/usr/bin/env node
/**
 * 礼赠证书离线出图（开发工具，不在 check:admin 里）：用**真源码** certDraw.js + @napi-rs/canvas
 * 渲染「非礼赠收藏证书 / 受礼人收藏证书 / 送礼人赠予凭证」，输出 PNG 与左右对比图。
 * 字体度量与真机不同（本机字体替换），输出只用于看版式与区别，不能替代真机验收。
 *
 * 用法：node miniprogram/scripts/render-gift-certs.mjs [--out <dir>] [--w 300 --h 480]
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const { createCanvas, Image, GlobalFonts } = require('@napi-rs/canvas')
// 默认字体缺中文字形：按真机语义把 serif / sans-serif 映射到本机中文字体（找不到就用回退，图里会出现方框）
for (const [file, alias] of [
  ['/System/Library/Fonts/Supplemental/Songti.ttc', 'serif'],
  ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'sans-serif'],
  ['/System/Library/Fonts/STHeiti Medium.ttc', 'sans-serif']
]) {
  try { GlobalFonts.registerFromPath(file, alias) } catch (e) { /* 非 macOS 环境 */ }
}
import { loadCjsModule } from './lib/cjs-loader.mjs'
const certDraw = loadCjsModule(resolve(ROOT, 'miniprogram/subpackages/business/certificate/certDraw.js'))

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : dflt
}
const OUT = resolve(arg('--out', resolve(ROOT, 'miniprogram/docs/assets/gift-cert')))
const W = Number(arg('--w', 300))
const H = Number(arg('--h', 480))
const SCALE = 2

function specimen() {
  const c = createCanvas(400, 400)
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 400, 400)
  grd.addColorStop(0, '#3B6E8F'); grd.addColorStop(1, '#1B2F45')
  g.fillStyle = grd; g.fillRect(0, 0, 400, 400)
  g.fillStyle = 'rgba(120,200,255,0.85)'
  g.beginPath(); g.ellipse(140, 200, 110, 70, -0.5, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.ellipse(260, 200, 110, 70, 0.5, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#111'; g.fillRect(194, 110, 12, 190)
  return c.toBuffer('image/png')
}
const SPECIMEN = specimen()

function stubCanvas() {
  return {
    createImage() {
      const img = new Image()
      const out = { width: 0, height: 0 }
      Object.defineProperty(out, 'src', {
        set() {
          img.onload = () => { out.width = img.width; out.height = img.height; out.__real = img; out.onload && out.onload() }
          img.src = SPECIMEN
        }
      })
      return out
    }
  }
}

function wrapCtx(ctx) {
  return new Proxy(ctx, {
    get(t, k) {
      if (k === 'drawImage') return (img, ...rest) => t.drawImage(img.__real || img, ...rest)
      const v = t[k]
      return typeof v === 'function' ? v.bind(t) : v
    },
    set(t, k, v) { t[k] = v; return true }
  })
}

const product = { title: '光明女神闪蝶', latin: 'Morpho helena', image: 'specimen.png' }
const VIEWS = {
  holder_plain: { kind: 'holder', orderNo: 'SH20260928001', date: '2026.9.28', product, user: '山海收藏家', level: '秘银·采集家' },
  gift_holder: {
    kind: 'gift_holder', serial: 'SH20260928001', date: '2026.09.28', product, user: '林间小满', level: '原木·见习者',
    gift: { fromName: '阿山', note: '愿你的书桌上也有一片会发光的蓝色山海，生日快乐。' }
  },
  gift_voucher: {
    kind: 'gift_voucher', serial: 'GV-SH20260928001', date: '2026.09.28', product, user: '阿山', level: '',
    gift: { recipientName: '小满', note: '愿你的书桌上也有一片会发光的蓝色山海，生日快乐。', statusLabel: 'TA 已签收' }
  }
}

async function render(view) {
  const canvas = createCanvas(W * SCALE, H * SCALE)
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  await certDraw.drawCertificate(wrapCtx(ctx), W, H, view, stubCanvas(), async (s) => s)
  return canvas
}

mkdirSync(OUT, { recursive: true })
const rendered = {}
for (const [name, view] of Object.entries(VIEWS)) {
  rendered[name] = await render(view)
  writeFileSync(join(OUT, `${name}.png`), rendered[name].toBuffer('image/png'))
}

const gap = 24 * SCALE
const pad = 20 * SCALE
const cmp = createCanvas(W * SCALE * 2 + gap + pad * 2, H * SCALE + pad * 2 + 30 * SCALE)
const g = cmp.getContext('2d')
g.fillStyle = '#E9E4DA'; g.fillRect(0, 0, cmp.width, cmp.height)
g.drawImage(rendered.gift_voucher, pad, pad + 30 * SCALE)
g.drawImage(rendered.gift_holder, pad + W * SCALE + gap, pad + 30 * SCALE)
g.fillStyle = '#2C2C2C'; g.font = `bold ${14 * SCALE}px sans-serif`; g.textAlign = 'center'
g.fillText('送礼人 · 赠予凭证', pad + (W * SCALE) / 2, pad + 18 * SCALE)
g.fillText('受礼人 · 收藏证书（持有人）', pad + W * SCALE + gap + (W * SCALE) / 2, pad + 18 * SCALE)
writeFileSync(join(OUT, 'compare_giver_vs_holder.png'), cmp.toBuffer('image/png'))
console.log(`✓ 已输出到 ${OUT}（${W}×${H}，@${SCALE}x）`)
