#!/usr/bin/env node
/**
 * 超管「供应商」改版守卫（manager 域；2026-09-30 产品负责人点名「图片上传 + 交互 / 视觉大改版」）
 *
 * 钉住这次改版里容易静默失效的事：
 *   ① 价目图：云函数只收 cloud:// fileID；入参不带 image 不动库里的图（43 条里 37 条是官网相对路径、6 条多图）；
 *      换封面保留图集其余图；非法图零写入；
 *      多图（同日产品负责人拍板）：入参带 images 才写、新图只收 cloud://、库里原有地址可保留、≤ 9 张、image = images[0]
 *      （与 ERP normalizeImageFields / 官网 priceListCloud 同约定）；新建只收 cloud://；
 *   ② 伙伴资料图：adminSavePartnerProfile 只写 b2bProfile 里带了的键（换门头不冲资质照）、只收 cloud://、资质照 ≤ 3；
 *      列表只回 cloud://；伙伴自己的接口（myAccess）不带资质照；资质照页面直接用 cloud:// 显示、不转公开链接；
 *   ③ 页面：编辑页没动图不送 image / images、动过送整组 images；载入封面排首位；设为封面 / 左右移 / 删除 / 上传补剩余张数；上传走 chooseMedia → 宽 > 1280 压缩 → uploadFile；
 *      b2bdesk 无原生弹框；可见文案无集合名 / 字段名 / 函数名；关键交互（缩略图、更多弹层、悬浮新建、骨架、筛选收纳、上传）都在。
 *
 * 运行时部分用内存假库 + 假 wx-server-sdk 真跑云函数真源；页面用最小 Page / wx 桩真跑页面 JS。
 * 用法：node miniprogram/scripts/check-supplier-desk-images.mjs [--selftest]
 *   --selftest：注入只改内存里的源码副本（不写盘），每个注入都必须被检出。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const FN = 'miniprogram/cloudfunctions/manageSupplierDesk'
const CORE = `${FN}/deskCore.js`
const INDEX = `${FN}/index.js`
const PKG = 'miniprogram/subpackages/b2bdesk'
const CENTER_JS = `${PKG}/center/index.js`
const CENTER_WXML = `${PKG}/center/index.wxml`
const EDIT_JS = `${PKG}/price-edit/index.js`
const EDIT_WXML = `${PKG}/price-edit/index.wxml`
const PARTNER_JS = `${PKG}/partner/index.js`
const PARTNER_WXML = `${PKG}/partner/index.wxml`
const IMG_JS = `${PKG}/utils/deskImage.js`
const API_JS = `${PKG}/utils/deskApi.js`

let overrides = new Map()
const read = (rel) => (overrides.has(rel) ? overrides.get(rel) : readFileSync(join(ROOT, rel), 'utf8'))

function loadCjs(rel, { stubs = {}, globals = {} } = {}, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  const req = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id]
    const base = resolve(ROOT, dirname(rel), id)
    for (const c of [base, `${base}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(relative(ROOT, c), { stubs, globals }, cache)
    }
    throw new Error(`require 解析失败：${id}`)
  }
  const names = Object.keys(globals)
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', 'console', ...names, read(rel))(
    mod, mod.exports, req, { env: {} }, { log() {}, warn() {}, error() {}, info() {} }, ...names.map((n) => globals[n])
  )
  return mod.exports
}

/* ── 内存假库（CloudBase 语义：对象值按字段合并，_.set 整体替换） ── */
function makeDb(seed) {
  const store = {}
  const writes = []
  Object.keys(seed).forEach((c) => { store[c] = new Map(seed[c].map((d) => [d._id, JSON.parse(JSON.stringify(d))])) })
  const colMap = (n) => store[n] || (store[n] = new Map())
  const command = { set: (v) => ({ __set: v }), in: (v) => ({ __in: v }) }
  const match = (doc, where) => Object.keys(where || {}).every((k) => {
    const want = where[k]
    const val = k.split('.').reduce((a, p) => (a == null ? undefined : Array.isArray(a) ? a.map((x) => x && x[p]) : a[p]), doc)
    const eq = (w) => (Array.isArray(val) ? val.includes(w) : val === w)
    return want && want.__in ? want.__in.some(eq) : eq(want)
  })
  const apply = (doc, data) => Object.keys(data).forEach((k) => {
    const v = data[k]
    if (v && v.__set !== undefined) doc[k] = JSON.parse(JSON.stringify(v.__set))
    else if (v && typeof v === 'object' && !Array.isArray(v) && !v.__serverDate) {
      doc[k] = doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k]) ? { ...doc[k], ...v } : { ...v }
    } else doc[k] = v
  })
  const query = (name, where = null, skip = 0, lim = 100) => ({
    where: (w) => query(name, w, skip, lim),
    skip: (n) => query(name, where, n, lim),
    limit: (n) => query(name, where, skip, n),
    orderBy: () => query(name, where, skip, lim),
    async get() { return { data: JSON.parse(JSON.stringify([...colMap(name).values()].filter((d) => match(d, where)).slice(skip, skip + lim))) } },
    async count() { return { total: [...colMap(name).values()].filter((d) => match(d, where)).length } },
    doc: (id) => ({
      async get() {
        const d = colMap(name).get(id)
        if (!d) throw new Error('document not found')
        return { data: JSON.parse(JSON.stringify(d)) }
      },
      async update({ data }) {
        writes.push({ col: name, op: 'update', id })
        const d = colMap(name).get(id)
        if (!d) throw new Error('document not found')
        apply(d, data)
        return { stats: { updated: 1 } }
      },
      async remove() { writes.push({ col: name, op: 'remove', id }); colMap(name).delete(id); return {} }
    }),
    async add({ data }) {
      const id = `new_${colMap(name).size + 1}`
      writes.push({ col: name, op: 'add', id })
      colMap(name).set(id, { ...data, _id: id })
      return { _id: id }
    }
  })
  return { db: { collection: (n) => query(n), command, serverDate: () => ({ __serverDate: true }) }, store, writes }
}

