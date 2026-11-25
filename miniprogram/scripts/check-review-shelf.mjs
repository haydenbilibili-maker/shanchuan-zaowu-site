#!/usr/bin/env node
/**
 * check:review-shelf —— 藏品「版本审核」快照上架 / 下架（2026-11-25 产品负责人）
 *
 * 口径（产品负责人口径，刻意做简单）：
 *   ① 白名单 = 当前在架集合（= 已审核无风险）；
 *   ② 审核下架：白名单保留在架，其余全部下架（本次下架的记进 reviewOffIds）；
 *   ③ 审核上架：只恢复 ② 里下架的（审核前就已下架的不动）；
 *   ④ 硬规则：首页四馆（昆虫馆/动物馆/植物馆/海洋馆）每个馆至少 1 件在架，空馆则拒绝执行并指出馆名。
 *
 * 用法：node miniprogram/scripts/check-review-shelf.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const FN = join(MP, 'cloudfunctions/manageProductReview/index.js')
const SUB = join(MP, 'subpackages/manager/manager/workspace/_subviews.wxml')
const CFG = join(MP, 'subpackages/manager/manager/managerPageConfig.js')
const WXSS = join(MP, 'subpackages/manager/manager/index.wxss')
const RC = join(MP, 'cloudbaserc.json')
const RULES = join(ROOT, 'cloudbase/rules/product_review_states.json')
const SCHEMA = join(ROOT, 'cloudbase/schema/product_review_states.md')
const CLOUDJS = join(ROOT, 'admin/src/cloud.js')
const SENS = join(ROOT, 'cloudbase/sensitive-collections.json')

const INJECTIONS = []

function memDb(seed) {
  const docs = JSON.parse(JSON.stringify(seed || {}))
  const db = { docs, failIds: new Set(), created: false }
  const query = (name) => {
    let skip = 0
    let limit = 1000
    const fieldQ = { chain: null }
    const chain = {
      where() { return chain },
      orderBy() { return chain },
      field() { return chain },
      skip(n) { skip = n; return chain },
      limit(n) { limit = n; return chain },
      get: async () => ({ data: Object.values(docs[name] || {}).slice(skip, skip + limit) })
    }
    void fieldQ
    return chain
  }
  db.collection = (name) => Object.assign(query(name), {
    doc: (id) => ({
      get: async () => {
        const d = (docs[name] || {})[id]
        if (!d) throw new Error('document not exist')
        return { data: d }
      },
      update: async ({ data }) => {
        if (db.failIds.has(id)) throw new Error('update failed')
        const d = (docs[name] || {})[id]
        if (!d) return { stats: { updated: 0 } }
        Object.assign(d, data)
        return { stats: { updated: 1 } }
      },
      set: async ({ data }) => { (docs[name] = docs[name] || {})[id] = Object.assign({ _id: id }, data) }
    }),
    add: async ({ data }) => {
      const id = 'a' + Object.keys(docs[name] || {}).length
      ;(docs[name] = docs[name] || {})[id] = Object.assign({ _id: id }, data)
      return { _id: id }
    }
  })
  db.createCollection = async (name) => { db.created = true; docs[name] = docs[name] || {} }
  db.command = { neq: () => ({}) }
  db.serverDate = () => 0
  return db
}

function load(db, superAdmin = true) {
  return loadCjsModule(FN, {
    stubs: {
      'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => db, getWXContext: () => ({ OPENID: 'admin1' }) },
      './staffGuard': {
        assertStaff: async (d, openid, opts) => (opts && opts.requireSuperAdmin && !superAdmin
          ? { ok: false, code: 'forbidden', msg: '仅超管' }
          : { ok: true, actor: { openid, workspaceRole: 'super_admin' } })
      },
      './auditLog': { writeAuditLog: async () => {}, auditFromActor: (a, f) => Object.assign({ openid: a && a.openid }, f || {}) }
    },
    globals: { console: { warn() {}, log() {}, error() {} } }
  })
}

const p = (id, hall, off, extra) => Object.assign({ _id: id, title: id, isOffShelf: !!off, rootCategoryName: hall }, extra || {})

function seedProducts() {
  // 四馆各有在架白名单
  return {
    p1: p('p1', '昆虫馆', false),
    p2: p('p2', '动物馆', false),
    p3: p('p3', '植物馆', false),
    p4: p('p4', '海洋馆', false),
    // 审核期新增（默认下架；案例里再手动上架，模拟「白名单之后才上新」）
    p5: p('p5', '昆虫馆', true),
    p6: p('p6', '海洋馆', true),
    // 审核前就已经下架的
    p7: p('p7', '植物馆', true)
  }
}

async function main() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }
  const read = (f) => readFileSync(f, 'utf8')

  // R1 生成白名单 = 当前在架集合（四馆齐全）
  let db = memDb({ products: seedProducts() })
  let fn = load(db)
  let r = await fn.main({ action: 'status' })
  ok('R1 status：白名单 0、在架 4 / 7、四馆各 ≥1', r.success && r.counts.on === 4 && r.counts.total === 7 && r.halls.every((h) => h.on >= 1))
  r = await fn.main({ action: 'buildWhitelist' })
  const wl = db.docs.product_review_states.main.whitelistIds || []
  ok('R1 生成白名单 = 当前在架（4 件，不含 p5/p6 新增与 p7 已下架）', r.success && wl.length === 4 && !wl.includes('p5') && !wl.includes('p7'))

  // R2 空馆则拒绝生成
  db = memDb({ products: Object.assign(seedProducts(), { p4: p('p4', '海洋馆', true) }) })
  fn = load(db)
  r = await fn.main({ action: 'buildWhitelist' })
  ok('R2 有馆没有在架商品时拒绝生成白名单，并指出海洋馆',
    r.success === false && r.code === 'HALL_EMPTY' && r.emptyHalls.includes('海洋馆'))

  // R3 审核下架：只下架「在架 ∖ 白名单」（白名单建成后新上架 p5/p6 模拟审核期新增）
  db = memDb({ products: seedProducts() })
  fn = load(db)
  await fn.main({ action: 'buildWhitelist' })
  db.docs.products.p5.isOffShelf = false
  db.docs.products.p6.isOffShelf = false
  r = await fn.main({ action: 'offShelfForReview' })
  const st = db.docs.product_review_states.main
  ok('R3 审核下架：只下架 2 件新增，白名单 4 件仍在架',
    r.success && r.offCount === 2 && st.status === 'off' && st.reviewOffIds.sort().join() === 'p5,p6' &&
    db.docs.products.p1.isOffShelf !== true && db.docs.products.p2.isOffShelf !== true &&
    db.docs.products.p3.isOffShelf !== true && db.docs.products.p4.isOffShelf !== true &&
    db.docs.products.p5.isOffShelf === true && db.docs.products.p6.isOffShelf === true && db.docs.products.p7.isOffShelf === true)

  // R4 白名单里有馆为空 → 拒绝下架
  db = memDb({ products: seedProducts() })
  fn = load(db)
  await fn.main({ action: 'buildWhitelist' })
  delete db.docs.products.p4 // 白名单里的海洋馆商品被删掉
  db.docs.products.p5.isOffShelf = false
  r = await fn.main({ action: 'offShelfForReview' })
  ok('R4 审核期白名单缺馆 → 拒绝下架并指出海洋馆',
    r.success === false && r.code === 'HALL_EMPTY' && r.emptyHalls.includes('海洋馆') &&
    db.docs.products.p5.isOffShelf !== true)

  // R5 审核上架：只恢复 reviewOffIds，审核前已下架的不动
  db = memDb({ products: seedProducts() })
  fn = load(db)
  await fn.main({ action: 'buildWhitelist' })
  db.docs.products.p5.isOffShelf = false
  db.docs.products.p6.isOffShelf = false
  await fn.main({ action: 'offShelfForReview' })
  r = await fn.main({ action: 'restoreAfterReview' })
  ok('R5 审核上架：恢复 2 件；审核前就下架的 p7 仍下架；状态回到 idle',
    r.success && r.restored === 2 && db.docs.products.p5.isOffShelf === false && db.docs.products.p6.isOffShelf === false &&
    db.docs.products.p7.isOffShelf === true && db.docs.product_review_states.main.status === 'idle')

  // R6 状态守卫：重复下架 / 未下架时恢复
  db = memDb({ products: seedProducts() })
  fn = load(db)
  r = await fn.main({ action: 'offShelfForReview' })
  ok('R6 没有白名单时不允许审核下架', r.success === false && r.code === 'NO_WHITELIST')
  await fn.main({ action: 'buildWhitelist' })
  db.docs.products.p5.isOffShelf = false
  await fn.main({ action: 'offShelfForReview' })
  r = await fn.main({ action: 'offShelfForReview' })
  ok('R6 已在审核下架状态时重复执行被拒', r.success === false && r.code === 'ALREADY_OFF')
  r = await fn.main({ action: 'restoreAfterReview' })
  r = await fn.main({ action: 'restoreAfterReview' })
  ok('R6 已恢复后再点恢复被拒', r.success === false && r.code === 'NOT_OFF')

  // R7 权限：非超管全部拒绝
  db = memDb({ products: seedProducts() })
  fn = load(db, false)
  const outs = await Promise.all(['status', 'buildWhitelist', 'offShelfForReview', 'restoreAfterReview'].map((action) => fn.main({ action })))
  ok('R7 非超管四个动作全部被拒（不写库）', outs.every((x) => x.success === false && x.code === 'forbidden') && !db.docs.product_review_states)

  // R8 部分失败：失败的不进 reviewOffIds，页面可重试
  db = memDb({ products: seedProducts() })
  fn = load(db)
  await fn.main({ action: 'buildWhitelist' })
  db.docs.products.p5.isOffShelf = false
  db.docs.products.p6.isOffShelf = false
  db.failIds.add('p6')
  r = await fn.main({ action: 'offShelfForReview' })
  ok('R8 部分失败：failed 含 p6，reviewOffIds 只记成功的那件，partial=true',
    r.success && r.partial === true && r.failed.join() === 'p6' &&
    db.docs.product_review_states.main.reviewOffIds.join() === 'p5' && db.docs.products.p6.isOffShelf !== true)

  // R9 页面接线：仅超管、三按钮、四馆徽标、二次确认文案带件数
  const wxml = read(SUB)
  const cfg = read(CFG)
  ok('R9 页面：卡片仅超管可见 + 三个动作 + 四馆覆盖 + 空馆红字提示',
    /class="review-card[\s\S]{0,80}wx:if="\{\{isSuperAdmin\}\}"/.test(wxml) &&
    ['bindtap="buildReviewWhitelist"', 'bindtap="offShelfForReview"', 'bindtap="restoreAfterReview"'].every((k) => wxml.includes(k)) &&
    /reviewShelf\.halls/.test(wxml) && /reviewShelf\.emptyHalls\.length/.test(wxml) &&
    /loadReviewShelf\(true\)/.test(cfg) && /manageProductReview/.test(cfg) &&
    /const HALLS = \['昆虫馆', '动物馆', '植物馆', '海洋馆'\]/.test(read(FN)))

  // R10 云资源登记：函数清单 + 集合规则/schema/COLLECTIONS/serverOnly
  const rc = JSON.parse(read(RC))
  const names = (rc.functions || []).map((f) => f.name)
  const rule = JSON.parse(read(RULES))
  const sens = JSON.parse(read(SENS))
  ok('R10 部署清单含 manageProductReview；集合 product_review_states 规则全拒 + schema + COLLECTIONS + serverOnly',
    names.includes('manageProductReview') && rule.read === false && rule.write === false &&
    read(SCHEMA).includes('product_review_states') && read(CLOUDJS).includes("product_review_states") &&
    (sens.serverOnly || []).includes('product_review_states') && /\.review-card \{/.test(read(WXSS)))

  return fails
}

if (process.argv.includes('--selftest')) {
  const mutants = [
    {
      name: '生成白名单不再检查空馆',
      file: FN,
      find: "  const emptyHalls = emptyHallsOf(hallOn)\n  if (emptyHalls.length) {",
      replace: "  const emptyHalls = emptyHallsOf(hallOn)\n  if (false) {"
    },
    {
      name: '审核上架时把审核前已下架的也上架',
      file: FN,
      find: "  const candidates = (state.reviewOffIds || []).filter((id) => {",
      replace: "  const candidates = products.filter((p) => p.isOffShelf === true).map((p) => p._id); (function(){ return; })()\n  const candidatesX = (state.reviewOffIds || []).filter((id) => {"
    },
    {
      name: '审核下架不再只保留白名单（全部下架）',
      file: FN,
      find: "  const toOff = onProducts.filter((p) => !whiteSet.has(p._id)).map((p) => p._id)",
      replace: "  const toOff = onProducts.map((p) => p._id)"
    }
  ]
  let bad = 0
  for (const m of mutants) {
    const src = readFileSync(m.file, 'utf8')
    if (!src.includes(m.find)) {
      console.error(`✗ 注入「${m.name}」→ 锚点失效`)
      bad += 1
      continue
    }
    // 用临时副本跑：改写后再读回（先备份）
    const bak = src
    try {
      const fs = await import('node:fs')
      fs.writeFileSync(m.file, src.replace(m.find, m.replace))
      const fails = await main()
      if (!fails.length) {
        console.error(`✗ 注入「${m.name}」→ 未检出`)
        bad += 1
      }
    } catch (e) {
      console.error(`✗ 注入「${m.name}」→ 抛错：${e.message}`)
      bad += 1
    } finally {
      const fs = await import('node:fs')
      fs.writeFileSync(m.file, bak)
    }
  }
  if (bad) process.exit(1)
  console.log(`✓ check:review-shelf 自检通过（${mutants.length} 条注入全部检出，源文件已还原）`)
} else {
  const fails = await main()
  if (fails.length) {
    console.error('✗ 藏品版审快照不合格：')
    fails.forEach((f) => console.error('  - ' + f))
    process.exit(1)
  }
  console.log('✓ check:review-shelf：白名单 / 审核下架 / 审核上架恢复 / 四馆覆盖 / 权限 / 部分失败 全部通过')
}
