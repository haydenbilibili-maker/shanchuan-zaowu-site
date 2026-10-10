/**
 * 出货中心改前 / 改后预览（开发工具，不进 check:admin）
 *
 * 结构从真 WXML 现读（lib/wxml-preview.mjs），样式从真 WXSS 现读并展开 @import；
 * 无头 Chrome 以 750px 视口截图（rpx 1:1 当 px），fixed 底栏 / 弹层按视口真实落位。
 *
 * 用法：
 *   node miniprogram/scripts/render-shipment-center-preview.mjs --out-dir <目录> [--before-dir <旧页快照目录>]
 *   可加 --only a,b 只出指定场景。
 *   旧页快照目录下应有 shipment-ops/ 与 shipment-sku/ 的 index.wxml|wxss（改前 HEAD 或工作区副本）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const EXTRA = join(ROOT, 'miniprogram/subpackages/extra')
const SAMPLE_IMG = `file://${join(ROOT, 'public/images/price-list/blue-morpho-dome-single.jpg')}`

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const outDir = argOf('--out-dir', join(tmpdir(), 'shipment-center-preview'))
const beforeDir = argOf('--before-dir', '')
const only = argOf('--only', '')
mkdirSync(outDir, { recursive: true })

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——预览工具，不参与守卫')
  process.exit(1)
}

const rpx2px = (t) => t.replace(/(\d*\.?\d+)rpx/g, '$1px')

/** 展开 @import（相对路径按 importer 所在目录解析；快照目录里的 ../utils 回落到真 extra/utils） */
function loadWxss(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  return src.replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    let p = resolve(dirname(file), rel)
    if (!existsSync(p)) p = resolve(EXTRA, 'shipment-ops', rel)
    return existsSync(p) ? loadWxss(p, seen) : ''
  })
}

function appTokens() {
  const app = readFileSync(join(ROOT, 'miniprogram/app.wxss'), 'utf8')
  const start = app.indexOf('page {')
  if (start < 0) return ''
  let depth = 0
  for (let i = app.indexOf('{', start); i < app.length; i += 1) {
    if (app[i] === '{') depth += 1
    else if (app[i] === '}') {
      depth -= 1
      if (depth === 0) return rpx2px(app.slice(app.indexOf('{', start) + 1, i))
    }
  }
  return ''
}

const stores = [{ id: 's1', name: '山海造物·静安店' }, { id: 's2', name: '山海造物·徐汇店' }]
const listRows = [
  {
    _id: 'n1', customerLine: '山海造物·静安店', storeName: '山海造物·静安店', statusLabel: '已确认', statusTone: 'brass',
    sourceLabel: 'SKU 开单', sourceTone: 'brass', settleLabel: '未结算', settleTone: 'warn', entryPathLabel: '选 SKU',
    shipmentNo: 'SH20260928-007', shipmentDate: '2026-09-28', totalQty: 12, itemCount: 2, amountText: '1,860.00',
    itemsPreview: '大蓝闪蝶·A1·框 10x18 ×10、光明女神闪蝶 ×2', updatedAtText: '09-28 19:20'
  },
  {
    _id: 'n0', customerLine: '山海造物·徐汇店', storeName: '山海造物·徐汇店', statusLabel: '已发货', statusTone: 'ok',
    sourceLabel: '粘贴识别', sourceTone: 'muted', settleLabel: '已入账单', settleTone: 'ok', entryPathLabel: '粘贴',
    shipmentNo: 'SH20260927-003', shipmentDate: '2026-09-27', totalQty: 30, itemCount: 3, amountText: '3,420.00',
    itemsPreview: '枯叶蛱蝶 ×10、金斑喙凤蝶 ×10 等', moreItems: true, logisticsText: '顺丰 SF1234567890', updatedAtText: '09-27 17:02'
  }
]
const summary = { totalQty: 42, count: 2, itemCount: 5, byStore: [{ storeId: 's1', storeName: '静安店', totalQty: 12 }, { storeId: 's2', storeName: '徐汇店', totalQty: 30 }] }
const skuLines = [
  { skuId: 'k1', skuName: '大蓝闪蝶 A1 · 框 10x18', qty: 10, unitPriceText: '¥156.00', lineTotalText: '¥1,560.00', pricingStatus: 'priced', useLineRate: false, rateSource: 'sku', effectiveRatePct: 30 },
  { skuId: 'k2', skuName: '光明女神闪蝶 · 造景盒', hasScene: true, sceneCost: '20', qty: 2, unitPriceText: '¥150.00', lineTotalText: '¥300.00', pricingStatus: 'priced', useLineRate: true, laborRatePct: '40' }
]
const common = {
  ready: true, isSuper: true, canWrite: true, stores, storeNames: stores.map((s) => s.name),
  storeFilterNames: ['全部门店', ...stores.map((s) => s.name)], storeFilterIndex: 0,
  statusFilterNames: ['全部状态'], statusFilterIndex: 0, sourceFilterNames: ['全部来源'], sourceFilterIndex: 0,
  sheetBodyPx: 520, highlightIds: {}, tabs: [{ key: 'create', label: '开单' }, { key: 'list', label: '单据' }, { key: 'overview', label: '总览' }, { key: 'library', label: 'SKU' }],
  draft: { storeIndex: 0, shipmentDate: '2026-09-28', note: '' }, globalRatePct: 30, pricingEnabled: true,
  lines: [], totalText: '¥0.00', totalQty: 0, pendingCount: 0, canSave: false, saveHint: '先加明细',
  skuPicker: {}, skuEdit: {}, picker: {}, libForm: {}, libView: 'material',
  skuCat: { list: [], counts: {}, categoryNames: ['全部分类'], categoryValues: [''], categoryIndex: 0, filter: 'all' }, single: { qty: '1' }, formCategoryNames: [], formStatusNames: ['已确认'],
  list: [], summary: { totalQty: 0, count: 0, itemCount: 0, byStore: [] }, statusQuick: '',
  createBusy: false, saving: false, parsing: false, loading: false, dashLoading: false, libLoading: false, busy: false,
  keyword: '', libKeyword: '', itemKeyword: '', itemSearching: false, itemHits: [], filterOpen: false, dateFrom: '', dateTo: '', removePendingId: ''
}