const SUPER = 'oa22s5ZcMY7xkQDlNW8X8jaYy46M'
const BUYER = 'oBUYERaaaaaaaaaaaaaaaaaaaa01'
const CF = (s) => `cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1/${s}.jpg`
const seed = () => ({
  staff_members: [
    { _id: 'st_buyer', openid: BUYER, name: '令狐采购', roles: ['buyer'], status: 'active', b2bProfile: { logo: CF('logo0'), licenses: [CF('lic1'), CF('lic2')] } },
    { _id: 'st_sup', openid: 'oSUPPLIERaaaaaaaaaaaaaaaaa3', name: '云南供货', roles: ['supplier'], status: 'active', b2bProfile: { logo: 'https://evil.example/x.jpg', licenses: ['/images/x.jpg', CF('ok')] } }
  ],
  purchase_orders: [],
  fulfillment_shipments: [],
  price_list_items: [
    { _id: 'p1', skuId: 'BF-001', name: '光明女神闪蝶', species: '光明女神闪蝶', packaging: '玻璃罩', price: 90, status: 'active', sort: 1, image: '/images/price-list/a.jpg', images: ['/images/price-list/a.jpg', '/images/price-list/b.jpg'] }
  ],
  users: []
})

function bootFn() {
  const fake = makeDb(seed())
  let openid = ''
  const sdk = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => fake.db, getWXContext: () => ({ OPENID: openid }) }
  const mod = loadCjs(INDEX, { stubs: { 'wx-server-sdk': sdk } })
  return { ...fake, call: (who, ev) => { openid = who; return mod.main(ev) } }
}

const BASE_ITEM = { skuId: 'BF-001', name: '光明女神闪蝶', species: '光明女神闪蝶', packaging: '玻璃罩', price: 90, status: 'active' }
const priceWrites = (env) => env.writes.filter((w) => w.col === 'price_list_items').length

