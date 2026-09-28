#!/usr/bin/env node
/**
 * 出货中心守卫（settlement 域；脚本名沿用 check:shipment-sku-page，免动冻结的 package.json）
 *
 * 2026-09-28「出货单」与「出货开单」合并为出货中心（subpackages/extra/shipment-ops，四页签），
 * 旧 shipment-sku 路径改为重定向壳。蓝图：admin/docs/出货中心_融合_2026-09-28.md
 *
 * 钉死：
 *  A 合并结构
 *    1) shipment-sku 为重定向壳：redirectTo → shipment-ops ?tab=create，且不再调任何云函数
 *    2) 工作台只剩一枚「出货中心」磁贴（menu.shipmentOps），不再有「出货开单」磁贴；两份 staffAuth 一致，
 *       goShipmentSku 指向出货中心开单页签
 *    3) 出货中心页签：create / list / overview / library；资料页签店长可见（只读）；applyTab 回落无权页签
 *  B 已知坑不回退
 *    4) 底栏主按钮 .ss-cta：WXSS width:100% !important + 内联 width:100%（inline-flex 半宽坑）
 *    5) 页内每个 scroll-view scroll-y 都带内联 height（小程序硬要求）
 *    6) 写入后 revealAfterWrite → activeTab 'list' + created 乐观展示 + 原地高亮（防「写成功却报加载失败」）
 *  C 原开单契约
 *    7) SKU 开单仅超管（enterCreate 把非超管的 sku 降为 paste）；createFromSkus 行载荷不带单价/材料名
 *    8) 选 SKU 映射 hasScene/sceneCost；quoteSkus 喂造景成本
 *    9) 页内无原生 toast / modal；供应商 hub 不挂 shipment-sku / shipment-ops
 *  D 原材料 / 包装方式
 *   10) 单条补录可选带 material* / packaging*；详情明细显示 matLine
 *   11) 资料维护只用 priceBook.list / create / update / removeIfUnused（绝不调 priceBook.remove）
 *  E 2026-09-28 点名三项
 *   12) 店长只读：资料页签内每个写入口（新增/编辑/停用/排序/删除）都在 isSuper 门下；写方法首行拦非超管
 *   13) 选择器（出货中心 + shipment-edit）与资料列表都传 orderBy:'sort'
 *   14) 云函数运行时（隔离副本 + mock）：不传 orderBy 输出不变；传了按 sort 排且排除停用；
 *       removeIfUnused 有引用（按 id / 按名称+等级 / 已删出货单）必拒 IN_USE，无引用才软删；店长调用被拒
 */