const skuRows = [
  { _id: 'k1', skuName: '大蓝闪蝶 A1 · 框 10x18', matText: '大蓝闪蝶（A1）', pkgText: '框 10x18', rateText: '手工费 全局 30%', materialCategory: '蝴蝶', priceText: '¥123.50', priced: true },
  { _id: 'k2', skuName: '光明女神 · 玻璃罩 15x22 · 造景', matText: '光明女神', pkgText: '玻璃罩 15x22', sceneText: '造景 ¥20.00', rateText: '手工费 40%', materialCategory: '蝴蝶', priceText: '¥186.40', priced: true, needsReview: true },
  { _id: 'k3', skuName: '熊蜂王 · 玻璃罩', matText: '熊蜂王', pkgText: '玻璃罩', rateText: '手工费 全局 30%', materialCategory: '甲虫', priceText: '待核价', priced: false, pricingNote: '价目表里没有「熊蜂王」' },
  { _id: 'k4', skuName: '枯叶蛱蝶 · 框 10x18', matText: '枯叶蛱蝶', pkgText: '框 10x18', rateText: '手工费 全局 30%', materialCategory: '蝴蝶', priceText: '¥61.10', priced: true, inactive: true }
]
const skuCatData = { list: skuRows, total: 4, counts: { all: 4, active: 3, inactive: 1, review: 1 }, categoryNames: ['全部分类', '甲虫', '蝴蝶'], categoryValues: ['', '甲虫', '蝴蝶'], categoryIndex: 0, filter: 'all', keyword: '', tip: '', tipTone: 'info' }