/* ── 页面桩 ── */
function wxStub(calls, item) {
  let n = 0
  return {
    cloud: {
      callFunction: ({ data }) => { calls.push(data); return Promise.resolve({ result: { success: true, item: item || null, options: { prep: [], packaging: [], bio: [] }, list: [], catalog: [] } }) },
      uploadFile: () => Promise.resolve({ fileID: CF(`up${++n}`) })
    },
    chooseMedia: ({ count, success }) => { calls.push({ chooseCount: count }); success({ tempFiles: Array.from({ length: count }, (_, i) => ({ tempFilePath: `/tmp/p${i}.jpg` })) }) },
    getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
    getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2 }),
    setNavigationBarTitle() {}, navigateTo() {}, navigateBack() {}, stopPullDownRefresh() {}, previewImage() {}, setClipboardData() {}
  }
}
function loadPage(rel, calls, item) {
  let cfg = null
  loadCjs(rel, { globals: { Page: (c) => { cfg = c }, wx: wxStub(calls, item), getCurrentPages: () => [], setTimeout: () => 0, clearTimeout() {} } })
  const inst = Object.create(cfg)
  inst.data = JSON.parse(JSON.stringify(cfg.data))
  inst.setData = (patch) => Object.keys(patch).forEach((k) => {
    const ks = k.replace(/\[(\d+)\]/g, '.$1').split('.')
    let o = inst.data
    ks.slice(0, -1).forEach((p) => { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p] })
    o[ks[ks.length - 1]] = patch[k]
  })
  return inst
}

/** wxml 里用户看得到的字：文本节点 + placeholder（去掉 {{ }} 绑定与注释） */
function visibleText(wxml) {
  // 先把绑定换成其中的字符串字面量（绑定里的 `>` 比较符会被误当成标签结束）
  const src = wxml.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, (b) => (b.match(/'[^']*'/g) || []).join(' ').replace(/[<>]/g, ' '))
  const texts = [...src.matchAll(/>([^<]+)</g)].map((m) => m[1])
  const ph = [...src.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1])
  return texts.concat(ph).join('\n')
}
const TECH_WORDS = /skuId|openid|cloud:\/\/|服务端|云函数|manageSupplierDesk|purchase_orders|price_list_items|staff_members|fulfillment_shipments|b2bProfile|fileID|集合|CR-1|蓝图/

function walk(rel) {
  const abs = join(ROOT, rel)
  return readdirSync(abs).flatMap((n) => {
    const r = `${rel}/${n}`
    return statSync(join(ROOT, r)).isDirectory() ? walk(r) : [r]
  })
}