import { readFileSync, existsSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const selftest = process.argv.includes('--selftest')
const TAG = '[check:shipment-sku-page]'

const EXTRA = 'miniprogram/subpackages/extra'
const FILES = {
  shellJs: `${EXTRA}/shipment-sku/index.js`,
  opsJs: `${EXTRA}/shipment-ops/index.js`,
  opsWxml: `${EXTRA}/shipment-ops/index.wxml`,
  opsWxss: `${EXTRA}/shipment-ops/index.wxss`,
  skuWxss: `${EXTRA}/shipment-ops/sku.wxss`,
  createJs: `${EXTRA}/shipment-ops/parts/create.js`,
  libraryJs: `${EXTRA}/shipment-ops/parts/library.js`,
  sharedJs: `${EXTRA}/shipment-ops/parts/shared.js`,
  staffExtra: `${EXTRA}/utils/staffAuth.js`,
  staffManager: 'miniprogram/subpackages/manager/utils/staffAuth.js',
  hubWxml: 'miniprogram/subpackages/manager/manager/index.wxml',
  settle: 'miniprogram/cloudfunctions/manageStudioSettlement/index.js',
  refsJs: 'miniprogram/cloudfunctions/manageStudioSettlement/priceBookRefs.js',
  editJs: `${EXTRA}/shipment-edit/index.js`,
  supplier: `${EXTRA}/supplier/index.js`
}

function collect(s) {
  const errs = []
  const pageJs = s.opsJs + '\n' + s.createJs + '\n' + s.libraryJs + '\n' + s.sharedJs

  // A1 重定向壳
  if (!/wx\.redirectTo\(/.test(s.shellJs) || !/shipment-ops\/index\?tab=create/.test(s.shellJs)) {
    errs.push('shipment-sku 须为重定向壳：redirectTo 出货中心 ?tab=create')
  }
  if (/callFunction|manageStoreShipment|manageStudioSettlement/.test(s.shellJs)) {
    errs.push('shipment-sku 重定向壳不得再调云函数（逻辑已并入出货中心）')
  }
  // A2 单一磁贴 + staffAuth 同步
  const tiles = s.hubWxml.match(/<text>出货中心<\/text>/g) || []
  if (tiles.length !== 1) errs.push(`工作台须恰好一枚「出货中心」磁贴（现 ${tiles.length}）`)
  if (/<text>出货开单<\/text>|<text>出货单<\/text>/.test(s.hubWxml)) {
    errs.push('工作台不得再有独立「出货开单」/「出货单」磁贴')
  }
  if (!/wx:if="\{\{menu\.shipmentOps\}\}"\s+bindtap="goShipmentOps">[\s\S]{0,200}出货中心/.test(s.hubWxml)) {
    errs.push('「出货中心」磁贴须按 menu.shipmentOps 显示并绑 goShipmentOps')
  }
  if (s.staffExtra !== s.staffManager) errs.push('extra / manager 两份 staffAuth.js 须逐字一致')
  if (!/function goShipmentSku\(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*`\$\{SHIPMENT_OPS_PATH\}\?tab=create&mode=sku`/.test(s.staffExtra)) {
    errs.push('goShipmentSku 须指向出货中心 ?tab=create&mode=sku')
  }
  // A3 页签
  if (!/key:\s*'create'/.test(s.opsJs) || !/key:\s*'list'/.test(s.opsJs) || !/key:\s*'overview'/.test(s.opsJs) || !/key:\s*'library'/.test(s.opsJs)) {
    errs.push('出货中心须有 create / list / overview / library 四页签')
  }
  if (!/tabs\.push\([^)]*key: 'library'/.test(s.opsJs) || /isSuper\)\s*tabs\.push\([^)]*key: 'library'/.test(s.opsJs)) {
    errs.push('资料页签须对店长可见（只读），不得再按 isSuper 隐藏')
  }
  if (!/applyTab\(want[\s\S]{0,160}visibleTabs\(\)\.some/.test(s.opsJs)) {
    errs.push('applyTab 须校验页签可见性（无权回落单据）')
  }
  // B4 满宽 CTA
  if (!/\.ss-cta\s*\{[^}]*[\s;{]width:\s*100%\s*!important/.test(s.skuWxss)) {
    errs.push('.ss-cta 须 width:100% !important（防 inline-flex 半宽）')
  }
  const ctas = s.opsWxml.match(/<view[^>]*class="ss-cta[^"]*"[^>]*>/g) || []
  if (!ctas.length) errs.push('出货中心须有 .ss-cta 主按钮')
  ctas.forEach((tag) => {
    if (!/style="[^"]*width:100%/.test(tag)) errs.push('每个 .ss-cta 须内联 width:100% 兜底：' + tag.slice(0, 60))
  })
  // B5 scroll-view 明确高度
  const scrolls = s.opsWxml.match(/<scroll-view[^>]*>/g) || []
  scrolls.forEach((tag) => {
    if (/scroll-y/.test(tag) && !/style="[^"]*height:\s*\{\{\s*sheetBodyPx\s*\}\}px/.test(tag)) {
      errs.push('scroll-view scroll-y 须内联 height:{{sheetBodyPx}}px：' + tag.slice(0, 60))
    }
  })
  if (!/sheetBodyPx:\s*sheetBodyPx\(\)/.test(s.opsJs)) errs.push('onLoad 须写入 sheetBodyPx')
  // B6 写入后收口
  if (!/revealAfterWrite\(opts\)/.test(s.opsJs)) {
    errs.push('写入成功须走 revealAfterWrite')
  } else {
    const body = s.opsJs.slice(s.opsJs.indexOf('revealAfterWrite(opts)'), s.opsJs.indexOf('revealAfterWrite(opts)') + 2400)
    if (!/const created = Array\.isArray\(o\.created\)/.test(body)) errs.push('revealAfterWrite 须接收 created 以便乐观展示')
    if (!/activeTab:\s*'list'/.test(body)) errs.push('revealAfterWrite 须切到单据页签（activeTab list）')
    if (!/highlightIds/.test(body)) errs.push('revealAfterWrite 须原地高亮新单（highlightIds）')
  }
  if (!/highlightIds\[item\._id\]/.test(s.opsWxml)) errs.push('单据卡须按 highlightIds 高亮')
  for (const fn of ['onSaveSku', 'confirmPaste', 'confirmSingle', 'consumeEditReturn']) {
    const at = s.createJs.indexOf(`${fn}(`)
    if (at < 0 || !/revealAfterWrite\(/.test(s.createJs.slice(at, at + 3200))) {
      errs.push(`${fn} 成功后须调 revealAfterWrite`)
    }
  }
  // C7 SKU 仅超管 + 载荷
  if (!/next === 'sku' && !this\.data\.isSuper \? 'paste'/.test(s.createJs)) {
    errs.push('enterCreate 须把非超管的 sku 方式降为 paste（SKU 开单仅超管）')
  }
  if (!/wx:if="\{\{isSuper\}\}" data-mode="sku"/.test(s.opsWxml)) errs.push('「选 SKU」方式须 wx:if isSuper')
  if (!/action:\s*'createFromSkus'/.test(s.createJs)) errs.push('SKU 保存须走 createFromSkus')
  const at = s.createJs.indexOf("action: 'createFromSkus'")
  const linesMap = at >= 0 ? s.createJs.slice(at, at + 700).match(/lines:\s*lines\.map\(\(l\)\s*=>\s*\{([\s\S]*?)return out\s*\n\s*\}\)/) : null
  if (!linesMap) errs.push('找不到 createFromSkus 的 lines.map')
  else if (/unitPrice|totalAmount|materialName/.test(linesMap[1])) errs.push('createFromSkus 行载荷不得带单价/材料名')
  // C8
  if (!/function mapSkuForPicker/.test(s.createJs) || !/hasScene/.test(s.createJs) || !/sceneCost/.test(s.createJs)) {
    errs.push('选 SKU 须 mapSkuForPicker + hasScene/sceneCost')
  }
  if (!/sceneCost:\s*k\.hasScene === true/.test(s.settle)) errs.push('quoteSkus 须把造景成本喂给引擎')
  // C9
  if (/wx\.showToast\s*\(|wx\.showModal\s*\(/.test(pageJs + s.shellJs)) errs.push('出货中心 / 重定向壳不得使用原生 toast/modal')
  if (/shipment-sku|shipment-ops/.test(s.supplier)) errs.push('供应商工作台不得挂接 shipment-sku / shipment-ops')
  // D10 原材料 / 包装
  const single = s.createJs.slice(s.createJs.indexOf('async confirmSingle('))
  if (!/line\.materialName\s*=/.test(single) || !/line\.packagingName\s*=/.test(single)) {
    errs.push('单条补录须可选带原材料 / 包装方式（line.material* / line.packaging*）')
  }
  if (!/data-target="single"/.test(s.opsWxml)) errs.push('单条补录须有原材料 / 包装选择入口（data-target="single"）')
  if (!/item\.matLine/.test(s.opsWxml) || !/matLine:\s*materialLine\(/.test(s.opsJs)) errs.push('详情明细须显示原材料 / 包装（matLine）')
  // D11 资料维护
  const libActions = (s.libraryJs.match(/action:\s*'([\w.]+)'/g) || []).map((m) => m.replace(/action:\s*'|'/g, ''))
  const allowed = ['priceBook.list', 'priceBook.create', 'priceBook.update', 'priceBook.removeIfUnused', 'meta']
  libActions.filter((a) => allowed.indexOf(a) === -1).forEach((a) => errs.push(`资料维护不得调用 ${a}（删除只能走 removeIfUnused）`))
  if (!libActions.includes('priceBook.update') || !libActions.includes('priceBook.create')) errs.push('资料维护须支持新增与编辑（priceBook.create / update）')
  if (!libActions.includes('priceBook.removeIfUnused')) errs.push('资料删除须走 priceBook.removeIfUnused（服务端引用检查）')
  if (!/moveLibRow/.test(s.libraryJs) || !/toggleLibStatus/.test(s.libraryJs)) errs.push('资料维护须支持排序（moveLibRow）与停用（toggleLibStatus）')
  // E12 店长只读
  const libStart = s.opsWxml.indexOf(`wx:if="{{activeTab === 'library'}}"`)
  if (libStart < 0) errs.push("资料页签块须为 wx:if=\"{{activeTab === 'library'}}\"（店长可见，不再要求 isSuper）")
  else ungatedWrites(s.opsWxml.slice(s.opsWxml.lastIndexOf('<', libStart))).forEach((t) => errs.push('资料页签写入口须在 isSuper 门下（店长只读）：' + t))
  for (const fn of WRITE_TAPS) {
    const at = s.libraryJs.search(new RegExp(`\\n\\s*(async )?${fn}\\(e?\\) \\{`))
    const head = at < 0 ? '' : s.libraryJs.slice(at, at + 260)
    if (fn !== 'deactivateBlocked' && !/if \(!this\.data\.isSuper\b/.test(head)) errs.push(`${fn} 须首行拦截非超管（if (!this.data.isSuper …) return）`)
  }
  // E13 排序参数
  if (!/action: 'searchPriceBook'[^}]*orderBy: 'sort'/.test(s.createJs)) errs.push("出货中心选择器 searchPriceBook 须传 orderBy: 'sort'")
  if (!/action: 'searchPriceBook'[^}]*orderBy: 'sort'/.test(s.editJs)) errs.push("shipment-edit 选择器 searchPriceBook 须传 orderBy: 'sort'")
  if (!/action: 'priceBook\.list'[^}]*orderBy: 'sort'/.test(s.libraryJs)) errs.push("资料列表 priceBook.list 须传 orderBy: 'sort'")
  if (!/'priceBook\.removeIfUnused':\s*1/.test(s.settle.slice(s.settle.indexOf('SUPER_ONLY_ACTIONS'), s.settle.indexOf('SUPER_ONLY_ACTIONS') + 600))) {
    errs.push('priceBook.removeIfUnused 须在 SUPER_ONLY_ACTIONS（仅超管可删）')
  }
  return errs
}

const WRITE_TAPS = ['openLibForm', 'toggleLibStatus', 'moveLibRow', 'askRemoveLib', 'confirmRemoveLib', 'deactivateBlocked']

/** 按标签栈求「写入口是否处于某个 wx:if 含 isSuper 的祖先（或自身）之下」；只扫到资料块闭合为止 */
function ungatedWrites(block) {
  const out = []
  const stack = []
  const re = /<(\/?)([\w-]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g
  let m
  while ((m = re.exec(block))) {
    const [tag, close, , attrs, selfClose] = m
    if (close) {
      stack.pop()
      if (!stack.length) break
      continue
    }
    const gated = (stack.length && stack[stack.length - 1]) || /wx:if="[^"]*isSuper/.test(attrs)
    const tap = (attrs.match(/(?:bind|catch)tap="(\w+)"/) || [])[1]
    if (tap && WRITE_TAPS.includes(tap) && !gated) out.push(tag.slice(0, 80))
    if (!selfClose) stack.push(gated)
  }
  return out
}

/* ---------- E14 云函数运行时（隔离 tmp 副本，mock wx-server-sdk / staffGuard；注入只改副本） ---------- */
const PRICE_ROWS = () => [
  { _id: 'm1', name: '大蓝闪蝶', grade: 'A1', isDefaultGrade: true, status: 'active', sort: 30, unitPrice: 60 },
  { _id: 'm2', name: '大蓝闪蝶', grade: 'A2', status: 'active', sort: 10, unitPrice: 45 },
  { _id: 'm3', name: '光明女神', grade: '默认', isDefaultGrade: true, status: 'active', sort: 5, unitPrice: 88 },
  { _id: 'm4', name: '枯叶蛱蝶', grade: '默认', isDefaultGrade: true, status: 'inactive', sort: 1, unitPrice: 20 },
  { _id: 'm5', name: '金斑喙凤蝶', grade: '默认', isDefaultGrade: true, status: 'active', sort: 20, unitPrice: 99 }
]
const SHIPMENTS = () => [
  { _id: 's1', items: [{ materialId: 'm1', materialName: '大蓝闪蝶', materialGrade: 'A1' }] },
  { _id: 's2', items: [{ materialName: '光明女神', materialGrade: '' }] },
  { _id: 's3', deleted: true, items: [{ materialId: '', materialName: '大蓝闪蝶', materialGrade: 'A2' }] },
  { _id: 's4', items: [{ materialId: 'mX', materialName: '金斑喙凤蝶', materialGrade: '' }] }
]
const SKUS = () => [{ _id: 'k1', deleted: true, materialId: 'm5', materialName: '金斑喙凤蝶' }]

const SDK_MOCK = `
const M = global.__SS_MOCK
function q(name, list) {
  let skip = 0, lim = 1e9
  const api = {
    where() { return api }, orderBy() { return api }, field() { return api },
    skip(n) { skip = n; return api }, limit(n) { lim = n; return api },
    get: async () => ({ data: list().slice(skip, skip + lim).map((d) => JSON.parse(JSON.stringify(d))) }),
    count: async () => ({ total: list().length })
  }
  return api
}
module.exports = {
  DYNAMIC_CURRENT_ENV: 'x', init() {},
  getWXContext: () => ({ OPENID: 'o-test' }),
  database: () => ({
    command: { neq: (v) => ({ neq: v }), in: (a) => ({ in: a }), or: (a) => ({ or: a }), eq: (v) => ({ eq: v }) },
    serverDate: () => new Date(0),
    collection(name) {
      const list = () => (M.db[name] || [])
      return Object.assign(q(name, list), {
        doc: (id) => ({
          get: async () => { const d = list().find((r) => r._id === id); if (!d) throw new Error('not found'); return { data: JSON.parse(JSON.stringify(d)) } },
          update: async ({ data }) => { M.updates.push({ name, id, data }); return { stats: { updated: 1 } } }
        }),
        add: async () => ({ _id: 'new' })
      })
    }
  })
}`
const GUARD_MOCK = `
const M = global.__SS_MOCK
module.exports = {
  ROLE_MANAGER: 'manager', STORED_ROLE_SUPER: 'super', SUPER_ADMIN_OPENIDS: [],
  hasRole: () => true,
  assertStaff: async (db, openid, opts) => (M.role === 'manager' && opts && opts.permission)
    ? { ok: false, msg: '仅超管', code: 'FORBIDDEN' }
    : { ok: true, actor: { openid, name: 't', role: M.role } }
}`

async function serverErrs(mutateFiles) {
  const errs = []
  const fnDir = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
  const tmp = mkdtempSync(join(tmpdir(), 'ss-guard-'))
  try {
    cpSync(fnDir, tmp, { recursive: true, filter: (p) => !/node_modules/.test(p) })
    writeFileSync(join(tmp, 'package.json'), '{"type":"commonjs"}')
    mkdirSync(join(tmp, 'node_modules/wx-server-sdk'), { recursive: true })
    writeFileSync(join(tmp, 'node_modules/wx-server-sdk/index.js'), SDK_MOCK)
    writeFileSync(join(tmp, 'staffGuard.js'), GUARD_MOCK)
    for (const [f, fn] of Object.entries(mutateFiles || {})) {
      const p = join(tmp, f)
      writeFileSync(p, fn(readFileSync(p, 'utf8')))
    }
    const M = (global.__SS_MOCK = { role: 'super', updates: [], db: {} })
    const reset = () => {
      M.role = 'super'
      M.updates = []
      M.db = { studio_material_prices: PRICE_ROWS(), ops_shipments: SHIPMENTS(), studio_shipment_skus: SKUS() }
    }
    reset()
    const req = createRequire(join(tmp, 'index.js'))
    const fn = req(join(tmp, 'index.js'))
    const call = (ev) => fn.main(ev, {})

    // 不传 orderBy：输出形状与顺序同旧版（默认项在前，无 sort 字段，停用不出）
    const legacy = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', limit: 30 })
    const lg = legacy.list || []
    const lgNames = lg.map((g) => g.name).join('/')
    if (!legacy.success || lgNames !== '大蓝闪蝶/光明女神/金斑喙凤蝶') errs.push(`不传 orderBy 时顺序须与旧版一致（现 ${lgNames}）`)
    if (JSON.stringify(lg).includes('"sort"')) errs.push('不传 orderBy 时输出不得新增 sort 字段（行为须完全不变）')
    if (lgNames.includes('枯叶蛱蝶')) errs.push('searchPriceBook 不得返回停用项')
    // 传 orderBy:'sort'
    const sorted = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', limit: 30, orderBy: 'sort' })
    const sg = sorted.list || []
    const sNames = sg.map((g) => g.name).join('/')
    if (sNames !== '光明女神/大蓝闪蝶/金斑喙凤蝶') errs.push(`orderBy:'sort' 须按资料排序（现 ${sNames}）`)
    const blue = sg.find((g) => g.name === '大蓝闪蝶')
    const opts = blue ? (blue.options || []).map((o) => o.option).join('/') : ''
    if (opts !== 'A2/A1') errs.push(`orderBy:'sort' 组内选项须按 sort（现 ${opts}）`)
    if (sNames.includes('枯叶蛱蝶')) errs.push("orderBy:'sort' 也不得返回停用项")

    // removeIfUnused：有引用必拒
    for (const [id, why, key] of [['m1', '按 id 引用', 'shipments'], ['m3', '按名称（默认等级）引用', 'shipments'], ['m2', '已删出货单按名称+等级引用', 'deletedShipments']]) {
      reset()
      const r = await call({ action: 'priceBook.removeIfUnused', kind: 'material', id })
      if (r.success || r.code !== 'IN_USE' || !r.refs || !(r.refs[key] > 0)) errs.push(`删除有引用必拒：${id}（${why}）须 IN_USE 且 refs.${key}>0（现 ${JSON.stringify({ success: r.success, code: r.code, refs: r.refs })}）`)
      if (M.updates.length) errs.push(`删除被拒时不得写库：${id}`)
    }
    // 无引用（id 指向别行的同名行 / 仅已删 SKU 引用）→ 软删
    for (const id of ['m5', 'm4']) {
      reset()
      const r = await call({ action: 'priceBook.removeIfUnused', kind: 'material', id })
      const u = M.updates.find((x) => x.id === id)
      if (!r.success || !u || u.data.deleted !== true) errs.push(`无引用须软删成功：${id}（现 ${JSON.stringify({ success: r.success, msg: r.msg })}）`)
    }
    // 店长不能删
    reset()
    M.role = 'manager'
    const mr = await call({ action: 'priceBook.removeIfUnused', kind: 'material', id: 'm5' })
    if (mr.success || M.updates.length) errs.push('店长调用 removeIfUnused 须被拒（仅超管）')
    // 店长可读
    const ml = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', orderBy: 'sort' })
    if (!ml.success) errs.push('店长须可读 searchPriceBook（资料只读 / 开单选择器）')
  } catch (e) {
    errs.push('云函数运行时测试异常：' + ((e && e.stack) || e))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    delete global.__SS_MOCK
  }
  return errs
}

const src = {}
for (const [k, rel] of Object.entries(FILES)) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) {
    console.error(TAG, '缺少', rel)
    process.exit(1)
  }
  src[k] = readFileSync(p, 'utf8')
}

if (selftest) {
  // 每条注入只改内存副本，不碰源文件；任何一条没被检出即失败
  const cases = [
    ['非超管可进 SKU', (s) => ({ ...s, createJs: s.createJs.replace("next === 'sku' && !this.data.isSuper ? 'paste'", "next === 'sku' && false ? 'paste'") }), /SKU 开单仅超管/],
    ['CTA 半宽回退', (s) => ({ ...s, skuWxss: s.skuWxss.replace(/(\.ss-cta\s*\{[^}]*?[\s;{])width:\s*100%\s*!important/, '$1width: auto') }), /ss-cta 须 width/],
    ['scroll-view 缺高度', (s) => ({ ...s, opsWxml: s.opsWxml.replace('scroll-y style="height: {{sheetBodyPx}}px;"', 'scroll-y') }), /scroll-view scroll-y 须内联/],
    ['写入后不切单据', (s) => ({ ...s, opsJs: s.opsJs.replace(/(revealAfterWrite\(opts\)[\s\S]*?)activeTab:\s*'list'/, "$1activeTab: 'create'") }), /activeTab list/],
    ['旧开单磁贴复活', (s) => ({ ...s, hubWxml: s.hubWxml + '\n<view><text>出货开单</text></view>' }), /不得再有独立/],
    ['重定向壳复活逻辑', (s) => ({ ...s, shellJs: s.shellJs + "\nwx.cloud.callFunction({ name: 'manageStoreShipment' })" }), /不得再调云函数/],
    ['资料暴露删除', (s) => ({ ...s, libraryJs: s.libraryJs + "\nconst x = { action: 'priceBook.remove' }" }), /priceBook\.remove/],
    ['单条丢原材料', (s) => ({ ...s, createJs: s.createJs.replace(/line\.materialName\s*=/g, 'line.matX =') }), /单条补录须可选带/],
    ['SKU 载荷带单价', (s) => ({ ...s, createJs: s.createJs.replace('const out = { skuId: l.skuId,', 'const out = { unitPrice: l.unitPrice, skuId: l.skuId,') }), /不得带单价/],
    ['staffAuth 漂移', (s) => ({ ...s, staffManager: s.staffManager + '\n// drift' }), /逐字一致/],
    ['原生 toast', (s) => ({ ...s, libraryJs: s.libraryJs + "\nwx.showToast({ title: 'x' })" }), /原生 toast/],
    ['资料页签对店长隐藏', (s) => ({ ...s, opsJs: s.opsJs.replace(", { key: 'library', label: '资料' })", ")\n    if (this.data.isSuper) tabs.push({ key: 'library', label: '资料' })") }), /须对店长可见/],
    ['店长看见删除', (s) => ({ ...s, opsWxml: s.opsWxml.replace(/<view class="sc-lib-actions" wx:if="\{\{isSuper\}\}"/, '<view class="sc-lib-actions"') }), /isSuper 门下/],
    ['店长看见新增', (s) => ({ ...s, opsWxml: s.opsWxml.replace(/ wx:if="\{\{isSuper\}\}"([^>]*bindtap="openLibForm")/, '$1') }), /isSuper 门下/],
    ['写方法不拦店长', (s) => ({ ...s, libraryJs: s.libraryJs.replace("if (!this.data.isSuper || !row || this.data.libBusy) return\n    const label", "if (!row || this.data.libBusy) return\n    const label") }), /confirmRemoveLib 须首行拦截/],
    ['选择器丢排序参数', (s) => ({ ...s, createJs: s.createJs.replace(", orderBy: 'sort' })", ' })') }), /出货中心选择器/],
    ['编辑页丢排序参数', (s) => ({ ...s, editJs: s.editJs.replace(", orderBy: 'sort' }", ' }') }), /shipment-edit 选择器/],
    ['删除绕过引用检查', (s) => ({ ...s, libraryJs: s.libraryJs.replace("'priceBook.removeIfUnused'", "'priceBook.remove'") }), /priceBook\.remove/],
    ['店长可删（服务端）', (s) => ({ ...s, settle: s.settle.replace("'priceBook.removeIfUnused': 1", "'priceBook.removeIfUnusedX': 1") }), /SUPER_ONLY_ACTIONS/]
  ]
  // 运行时注入：只改 tmp 副本里的云函数源码
  const serverCases = [
    ['引用检查失效', { 'priceBookRefs.js': (t) => t.replace(/function refMatcher\(book, row\) \{/, 'function refMatcher(book, row) {\n  return () => false') }, /删除有引用必拒/],
    ['按名称引用漏检', { 'priceBookRefs.js': (t) => t.replace(/function refMatcher\(book, row\) \{/, "function refMatcher(book, row) {\n  return (it) => !!it && it[REF_FIELDS[book.kind].id] === row._id") }, /按名称/],
    ['不传参也带 sort', { 'index.js': (t) => t.replace('if (bySort) opt.sort =', 'opt.sort =') }, /不得新增 sort 字段/],
    ['不传参也重排', { 'index.js': (t) => t.replace('if (bySort) orderGroupsBySort(groups)', 'orderGroupsBySort(groups)') }, /顺序须与旧版一致|不得新增 sort 字段/],
    ['传参不重排', { 'index.js': (t) => t.replace('if (bySort) orderGroupsBySort(groups)', '') }, /须按资料排序/],
    ['停用项进选择器', { 'index.js': (t) => t.replace(/if \(r\.status !== ['"]active['"]\) continue/, '') }, /不得返回停用项/],
    ['店长可删（运行时）', { 'index.js': (t) => t.replace("'priceBook.removeIfUnused': 1,", '').replace("'priceBook.removeIfUnused': 1", '') }, /店长调用 removeIfUnused 须被拒/]
  ]
  const base = collect(src).concat(await serverErrs())
  if (base.length) {
    base.forEach((e) => console.error(TAG, '基线不绿，selftest 无意义：', e))
    process.exit(1)
  }
  let bad = 0
  for (const [name, mutate, expect] of cases) {
    const mutated = mutate(src)
    const changed = Object.keys(src).some((k) => mutated[k] !== src[k])
    const errs = collect(mutated)
    if (!changed || !errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」${changed ? '未被检出' : '注入未生效（锚点失配）'}`)
      bad++
    }
  }
  for (const [name, files, expect] of serverCases) {
    const errs = await serverErrs(files)
    if (!errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」未被检出`, errs.slice(0, 2))
      bad++
    }
  }
  if (bad) process.exit(1)
  console.log(TAG, `selftest ok（${cases.length + serverCases.length} 条注入全部检出）`)
  process.exit(0)
}

const errs = collect(src).concat(await serverErrs())
if (errs.length) {
  errs.forEach((e) => console.error(TAG, e))
  process.exit(1)
}
console.log(TAG, 'pass')