const AFTER_WXML = join(EXTRA, 'shipment-ops/index.wxml')
const AFTER_WXSS = join(EXTRA, 'shipment-ops/index.wxss')
const scenes = [
  { name: 'after-create-sku', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500, data: { ...common, activeTab: 'create', createMode: 'sku', lines: skuLines, totalText: '¥1,860.00', totalQty: 12, canSave: true } },
  {
    name: 'after-create-single', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 2100,
    data: { ...common, activeTab: 'create', createMode: 'single', single: { itemName: '大蓝闪蝶标本框', qty: '2', unitPrice: '180', materialName: '大蓝闪蝶', materialGrade: 'A1', packagingName: '框', packagingSize: '10x18' }, formAmountPreview: '360.00' }
  },
  {
    name: 'after-list-highlight', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500,
    data: { ...common, activeTab: 'list', list: listRows, summary, highlightIds: { n1: true }, showAgain: true, listTip: '已开单 SH20260928-007 · ¥1,860.00（已展示刚写入单据）', listTipTone: 'ok' }
  },
  {
    name: 'after-library', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500,
    data: {
      ...common, activeTab: 'library', libKind: 'material', libTipTone: 'info',
      libList: [
        { _id: 'a', name: '大蓝闪蝶', option: 'A1', isDefaultOption: true, unitPriceText: '¥60.00', unit: '只', category: '蝴蝶', refText: '参考采购 ¥42.00', aliasesText: '大蓝闪', thumb: SAMPLE_IMG },
        { _id: 'b', name: '大蓝闪蝶', option: 'A2', unitPriceText: '¥45.00', unit: '只', category: '蝴蝶' },
        { _id: 'c', name: '光明女神闪蝶', option: '默认', isDefaultOption: true, unitPriceText: '¥88.00', unit: '只', category: '蝴蝶' },
        { _id: 'd', name: '枯叶蛱蝶', option: '默认', isDefaultOption: true, inactive: true, unitPriceText: '¥12.00', unit: '只', category: '蝴蝶' }
      ]
    }
  },
  {
    name: 'after-library-form', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500,
    data: { ...common, activeTab: 'library', libKind: 'packaging', libList: [], libForm: { show: true, kind: 'packaging', name: '框', option: '10x18', unitPrice: '35', unit: '个', aliases: '', note: '', isDefault: true, image: 'cloud://x/y.jpg', imageThumb: SAMPLE_IMG } }
  },
  { name: 'after-sku-catalog', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500, data: { ...common, activeTab: 'library', libView: 'sku', skuCat: skuCatData } },
  {
    name: 'after-sku-detail', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 2300,
    data: {
      ...common, activeTab: 'library', libView: 'sku', skuCat: skuCatData, sheetBodyPx: 1900,
      skuEdit: {
        show: true, mode: 'edit', origin: 'catalog', id: 'k2', name: '光明女神 · 玻璃罩 15x22 · 造景', nameTouched: false, namePlaceholder: '光明女神 · 玻璃罩 15x22 · 造景',
        materialName: '光明女神', materialGrade: '', packagingName: '玻璃罩', packagingSize: '15x22', useGlobalRate: false, laborRatePct: 40,
        hasScene: true, sceneCost: '20', note: '客户常用', status: 'active', needsReview: true, importBatch: 'feishu-2026-10-09',
        unitPriceText: '¥186.40', pricingStatus: 'priced', breakdown: '原材料 ¥88.00 · 包装 ¥24.00 · 手工费 ¥44.80（40%） · 造景 ¥20.00',
        refsText: '正式单 3 张 · 草稿 1 张', metaText: '最近修改 2026-10-10 21:05 · 超管', problems: [], removeStep: 'blocked',
        blockedText: '被 3 张出货单、1 张草稿 引用，不能删除；请改为停用'
      }
    }
  },
  {
    name: 'after-library-impact', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500,
    data: { ...common, activeTab: 'library', libKind: 'material', libList: [], libCategoryNames: ['蝴蝶'], libCategoryIndex: 0, libForm: { show: true, id: 'a', kind: 'material', name: '大蓝闪蝶', option: 'A1', unitPrice: '60', unit: '只', aliases: '大蓝闪', note: '', isDefault: true, impactText: '影响 12 个 SKU 的算价（其中启用 10 个）；已开的单据不受影响' } }
  }
]
if (beforeDir) {
  scenes.unshift(
    {
      name: 'before-ops-list', wxml: join(beforeDir, 'shipment-ops/index.wxml'), wxss: join(beforeDir, 'shipment-ops/index.wxss'), h: 1500,
      data: { ...common, activeTab: 'list', list: listRows, summary, form: {}, formStoreNames: [] }
    },
    {
      name: 'before-sku', wxml: join(beforeDir, 'shipment-sku/index.wxml'), wxss: join(beforeDir, 'shipment-sku/index.wxss'), h: 1500,
      data: { ...common, boot: false, flowStep: 2, storeName: '山海造物·静安店', note: '', lines: skuLines, totalText: '¥1,860.00', totalQty: 12, canSave: true, storeIndex: 0, shipmentDate: '2026-09-28' }
    }
  )
}

async function shoot(scene) {
  const missing = new Set()
  const body = renderWxml(readFileSync(scene.wxml, 'utf8'), scene.data, { lenient: true, onMissing: (k) => missing.add(k) })
  const css = rpx2px(loadWxss(scene.wxss))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --font-mono: "SF Mono", Menlo, monospace; ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; font-family: -apple-system, "PingFang SC", sans-serif; }
input, .input { display: block; min-height: 1em; }
</style><style>${css.replace(/\bpage\s*\{/g, 'body {')}</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `shipment-center-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'sc-ship-preview-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=750,${scene.h}`, `--screenshot=${out}`, `file://${htmlPath}`
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    if (existsSync(out) && statSync(out).size > 1000) break
    await new Promise((r) => setTimeout(r, 300))
  }
  await new Promise((r) => setTimeout(r, 500))
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}${missing.size ? `（缺字段按空渲染 ${missing.size} 个）` : ''}`)
}

for (const s of scenes) if (!only || only.split(',').includes(s.name)) await shoot(s)