async function runChecks() {
  const failures = []
  let passed = 0
  const t = async (name, fn) => {
    let ok = false
    let err = ''
    try { ok = (await fn()) === true } catch (e) { err = e.message }
    if (ok) passed += 1
    else failures.push(err ? `${name}（${err}）` : name)
  }
  const core = loadCjs(CORE)

  await t('价目图只收 cloud://：官网相对路径 / https / 空白串拒收，cloud:// 收下', () => {
    const bad = ['/images/price-list/a.jpg', 'https://evil.example/a.jpg', 'cloud://', ' cloud://a b']
      .every((image) => { const v = core.validatePriceItem({ ...BASE_ITEM, image }); return !v.ok && v.errors.some((e) => e.field === 'image') })
    const good = core.validatePriceItem({ ...BASE_ITEM, image: CF('a') })
    const clear = core.validatePriceItem({ ...BASE_ITEM, image: '' })
    return bad && good.ok && good.data.image === CF('a') && clear.ok && clear.data.image === ''
  })
  await t('价目：不带 image 不覆盖（校验结果无 image 键）', () => {
    const v = core.validatePriceItem({ ...BASE_ITEM })
    return v.ok && !('image' in v.data)
  })
  await t('价目：不带 image 不覆盖（真跑保存：库里官网图与多图原样）', async () => {
    const env = bootFn()
    const r = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, name: '改个名' } })
    const d = env.store.price_list_items.get('p1')
    return r.success && d.name === '改个名' && d.image === '/images/price-list/a.jpg' &&
      JSON.stringify(d.images) === JSON.stringify(['/images/price-list/a.jpg', '/images/price-list/b.jpg'])
  })
  await t('价目：换封面保留图集其余图（ERP 维护的多图不被冲掉）', async () => {
    const env = bootFn()
    const r = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, image: CF('new') } })
    const d = env.store.price_list_items.get('p1')
    return r.success && d.image === CF('new') && JSON.stringify(d.images) === JSON.stringify([CF('new'), '/images/price-list/b.jpg'])
  })
  await t('价目：非法图片零写入且回字段级错误', async () => {
    const env = bootFn()
    const r = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, image: 'https://evil.example/a.jpg' } })
    return r.success === false && (r.errors || []).some((e) => e.field === 'image') && priceWrites(env) === 0
  })
  await t('伙伴资料图：只写带了的键（换门头不冲资质照）', async () => {
    const env = bootFn()
    const r = await env.call(SUPER, { action: 'adminSavePartnerProfile', staffId: 'st_buyer', logo: CF('logo1') })
    const p = env.store.staff_members.get('st_buyer').b2bProfile
    return r.success && p.logo === CF('logo1') && JSON.stringify(p.licenses) === JSON.stringify([CF('lic1'), CF('lic2')])
  })
  await t('伙伴资料图：资质照只收 cloud://、最多 3 张，违规零写入', async () => {
    const env = bootFn()
    const a = await env.call(SUPER, { action: 'adminSavePartnerProfile', staffId: 'st_buyer', licenses: ['https://evil.example/l.jpg'] })
    const b = await env.call(SUPER, { action: 'adminSavePartnerProfile', staffId: 'st_buyer', licenses: [CF('1'), CF('2'), CF('3'), CF('4')] })
    const c = await env.call(SUPER, { action: 'adminSavePartnerProfile', staffId: 'st_buyer', logo: '/images/logo.png' })
    return a.success === false && b.success === false && c.success === false && env.writes.length === 0
  })
  await t('伙伴资料图：非超管调用 → FORBIDDEN 且零写入', async () => {
    const env = bootFn()
    const r = await env.call(BUYER, { action: 'adminSavePartnerProfile', staffId: 'st_buyer', logo: CF('x') })
    return r.success === false && r.code === 'FORBIDDEN' && env.writes.length === 0
  })
  await t('伙伴列表 profile 只回 cloud://；伙伴自己的接口不带资质照', async () => {
    const env = bootFn()
    const r = await env.call(SUPER, { action: 'adminListPartners' })
    const sup = (r.list || []).find((p) => p.staffId === 'st_sup')
    const buy = (r.list || []).find((p) => p.staffId === 'st_buyer')
    const mine = await env.call(BUYER, { action: 'myAccess' })
    return !!sup && sup.profile.logo === '' && JSON.stringify(sup.profile.licenses) === JSON.stringify([CF('ok')]) &&
      buy.profile.licenses.length === 2 && mine.success && !/lic1|licenses|b2bProfile/.test(JSON.stringify(mine))
  })
  await t('编辑页：没动图不送 image / images；动过才送整组 images（不送单张 image）', async () => {
    const calls = []
    const page = loadPage(EDIT_JS, calls, { _id: 'p1', ...BASE_ITEM, image: '/images/price-list/a.jpg', images: ['/images/price-list/a.jpg', '/images/price-list/b.jpg'] })
    page.data.id = 'p1'
    await page.load()
    page.save()
    const first = calls.find((c) => c.action === 'adminSavePriceItem')
    page.data.saving = false
    page.data.picked = 1
    page.removePicked()
    page.save()
    const second = calls.filter((c) => c.action === 'adminSavePriceItem')[1]
    return !!first && !('image' in first.data) && !('images' in first.data) &&
      !!second && !('image' in second.data) && JSON.stringify(second.data.images) === JSON.stringify(['/images/price-list/a.jpg'])
  })
  await t('编辑页载入：封面排首位、去重（同 ERP normalizeImageFields），只有单张 image 时退回 [image]', async () => {
    const page = loadPage(EDIT_JS, [], { _id: 'p1', ...BASE_ITEM, image: '/a.jpg', images: ['/b.jpg', '/a.jpg', '/b.jpg'] })
    page.data.id = 'p1'
    await page.load()
    const page2 = loadPage(EDIT_JS, [], { _id: 'p2', ...BASE_ITEM, image: CF('only') })
    page2.data.id = 'p2'
    await page2.load()
    const raws = (p) => JSON.stringify(p.data.gallery.map((g) => g.raw))
    return raws(page) === JSON.stringify(['/a.jpg', '/b.jpg']) && raws(page2) === JSON.stringify([CF('only')]) && page.data.galleryDirty === false
  })
  await t('编辑页多图：设为封面挪到首位、左右移动、删除、上传只补剩余张数且满 9 张不再选', async () => {
    const calls = []
    const page = loadPage(EDIT_JS, calls)
    const tile = (raw) => ({ raw, thumb: raw })
    page.data.gallery = ['A', 'B', 'C'].map(tile)
    page.data.picked = 2
    page.setCover()
    const afterCover = page.data.gallery.map((g) => g.raw).join('')
    page.movePicked({ currentTarget: { dataset: { step: '1' } } })
    const afterRight = page.data.gallery.map((g) => g.raw).join('') + page.data.picked
    page.movePicked({ currentTarget: { dataset: { step: '-1' } } })
    page.movePicked({ currentTarget: { dataset: { step: '-1' } } })
    const clamped = page.data.gallery.map((g) => g.raw).join('') + page.data.picked
    page.data.gallery = 'ABCDEFG'.split('').map(tile)
    await page.addImages()
    const seven = calls.filter((c) => c.chooseCount).map((c) => c.chooseCount)
    const grown = page.data.gallery.length
    await page.addImages()
    const asked = calls.filter((c) => c.chooseCount).length
    return afterCover === 'CAB' && afterRight === 'ACB1' && clamped === 'CAB0' &&
      JSON.stringify(seven) === '[2]' && grown === 9 && asked === 1 && page.data.galleryDirty === true
  })
  await t('多图只收 cloud:// 新图：原有官网相对路径 / https 可保留，新 https 拒收；去重；最多 9 张；image = images[0]', () => {
    const existing = ['/images/price-list/a.jpg', 'https://shanhaizaowu.com/images/x.jpg']
    const keep = core.validateGallery([CF('n'), existing[1], existing[0], CF('n')], existing)
    const badNew = core.validateGallery(['https://evil.example/a.jpg'], existing)
    const badRel = core.validateGallery(['/images/price-list/zzz.jpg'], existing)
    const tooMany = core.validateGallery(Array.from({ length: 10 }, (_, i) => CF(`m${i}`)), [])
    const nine = core.validateGallery(Array.from({ length: 9 }, (_, i) => CF(`m${i}`)), [])
    const empty = core.validateGallery([], existing)
    const notArr = core.validateGallery('cloud://x', [])
    return keep.ok && JSON.stringify(keep.images) === JSON.stringify([CF('n'), existing[1], existing[0]]) && keep.image === CF('n') &&
      !badNew.ok && !badRel.ok && !tooMany.ok && nine.ok && nine.images.length === 9 && empty.ok && empty.image === '' && !notArr.ok
  })
  await t('多图真跑保存：封面 = images[0]、保留原有地址、非法 / 超量零写入、新建只收 cloud://', async () => {
    const env = bootFn()
    const r = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, images: [CF('n1'), '/images/price-list/b.jpg'] } })
    const d = env.store.price_list_items.get('p1')
    const ok1 = r.success && d.image === CF('n1') && JSON.stringify(d.images) === JSON.stringify([CF('n1'), '/images/price-list/b.jpg'])
    const env2 = bootFn()
    const bad = await env2.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, images: ['/images/price-list/zzz.jpg'] } })
    const many = await env2.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, images: Array.from({ length: 10 }, (_, i) => CF(`m${i}`)) } })
    const newRel = await env2.call(SUPER, { action: 'adminSavePriceItem', data: { ...BASE_ITEM, skuId: 'BF-NEW', images: ['/images/price-list/a.jpg'] } })
    const zero = priceWrites(env2) === 0 && [bad, many, newRel].every((x) => x.success === false && (x.errors || []).some((e) => e.field === 'image'))
    const created = await env2.call(SUPER, { action: 'adminSavePriceItem', data: { ...BASE_ITEM, skuId: 'BF-NEW', images: [CF('c1'), CF('c2')] } })
    const nd = env2.store.price_list_items.get(created.id) || {}
    const env3 = bootFn()
    const clr = await env3.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...BASE_ITEM, images: [] } })
    const cd = env3.store.price_list_items.get('p1')
    return ok1 && zero && created.success && nd.image === CF('c1') && JSON.stringify(nd.images) === JSON.stringify([CF('c1'), CF('c2')]) &&
      clr.success && cd.image === '' && JSON.stringify(cd.images) === '[]'
  })
  await t('上传链路：chooseMedia → 宽 > 1280 压缩 → uploadFile，编辑页传 b2b-price/、伙伴页走 adminSavePartnerProfile', () => {
    const img = read(IMG_JS)
    return /wx\.chooseMedia\(/.test(img) && /const IMAGE_EDGE = 1280\b/.test(img) && /compressedWidth = IMAGE_EDGE/.test(img) &&
      /wx\.cloud\.uploadFile\(/.test(img) && /require\('\.\.\/\.\.\/\.\.\/utils\/imageUrl'\)/.test(img) &&
      /IMAGE_DIR = 'b2b-price'/.test(read(EDIT_JS)) && /pickAndUploadMany\(IMAGE_DIR, room\)/.test(read(EDIT_JS)) &&
      /callDesk\('adminSavePartnerProfile'/.test(read(PARTNER_JS))
  })
  await t('资质照不转公开链接：伙伴页直接用 cloud:// 显示', () => {
    const js = read(PARTNER_JS)
    const m = /licenses: \(profile\.licenses \|\| \[\]\)([^\n]*)/.exec(js)
    return !!m && !/thumbOf|absUrl|bigOf|cloudIdToHttps|map\(/.test(m[1]) &&
      /wx:for="\{\{licenses\}\}"[\s\S]{0,200}src="\{\{item\}\}"/.test(read(PARTNER_WXML))
  })
  await t('无原生弹框：b2bdesk 全部页面不调 wx.showModal', () =>
    walk(PKG).filter((f) => f.endsWith('.js')).every((f) => !/wx\.showModal\s*\(/.test(read(f))))
  await t('技术文案：三页可见文字无集合名 / 字段名 / 函数名', () => {
    const hits = [CENTER_WXML, EDIT_WXML, PARTNER_WXML].filter((f) => TECH_WORDS.test(visibleText(read(f))))
    if (hits.length) throw new Error(hits.join('、'))
    return true
  })
  await t('技术文案：网络失败提示不带函数名与原始报错', async () => {
    const api = loadCjs(API_JS, { globals: { wx: { cloud: { callFunction: () => Promise.reject({ errMsg: 'cloud.callFunction:fail -501000 FUNCTION_NOT_FOUND FunctionName parameter could not be found' }) } } } })
    const r = await api.callDesk('adminListPartners', {})
    const api2 = loadCjs(API_JS, { globals: { wx: { cloud: { callFunction: () => Promise.reject({ errMsg: 'cloud.callFunction:fail errCode: -404011 internal' }) } } } })
    const r2 = await api2.callDesk('adminListPartners', {})
    return r.success === false && !/manageSupplierDesk|FUNCTION|501000/.test(r.msg) && !/404011|errCode|callFunction/.test(r2.msg)
  })
  await t('关键交互：缩略图可点大图、更多弹层、悬浮新建、骨架、订单筛选收纳、伙伴门头', () => {
    const w = read(CENTER_WXML)
    const js = read(CENTER_JS)
    return /src="\{\{item\.thumb\}\}"/.test(w) && /catchtap="previewPrice"/.test(w) && /catchtap="openPriceSheet"/.test(w) &&
      (/class="sheet-mask"/.test(w) || /class="ui-pop-mask"/.test(w)) && /class="fab"[^>]*bindtap="newPrice"/.test(w) && /class="skel"/.test(w) &&
      /bindtap="toggleOrderFilter"/.test(w) && /wx:if="\{\{orders\.filterOpen\}\}"/.test(w) && /src="\{\{item\.logoThumb\}\}"/.test(w) &&
      /sheetToggle\(\)/.test(js) && /sheetMove\(e\)/.test(js)
  })
  await t('关键交互：编辑页多图（上传 / 选中预览 / 设为封面 / 左右移 / 删除）+ 吸底保存；伙伴页门头与资质上传', () => {
    const e = read(EDIT_WXML)
    const p = read(PARTNER_WXML)
    return /bindtap="addImages"/.test(e) && /bindtap="onTileTap"/.test(e) && /bindtap="setCover"/.test(e) &&
      /data-step="-1" bindtap="movePicked"/.test(e) && /data-step="1" bindtap="movePicked"/.test(e) &&
      /bindtap="removePicked"/.test(e) && /bindtap="previewPicked"/.test(e) && /gallery\.length < galleryMax/.test(e) && /class="bar"[\s\S]*bindtap="save"/.test(e) &&
      !/data-field="image"/.test(e) && /bindtap="chooseLogo"/.test(p) && /bindtap="addLicense"/.test(p) && /catchtap="removeLicense"/.test(p)
  })
  return { failures, passed }
}

async function main() {
  const { failures, passed } = await runChecks()
  if (failures.length) {
    console.error(`✗ supplier-desk-images：${failures.length} 条失败 / ${passed} 条通过`)
    failures.forEach((f) => console.error(`  - ${f}`))
    process.exitCode = 1
    return
  }
  console.log(`✓ supplier-desk-images：${passed} 条断言全部通过（价目图 / 伙伴资料图 / 页面交互与文案）`)
}

async function selftest() {
  const INJECTS = [
    { name: '价目图不校验 cloud://', file: CORE, from: 'if (hasImage && image && !isCloudFileId(image))', to: 'if (false)', expect: '只收 cloud://' },
    { name: '不带 image 也写空图', file: CORE, from: '  if (hasImage) data.image = image\n', to: '  data.image = image\n', expect: '不带 image 不覆盖' },
    { name: '保存时不判 image 是否带了', file: INDEX, from: 'if (data.image !== undefined && data.image !== (old.image || \'\'))', to: 'if (data.image !== (old.image || \'\'))', expect: '不带 image 不覆盖（真跑' },
    { name: '换封面冲掉图集', file: INDEX, from: 'data.images = core.nextImages(old.image || \'\', old.images, data.image)', to: 'data.images = data.image ? [data.image] : []', expect: '保留图集' },
    { name: '资料图整体替换', file: INDEX, from: 'data: { b2bProfile: profile, updateTime', to: 'data: { b2bProfile: _.set(profile), updateTime', expect: '只写带了的键' },
    { name: '资质照不校验 cloud://', file: CORE, from: 'if (!list.every(isCloudFileId))', to: 'if (false)', expect: '资质照只收 cloud://' },
    { name: '资料图动作绕过超管门禁', file: INDEX, from: '    const admin = ADMIN_ACTIONS[action]\n', to: "    if (action === 'adminSavePartnerProfile') return await handleSavePartnerProfile(ev, { openid })\n    const admin = ADMIN_ACTIONS[action]\n", expect: 'FORBIDDEN' },
    { name: '列表回非 cloud:// 资质照', file: INDEX, from: '.filter(core.isCloudFileId).slice(0, core.PARTNER_LICENSE_MAX)', to: '.slice(0, core.PARTNER_LICENSE_MAX)', expect: 'profile 只回 cloud://' },
    { name: '编辑页总是送 images', file: EDIT_JS, from: '  if (galleryDirty) out.images', to: '  out.images', expect: '没动图不送 image' },
    { name: '多图新增不校验 cloud://', file: CORE, from: 'if (!isCloudFileId(u) && !keep.has(u))', to: 'if (false)', expect: '多图只收 cloud://' },
    { name: '多图不设上限', file: CORE, from: 'if (list.length > GALLERY_MAX)', to: 'if (false)', expect: '最多 9 张' },
    { name: '封面不跟 images[0]', file: INDEX, from: '      data.image = gallery.image\n', to: '', expect: '封面 = images[0]' },
    { name: '原有地址不许保留', file: INDEX, from: "galleryOf(event.data, [old.image].concat(Array.isArray(old.images) ? old.images : []))", to: 'galleryOf(event.data, [])', expect: '保留原有地址' },
    { name: '新建放行原有地址', file: INDEX, from: '  const gallery = galleryOf(event.data, [])\n', to: "  const gallery = galleryOf(event.data, ['/images/price-list/a.jpg'])\n", expect: '新建只收 cloud://' },
    { name: '不带 images 也清空图集', file: INDEX, from: 'raw.images === undefined) return null', to: 'raw.images === undefined) return core.validateGallery([], [])', expect: '不带 image 不覆盖（真跑' },
    { name: '设为封面挪到末尾', file: EDIT_JS, from: '    list.unshift(g)\n', to: '    list.push(g)\n', expect: '编辑页多图' },
    { name: '上传不看剩余张数', file: EDIT_JS, from: 'pickAndUploadMany(IMAGE_DIR, room)', to: 'pickAndUploadMany(IMAGE_DIR, 9)', expect: '编辑页多图' },
    { name: '载入时封面不排首位', file: EDIT_JS, from: ';[primary].concat(list)', to: ';list.concat([primary])', expect: '编辑页载入' },
    { name: '不压缩直接传', file: IMG_JS, from: 'const IMAGE_EDGE = 1280', to: 'const IMAGE_EDGE = 99999', expect: '上传链路' },
    { name: '资质照转公开链接', file: PARTNER_JS, from: 'licenses: (profile.licenses || []).slice(0, LICENSE_MAX),', to: 'licenses: (profile.licenses || []).slice(0, LICENSE_MAX).map(thumbOf),', expect: '不转公开链接' },
    { name: '页面用了原生弹框', file: CENTER_JS, from: '  closeSheet() {', to: '  closeSheet() {\n    wx.showModal({ title: \'确认\' })', expect: '无原生弹框' },
    { name: '可见文案出现字段名', file: CENTER_WXML, from: '<text class="hero-sub">采购商与供货方', to: '<text class="hero-sub">按 skuId 排序 · 采购商与供货方', expect: '技术文案' },
    { name: '失败提示透出原始报错', file: API_JS, from: "  return '没连上服务，请稍后重试'", to: "  return msg ? `请求失败：${msg}` : '没连上服务，请稍后重试'", expect: '网络失败提示' },
    { name: '价目卡去掉「更多」弹层', file: CENTER_WXML, from: 'catchtap="openPriceSheet"', to: 'bindtap="editPrice"', expect: '关键交互' },
    { name: '编辑页回到手填图片地址', file: EDIT_WXML, from: '<text class="field-label">备注（可空）</text>', to: '<input data-field="image" /><text class="field-label">备注（可空）</text>', expect: '关键交互：编辑页多图' }
  ]
  let ok = true
  for (const inj of INJECTS) {
    overrides = new Map()
    const src = read(inj.file)
    if (!src.includes(inj.from)) {
      ok = false
      console.error(`  ✗ 注入「${inj.name}」锚点失效：${inj.from.slice(0, 60)}`)
      continue
    }
    overrides.set(inj.file, src.split(inj.from).join(inj.to))
    const { failures } = await runChecks()
    if (failures.some((f) => f.includes(inj.expect))) console.log(`  ✓ 注入「${inj.name}」被检出`)
    else {
      ok = false
      console.error(`  ✗ 注入「${inj.name}」未被检出（期望命中「${inj.expect}」）\n    ${failures.join('\n    ') || '（全部通过）'}`)
    }
  }
  overrides = new Map()
  if (!ok) {
    process.exitCode = 1
    return
  }
  console.log(`✓ selftest 通过：${INJECTS.length} 个注入全部被检出（只改内存副本，不写盘）`)
}

if (process.argv.includes('--selftest')) await selftest()
else await main()
process.exit()
