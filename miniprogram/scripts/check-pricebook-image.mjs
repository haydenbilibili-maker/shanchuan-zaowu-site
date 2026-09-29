#!/usr/bin/env node
/**
 * 出货中心「资料」图片守卫（settlement 域）—— 原材料 / 包装方式可上传 1 张图
 *
 * 钉死：
 *  A 云函数 manageStudioSettlement（隔离 tmp 副本 + mock，真跑 main）
 *    1) priceBook.update / create 带 image=cloud://… → 原样落库
 *    2) image 不是 cloud:// fileID（https / 相对路径）→ 拒绝且零写入
 *    3) 入参**不带** image → 写库数据里**没有** image 键（ERP / 批量导入保存不会冲掉小程序传的图）
 *    4) image='' → 落库 ''（删除图片）
 *    5) priceBook.list 出参带 image；searchPriceBook 有图的组带 image，无图行输出**不出现** image 键
 *    6) 店长带 image 调 update → 被拒、零写入（写权限不变）
 *  B 页面（subpackages/extra/shipment-ops）
 *    7) toPayload：行上没有 image 键就不送（旧版云函数 mapRow 无 image 时停用/排序不会清图）
 *    8) 上传：wx.chooseMedia(count 1, image) + 压缩 + wx.cloud.uploadFile 到 studio-pricebook/；显示走 utils/imageUrl
 *    9) 列表卡：有图显示缩略图且点开大图（previewLibImage），无图显示占位；表单有上传 / 删除
 *   10) chooseLibImage 首行拦非超管；页内不新增 wx.showModal
 *   11) 页面可见文案不出现集合名 / 字段名（ops_shipments、settleStatus、studio_*）
 *
 * 用法：node miniprogram/scripts/check-pricebook-image.mjs [--selftest]
 */
import { readFileSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TAG = '[check:pricebook-image]'
const OPS = 'miniprogram/subpackages/extra/shipment-ops'
const FILES = {
  libraryJs: `${OPS}/parts/library.js`,
  createJs: `${OPS}/parts/create.js`,
  opsWxml: `${OPS}/index.wxml`
}
const FN_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
const IMG = 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/studio-pricebook/material/1_a.jpg'

/* ---------- B 页面静态 + toPayload 行为 ---------- */
function loadToPayload(libraryJs) {
  const start = libraryJs.indexOf('const KIND_META')
  const fnAt = libraryJs.indexOf('function toPayload(')
  const end = fnAt < 0 ? -1 : libraryJs.indexOf('\n}\n', fnAt)
  if (start < 0 || fnAt < 0 || end < 0) return null
  try {
    return new Function(libraryJs.slice(start, end + 2) + '\nreturn toPayload')()
  } catch (e) {
    return null
  }
}

function collect(s) {
  const errs = []
  const toPayload = loadToPayload(s.libraryJs)
  if (!toPayload) errs.push('library.js 找不到可执行的 toPayload')
  else {
    const row = { name: '大蓝闪蝶', option: 'A1', unitPrice: 60, isDefaultOption: true }
    if ('image' in toPayload('material', row)) errs.push('toPayload：行上没有 image 键时不得送 image（否则停用 / 排序会清掉图）')
    if (toPayload('material', Object.assign({ image: IMG }, row)).image !== IMG) errs.push('toPayload：行上有图时须原样回送 image')
    if (toPayload('material', Object.assign({ image: IMG }, row), { image: '' }).image !== '') errs.push("toPayload：表单删图（image: ''）须送空串")
  }
  const lib = s.libraryJs
  if (!/wx\.chooseMedia\(\{[\s\S]{0,120}count:\s*1[\s\S]{0,80}mediaType:\s*\['image'\]/.test(lib)) errs.push('上传须用 wx.chooseMedia({ count: 1, mediaType: [\'image\'] })')
  if (!/wx\.compressImage\(/.test(lib)) errs.push('上传前须压缩（wx.compressImage）')
  if (!/LIB_IMAGE_DIR = 'studio-pricebook'/.test(lib) || !/wx\.cloud\.uploadFile\(\{\s*cloudPath:\s*`\$\{LIB_IMAGE_DIR\}\/\$\{kind\}\//.test(lib)) {
    errs.push('资料图须传到云存储 studio-pricebook/<kind>/ 目录')
  }
  if (!/require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/imageUrl'\)/.test(lib)) errs.push('资料图显示须走现有 utils/imageUrl')
  const head = (fn) => {
    const at = lib.search(new RegExp(`\\n\\s*(async )?${fn}\\(e?\\) \\{`))
    return at < 0 ? '' : lib.slice(at, at + 200)
  }
  if (!/^\s*\n?\s*chooseLibImage\(\) \{\s*const f = this\.data\.libForm\s*if \(!this\.data\.isSuper/.test(head('chooseLibImage'))) errs.push('chooseLibImage 须首行拦非超管')
  if (/wx\.showModal\(/.test(lib) || /wx\.showModal\(/.test(s.createJs)) errs.push('出货中心不得新增 wx.showModal（用页内弹层）')

  const w = s.opsWxml
  if (!/<image class="sc-lib-thumb" wx:if="\{\{item\.thumb\}\}"[^>]*bindtap="previewLibImage"/.test(w)) errs.push('资料列表须有缩略图且点开大图（previewLibImage）')
  if (!/<view class="sc-lib-thumb is-empty" wx:else>/.test(w)) errs.push('资料列表无图时须显示占位')
  if (!/bindtap="chooseLibImage"/.test(w) || !/bindtap="removeLibImage"/.test(w)) errs.push('资料表单须能上传 / 删除图片')
  if (!/thumb: g\.image \? railUrl\(g\.image\)/.test(s.createJs) || !/class="ss-group-thumb"/.test(w)) errs.push('开单选择器须显示资料缩略图')
  const visible = w.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')
  const tech = visible.match(/ops_shipments|settleStatus|studio_\w+|priceBook/g)
  if (tech) errs.push(`页面可见文案不得出现集合名 / 字段名：${[...new Set(tech)].join('、')}`)
  return errs
}

/* ---------- A 云函数运行时（隔离副本；注入只改副本） ---------- */
const SDK_MOCK = `
const M = global.__PBI_MOCK
function q(list) {
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
      return Object.assign(q(list), {
        doc: (id) => ({
          get: async () => { const d = list().find((r) => r._id === id); if (!d) throw new Error('not found'); return { data: JSON.parse(JSON.stringify(d)) } },
          update: async ({ data }) => { M.writes.push({ op: 'update', name, id, data }); return { stats: { updated: 1 } } }
        }),
        add: async ({ data }) => { M.writes.push({ op: 'add', name, data }); return { _id: 'new' } }
      })
    }
  })
}`
const GUARD_MOCK = `
const M = global.__PBI_MOCK
module.exports = {
  ROLE_MANAGER: 'manager', STORED_ROLE_SUPER: 'super', SUPER_ADMIN_OPENIDS: [],
  hasRole: () => true,
  assertStaff: async (db, openid, opts) => (M.role === 'manager' && opts && opts.permission)
    ? { ok: false, msg: '仅超管', code: 'FORBIDDEN' }
    : { ok: true, actor: { openid, name: 't', role: M.role } }
}`
const ROWS = () => [
  { _id: 'm1', name: '大蓝闪蝶', normName: '大蓝闪蝶', grade: 'A1', isDefaultGrade: true, status: 'active', sort: 10, unitPrice: 60, image: IMG },
  { _id: 'm2', name: '光明女神', normName: '光明女神', grade: '默认', isDefaultGrade: true, status: 'active', sort: 20, unitPrice: 88 }
]
const ITEM = (extra) => Object.assign({ name: '光明女神', grade: '默认', isDefaultGrade: true, unitPrice: 88, status: 'active', sort: 20 }, extra)

async function serverErrs(mutate) {
  const errs = []
  const tmp = mkdtempSync(join(tmpdir(), 'pbi-guard-'))
  try {
    cpSync(FN_DIR, tmp, { recursive: true, filter: (p) => !/node_modules/.test(p) })
    writeFileSync(join(tmp, 'package.json'), '{"type":"commonjs"}')
    mkdirSync(join(tmp, 'node_modules/wx-server-sdk'), { recursive: true })
    writeFileSync(join(tmp, 'node_modules/wx-server-sdk/index.js'), SDK_MOCK)
    writeFileSync(join(tmp, 'staffGuard.js'), GUARD_MOCK)
    for (const [f, fn] of Object.entries(mutate || {})) {
      const p = join(tmp, f)
      writeFileSync(p, fn(readFileSync(p, 'utf8')))
    }
    const M = (global.__PBI_MOCK = {})
    const reset = (role) => Object.assign(M, { role: role || 'super', writes: [], db: { studio_material_prices: ROWS() } })
    const fn = createRequire(join(tmp, 'index.js'))(join(tmp, 'index.js'))
    const call = (ev) => fn.main(ev, {})
    const upd = () => M.writes.find((x) => x.op === 'update')

    reset()
    let r = await call({ action: 'priceBook.update', kind: 'material', id: 'm2', item: ITEM({ image: IMG }) })
    if (!r.success || !upd() || upd().data.image !== IMG) errs.push(`update 带 cloud:// 图须原样落库（现 ${JSON.stringify({ success: r.success, msg: r.msg, image: upd() && upd().data.image })}）`)
    for (const bad of ['https://evil.example.com/a.jpg', 'studio-pricebook/a.jpg']) {
      reset()
      r = await call({ action: 'priceBook.update', kind: 'material', id: 'm2', item: ITEM({ image: bad }) })
      if (r.success || M.writes.length) errs.push(`image 非 cloud:// fileID 须拒绝且零写入：${bad}`)
    }
    reset()
    r = await call({ action: 'priceBook.update', kind: 'material', id: 'm2', item: ITEM() })
    if (!r.success || !upd() || 'image' in upd().data) errs.push('入参不带 image 时写库数据不得出现 image 键（ERP 保存会冲掉图）')
    reset()
    r = await call({ action: 'priceBook.update', kind: 'material', id: 'm1', item: ITEM({ name: '大蓝闪蝶', grade: 'A1', unitPrice: 60, image: '' }) })
    if (!r.success || !upd() || upd().data.image !== '') errs.push("image='' 须落库空串（删除图片）")
    reset()
    r = await call({ action: 'priceBook.create', kind: 'material', item: ITEM({ name: '金斑喙凤蝶', image: IMG }) })
    const add = M.writes.find((x) => x.op === 'add')
    if (!r.success || !add || add.data.image !== IMG) errs.push('create 带 cloud:// 图须原样落库')

    reset()
    r = await call({ action: 'priceBook.list', kind: 'material', status: '', limit: 200, orderBy: 'sort' })
    const byId = {}
    ;(r.list || []).forEach((x) => { byId[x._id] = x })
    if (!byId.m1 || byId.m1.image !== IMG || !byId.m2 || byId.m2.image !== '') errs.push('priceBook.list 须带出 image（无图为空串）')
    for (const orderBy of ['sort', '']) {
      r = await call({ action: 'searchPriceBook', kind: 'material', keyword: '', limit: 30, orderBy })
      const g1 = (r.list || []).find((g) => g.name === '大蓝闪蝶')
      const g2 = (r.list || []).find((g) => g.name === '光明女神')
      if (!g1 || g1.image !== IMG) errs.push(`searchPriceBook 有图的组须带 image（orderBy='${orderBy}'）`)
      if (!g2 || JSON.stringify(g2).includes('"image"')) errs.push(`searchPriceBook 无图行输出不得出现 image 键（旧输出须逐字不变，orderBy='${orderBy}'）`)
    }

    reset('manager')
    r = await call({ action: 'priceBook.update', kind: 'material', id: 'm2', item: ITEM({ image: IMG }) })
    if (r.success || M.writes.length) errs.push('店长带 image 调 update 须被拒且零写入（写权限不变）')
  } catch (e) {
    errs.push('云函数运行时测试异常：' + ((e && e.stack) || e))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    delete global.__PBI_MOCK
  }
  return errs
}

const src = {}
for (const [k, rel] of Object.entries(FILES)) src[k] = readFileSync(resolve(ROOT, rel), 'utf8')

if (process.argv.includes('--selftest')) {
  const cases = [
    ['toPayload 总送 image', (s) => ({ ...s, libraryJs: s.libraryJs.replace("if (src.image !== undefined) out.image = String(src.image || '')", "out.image = String(src.image || '')") }), /没有 image 键时不得送/],
    ['toPayload 丢 image', (s) => ({ ...s, libraryJs: s.libraryJs.replace("if (src.image !== undefined) out.image = String(src.image || '')", '') }), /须原样回送/],
    ['不压缩', (s) => ({ ...s, libraryJs: s.libraryJs.replace('wx.compressImage(opts)', 'resolve(src)') }), /须压缩/],
    ['换存储目录', (s) => ({ ...s, libraryJs: s.libraryJs.replace("LIB_IMAGE_DIR = 'studio-pricebook'", "LIB_IMAGE_DIR = 'tmp'") }), /studio-pricebook/],
    ['上传不拦店长', (s) => ({ ...s, libraryJs: s.libraryJs.replace('if (!this.data.isSuper || f.uploading || f.saving) return\n    wx.chooseMedia', 'if (f.uploading || f.saving) return\n    wx.chooseMedia') }), /首行拦非超管/],
    ['原生弹窗', (s) => ({ ...s, libraryJs: s.libraryJs + "\nwx.showModal({ title: 'x' })" }), /showModal/],
    ['无图不占位', (s) => ({ ...s, opsWxml: s.opsWxml.replace('<view class="sc-lib-thumb is-empty" wx:else>', '<view class="sc-lib-thumb is-empty" wx:if="{{false}}">') }), /占位/],
    ['缩略图不能点开', (s) => ({ ...s, opsWxml: s.opsWxml.replace(/(<image class="sc-lib-thumb"[^>]*)bindtap="previewLibImage"/, '$1') }), /previewLibImage/],
    ['技术词回到页头', (s) => ({ ...s, opsWxml: s.opsWxml.replace('结算在「工作室账单」里处理。', '账本 ops_shipments。') }), /集合名/]
  ]
  const serverCases = [
    ['不校验 fileID', { 'settlementDefaults.js': (t) => t.replace('if (image && !(IMAGE_FILE_ID_RE.test(image)', 'if (false && !(IMAGE_FILE_ID_RE.test(image)') }, /非 cloud:\/\/ fileID/],
    ['不带也写 image', { 'settlementDefaults.js': (t) => t.replace('if (src.image !== undefined) {', 'if (true) {') }, /不得出现 image 键/],
    ['list 丢 image', { 'settlementDefaults.js': (t) => t.replace("image: typeof raw.image === 'string' ? raw.image : '',", '') }, /priceBook\.list 须带出 image/],
    ['选择器无图也带键', { 'index.js': (t) => t.replace("if (typeof r.image === 'string' && r.image) opt.image = r.image", "opt.image = r.image || ''") }, /无图行输出不得出现 image 键/],
    ['店长可写', { 'index.js': (t) => t.replace("'priceBook.update': 1,", '') }, /店长带 image/]
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
    if (!changed || !collect(mutated).some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」${changed ? '未被检出' : '注入未生效（锚点失配）'}`)
      bad++
    }
  }
  for (const [name, files, expect] of serverCases) {
    const f = Object.keys(files)[0]
    const orig = readFileSync(join(FN_DIR, f), 'utf8')
    if (files[f](orig) === orig) {
      console.error(TAG, `selftest 失败：「${name}」注入未生效（锚点失配）`)
      bad++
      continue
    }
    const errs = await serverErrs(files)
    if (!errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」未被检出`, errs.slice(0, 2))
      bad++
    }
  }
  if (bad) process.exit(1)
  console.log(TAG, `selftest ok（${cases.length + serverCases.length} 条注入全部检出）`)
  process.exit()
}

const errs = collect(src).concat(await serverErrs())
if (errs.length) {
  errs.forEach((e) => console.error(TAG, e))
  process.exitCode = 1
} else {
  console.log(TAG, 'ok（云函数 image 字段 6 项 + 页面 5 项）')
}
process.exit()
