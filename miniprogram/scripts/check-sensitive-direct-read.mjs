#!/usr/bin/env node
/**
 * check:sensitive-direct-read —— 敏感集合客户端直读棘轮（订单隐私收紧 2026-09-28）
 *
 * 敏感集合清单：cloudbase/sensitive-collections.json
 *   · ERP（admin/src，除只读网关 utils/cloudbaseCdnDb.js）：禁止任何 .collection(<敏感>) 直读 —— 须走
 *     fetchCollection* / cdnCount / cdnQueryPage / cdnDocGet（它们对敏感集合改经 secureDataRead）
 *   · 官网（src/）：只许 .add（采购意向表单），禁止读
 *   · 小程序（miniprogram，除 cloudfunctions/scripts）：按「文件 × 集合」计数，**只许变少**
 *     （基线 clientReadBaseline；店长/超管端 orders 直读为 0 —— 已改走 secureDataRead / managerShipOrder）
 *
 * 判定：解析 .collection(ARG) 之后的方法链（配平括号跨行）。含 get/count/watch/aggregate，或链上看不出
 * 读写（赋值给变量后另用）→ 记为读；只 add / doc().update|set|remove / where().update|remove → 记为写。
 * ARG 支持字面量、同文件 const 常量、ERP 的 COLLECTIONS.KEY；动态集合名不判。
 *
 * 写（2026-09-28 第二轮，写保护集合 = collections ∪ writeProtectedExtra）：
 *   · ERP 禁止裸 .collection(<写保护>).add/update/remove；cdnAdd/cdnUpdate/cdnRemove/cdnSet/cdnUpsert* 写写保护集合
 *     须能落到 secureDataWrite（PROXY_WRITE_COLLECTIONS 且 WRITE_POLICY 允许该动作）或 manageStoreContent 通道，
 *     否则 = 直写被 write:false 拒绝，按 erpDeniedWriteBaseline 只许变少
 *   · 官网 / 小程序直写写保护集合按 clientWriteBaseline 只许变少（官网询价表单 add 1 处；小程序 0）
 *
 * 用法：node miniprogram/scripts/check-sensitive-direct-read.mjs [--print-baseline | --selftest]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIST_PATH = 'cloudbase/sensitive-collections.json'
const GATEWAY = 'admin/src/utils/cloudbaseCdnDb.js'
const WRITE_POLICY_PATH = 'miniprogram/cloudfunctions/secureDataWrite/policy.js'

function walk(dir, exts, skip, out = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (n === 'node_modules' || n === 'miniprogram_npm' || n.startsWith('.')) continue
    const p = resolve(dir, n)
    const rel = relative(ROOT, p)
    if (skip.some((s) => rel === s || rel.startsWith(s + '/'))) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, exts, skip, out)
    else if (exts.some((e) => n.endsWith(e))) out.push(rel)
  }
  return out
}

/** 从 pos（指向 '('）起跳过配平括号，返回 ')' 之后的位置；粗略忽略字符串内容 */
function skipParens(text, pos) {
  let depth = 0
  let i = pos
  let quote = ''
  for (; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return text.length
}

/** 解析 .collection(...) 之后的方法链，返回方法名数组 */
function chainMethods(text, pos) {
  const methods = []
  let i = pos
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1
    if (text[i] !== '.') break
    const m = /^\.\s*([A-Za-z_$][\w$]*)\s*/.exec(text.slice(i, i + 80))
    if (!m) break
    methods.push(m[1])
    i += m[0].length
    if (text[i] === '(') i = skipParens(text, i)
  }
  return methods
}

export function classifyChain(methods) {
  const READ = ['get', 'count', 'watch', 'aggregate']
  if (methods.some((m) => READ.includes(m))) return 'read'
  if (methods.includes('add')) return 'write'
  if (methods.some((m) => m === 'update' || m === 'set' || m === 'remove')) return 'write'
  return 'read'
}

function collectionKeyMap(cloudJs) {
  const map = {}
  for (const m of cloudJs.matchAll(/^\s*([A-Z_]+):\s*'([a-z_]+)'/gm)) map[m[1]] = m[2]
  return map
}

export function scanFile(path, text, sensitive, keyMap) {
  const consts = {}
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([a-z_]+)['"]/g)) consts[m[1]] = m[2]
  const hits = []
  const re = /\.collection\(\s*([^()]*?)\s*\)/g
  let m
  while ((m = re.exec(text))) {
    const arg = m[1]
    let name = null
    const lit = /^['"]([a-z_]+)['"]$/.exec(arg)
    const key = /^COLLECTIONS\.([A-Z_]+)(?:\s*\|\|\s*['"]([a-z_]+)['"])?$/.exec(arg)
    const ident = /^([A-Za-z_$][\w$]*)$/.exec(arg)
    if (lit) name = lit[1]
    else if (key) name = keyMap[key[1]] || key[2] || null
    else if (ident && consts[ident[1]]) name = consts[ident[1]]
    if (!name || !sensitive.has(name)) continue
    const kind = classifyChain(chainMethods(text, m.index + m[0].length))
    const line = text.slice(0, m.index).split('\n').length
    hits.push({ path, line, collection: name, kind })
  }
  return hits
}

const CDN_WRITE_OPS = {
  cdnAdd: ['add'],
  cdnUpdate: ['update'],
  cdnRemove: ['remove'],
  cdnSet: ['set'],
  cdnUpsertDoc: ['add', 'update'],
  cdnUpsertSingleton: ['add', 'update'],
  cdnUpsertByWhere: ['add', 'update'],
}

function parseWriteRoutes(gatewaySrc, policySrc) {
  const setOf = (name) => {
    const m = gatewaySrc.match(new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))
    return new Set(m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [])
  }
  const policy = {}
  const body = (policySrc.match(/const WRITE_POLICY = \{([\s\S]*?)\n\}/) || [])[1] || ''
  for (const m of body.matchAll(/^ {2}([a-z_]+):\s*\{[\s\S]*?ops:\s*\[([^\]]*)\]/gm)) {
    policy[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])
  }
  const proxy = setOf('PROXY_WRITE_COLLECTIONS')
  return { proxy, storeContent: setOf('STORE_CONTENT_WRITE_COLLECTIONS'), policy }
}

/** ERP cdn* 写助手调用：首参解析为集合名（字面量 / COLLECTIONS.KEY / 本文件或 ERP 导出的字符串常量） */
export function scanCdnWrites(path, text, keyMap, exportedConsts) {
  const consts = { ...exportedConsts }
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([a-z_]+)['"]/g)) consts[m[1]] = m[2]
  const hits = []
  const re = new RegExp(`(?<![\\w.$])(${Object.keys(CDN_WRITE_OPS).join('|')})\\(\\s*([^,()]+?)\\s*[,)]`, 'g')
  let m
  while ((m = re.exec(text))) {
    const arg = m[2]
    const lit = /^['"]([a-z_]+)['"]$/.exec(arg)
    const key = /^COLLECTIONS\.([A-Z_]+)(?:\s*\|\|\s*['"]([a-z_]+)['"])?$/.exec(arg)
    const ident = /^([A-Za-z_$][\w$]*)$/.exec(arg)
    let name = null
    if (lit) name = lit[1]
    else if (key) name = keyMap[key[1]] || key[2] || null
    else if (ident && consts[ident[1]]) name = consts[ident[1]]
    if (!name) continue
    hits.push({ path, line: text.slice(0, m.index).split('\n').length, collection: name, helper: m[1] })
  }
  return hits
}

export function evaluate(files, list) {
  const sensitive = new Set(list.collections)
  const writeProtected = new Set([...list.collections, ...(list.writeProtectedExtra || [])])
  const keyMap = collectionKeyMap(files['admin/src/cloud.js'] || '')
  const routes = parseWriteRoutes(files[GATEWAY] || '', files[WRITE_POLICY_PATH] || '')
  const exportedConsts = {}
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith('admin/src/')) continue
    for (const m of text.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([a-z_]+)['"]/g)) exportedConsts[m[1]] = m[2]
  }
  const errors = []
  const notes = []
  const mpCounts = {}
  const writeCounts = {}
  const erpDenied = {}
  for (const [path, text] of Object.entries(files)) {
    if (!/\.(js|mjs|ts|vue|astro)$/.test(path)) continue
    const all = scanFile(path, text, writeProtected, keyMap)
    const hits = all.filter((h) => h.kind === 'read' && sensitive.has(h.collection))
    const writes = all.filter((h) => h.kind === 'write')
    if (path.startsWith('admin/src/')) {
      if (path === GATEWAY) continue
      hits.forEach((h) => errors.push(`ERP 直读敏感集合 ${h.collection}：${h.path}:${h.line}（改用 fetchCollection*/cdnCount/cdnQueryPage/cdnDocGet，经 secureDataRead）`))
      writes.forEach((h) => errors.push(`ERP 裸写写保护集合 ${h.collection}：${h.path}:${h.line}（改用 cdnAdd/cdnUpdate/cdnRemove，经 secureDataWrite）`))
      for (const h of scanCdnWrites(path, text, keyMap, exportedConsts)) {
        if (!writeProtected.has(h.collection)) continue
        const need = CDN_WRITE_OPS[h.helper]
        const viaGateway = routes.proxy.has(h.collection) && need.every((op) => (routes.policy[h.collection] || []).includes(op))
        if (viaGateway || routes.storeContent.has(h.collection)) continue
        const k = `${h.path}|${h.collection}`
        erpDenied[k] = (erpDenied[k] || 0) + 1
      }
    } else if (path.startsWith('src/')) {
      hits.forEach((h) => errors.push(`官网读取敏感集合 ${h.collection}：${h.path}:${h.line}（官网只许 add）`))
    } else if (path.startsWith('miniprogram/')) {
      hits.forEach((h) => {
        const k = `${h.path}|${h.collection}`
        mpCounts[k] = (mpCounts[k] || 0) + 1
      })
    }
    if (path.startsWith('src/') || path.startsWith('miniprogram/')) {
      writes.forEach((h) => {
        const k = `${h.path}|${h.collection}`
        writeCounts[k] = (writeCounts[k] || 0) + 1
      })
    }
  }
  const ratchet = (counts, base, label, hint) => {
    for (const [k, n] of Object.entries(counts)) {
      const allowed = base[k] || 0
      if (n > allowed) {
        const [p, c] = k.split('|')
        errors.push(`${label} ${c}：${p}（${n} 处 > 基线 ${allowed}）—— ${hint}`)
      }
    }
    for (const [k, allowed] of Object.entries(base)) {
      const n = counts[k] || 0
      if (n < allowed) notes.push(`${k} 已降到 ${n}（基线 ${allowed}），可下调基线`)
    }
  }
  ratchet(writeCounts, list.clientWriteBaseline || {}, '客户端新增写保护集合直写', '改走云函数（官网只许既有询价表单 add；小程序为 0）')
  ratchet(erpDenied, list.erpDeniedWriteBaseline || {}, 'ERP 新增被规则拒绝的直写', '该表 write:false，直写必失败：加进 secureDataWrite WRITE_POLICY 或走专用云函数')
  const baseline = list.clientReadBaseline || {}
  for (const [k, n] of Object.entries(mpCounts)) {
    const allowed = baseline[k] || 0
    if (n > allowed) {
      const [p, c] = k.split('|')
      errors.push(`小程序新增敏感集合直读 ${c}：${p}（${n} 处 > 基线 ${allowed}）—— 改走云函数；店长/超管端一律不得直读 orders`)
    }
  }
  for (const [k, allowed] of Object.entries(baseline)) {
    const n = mpCounts[k] || 0
    if (n < allowed) notes.push(`${k} 已降到 ${n}（基线 ${allowed}），可下调 clientReadBaseline`)
  }
  return { errors, notes, mpCounts, writeCounts, erpDenied }
}

function loadFiles() {
  const files = {}
  const paths = [
    ...walk(resolve(ROOT, 'admin/src'), ['.js', '.vue'], []),
    ...walk(resolve(ROOT, 'src'), ['.js', '.ts', '.astro', '.vue', '.mjs'], []),
    ...walk(resolve(ROOT, 'miniprogram'), ['.js'], ['miniprogram/cloudfunctions', 'miniprogram/scripts']),
  ]
  for (const p of paths) files[p] = readFileSync(resolve(ROOT, p), 'utf8')
  files[WRITE_POLICY_PATH] = readFileSync(resolve(ROOT, WRITE_POLICY_PATH), 'utf8')
  return files
}

function main() {
  const list = JSON.parse(readFileSync(resolve(ROOT, LIST_PATH), 'utf8'))
  const files = loadFiles()
  if (process.argv.includes('--print-baseline')) {
    const r = evaluate(files, { ...list, clientReadBaseline: {}, clientWriteBaseline: {}, erpDeniedWriteBaseline: {} })
    const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
    console.log(JSON.stringify({ clientReadBaseline: sorted(r.mpCounts), clientWriteBaseline: sorted(r.writeCounts), erpDeniedWriteBaseline: sorted(r.erpDenied) }, null, 2))
    return
  }
  if (process.argv.includes('--selftest')) {
    const base = evaluate(files, list)
    if (base.errors.length) {
      console.error('✗ 自检前提失败：当前源码本身不通过')
      base.errors.forEach((e) => console.error('  - ' + e))
      process.exit(1)
    }
    const mgr = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
    const cases = [
      ['店长页恢复 orders 直读（跨行链）', { [mgr]: files[mgr] + "\nasync function x(){ const r = await db\n  .collection('orders')\n  .where({ status: 'paid' })\n  .limit(50)\n  .get() }\n" }],
      ['店长页 orders 赋值后另读', { [mgr]: files[mgr] + "\nconst q = db.collection('orders')\n" }],
      ['ERP 组件用 COLLECTIONS 常量直读', { 'admin/src/components/__probe.vue': "<script setup>\nconst r = await db.collection(COLLECTIONS.FINANCE_RECORDS).limit(20).get()\n</script>" }],
      ['ERP 用同文件常量直读', { 'admin/src/utils/__probe.js': "const COL = 'admin_users'\nexport const f = (db) => db.collection(COL).count()\n" }],
      ['官网读 orders', { 'src/lib/__probe.ts': "export const f = (db) => db.collection('orders').where({}).get()\n" }],
      ['C 端新文件直读 orders', { 'miniprogram/subpackages/extra/__probe/index.js': "db.collection('orders').doc(id).get()\n" }],
      ['ERP 裸写 admin_users', { 'admin/src/utils/__probe.js': "export const f = (db) => db.collection('admin_users').doc('a').update({ data: { role: 'super_admin' } })\n" }],
      ['ERP cdnUpdate 写网关不允许的动作', { 'admin/src/utils/__probe.js': "export const f = () => cdnUpdate(COLLECTIONS.FINANCE_RECORDS, 'a', { x: 1 })\n" }],
      ['ERP cdnAdd 写 admin_roles', { 'admin/src/utils/__probe.js': "export const f = () => cdnAdd('admin_roles', { x: 1 })\n" }],
      ['ERP 经跨文件导出常量写', { 'admin/src/utils/__probe.js': "export const f = () => cdnRemove(MOVE_COL, 'a')\n" }],
      ['ERP 新增 orders 直写', { 'admin/src/components/__probe.vue': "<script setup>\nawait cdnUpdate('orders', id, { status: 'x' })\n</script>" }],
      ['小程序直写 stores', { 'miniprogram/subpackages/extra/__probe/index.js': "db.collection('stores').doc(id).update({ data: { a: 1 } })\n" }],
      ['官网新增直写 refunds', { 'src/lib/__probe.ts': "export const f = (db) => db.collection('refunds').add({ data: 1 })\n" }],
    ]
    const negatives = [
      ['ERP cdnUpdate 经写网关（refunds）不误报', { 'admin/src/utils/__probe.js': "export const f = () => cdnUpdate(COLLECTIONS.REFUNDS, 'a', { x: 1 })\n" }],
      ['ERP cdnAdd 经跨文件常量（stock_movements）不误报', { 'admin/src/utils/__probe.js': "export const f = () => cdnAdd(MOVE_COL, { x: 1 })\n" }],
      ['ERP 经 manageStoreContent 通道（feishu_shipments）不误报', { 'admin/src/utils/__probe.js': "export const f = () => cdnUpdate('feishu_shipments', 'a', { x: 1 })\n" }],
      ['非敏感集合不误报', { 'admin/src/utils/__probe.js': "export const f = (db) => db.collection('products').limit(1).get()\n" }],
    ]
    let ok = true
    for (const [name, patch] of cases) {
      const caught = evaluate({ ...files, ...patch }, list).errors.length > 0
      console.log(`${caught ? '✓' : '✗'} 自检注入「${name}」${caught ? '已检出' : '未检出'}`)
      if (!caught) ok = false
    }
    for (const [name, patch] of negatives) {
      const clean = evaluate({ ...files, ...patch }, list).errors.length === 0
      console.log(`${clean ? '✓' : '✗'} 对照「${name}」${clean ? '未误报' : '误报'}`)
      if (!clean) ok = false
    }
    process.exit(ok ? 0 : 1)
  }
  const { errors, notes, mpCounts, writeCounts, erpDenied } = evaluate(files, list)
  notes.forEach((n) => console.log('  · ' + n))
  if (errors.length) {
    console.error(`✗ check:sensitive-direct-read：${errors.length} 项`)
    errors.forEach((e) => console.error('  - ' + e))
    process.exit(1)
  }
  const mpTotal = Object.values(mpCounts).reduce((a, b) => a + b, 0)
  console.log(`✓ check:sensitive-direct-read：ERP/官网 0 处敏感集合直读；小程序 ${mpTotal} 处（${Object.keys(mpCounts).length} 个文件×集合，均在基线内，只许变少）；写保护集合直写：客户端 ${Object.values(writeCounts).reduce((a, b) => a + b, 0)} 处、ERP 被拒存量 ${Object.values(erpDenied).reduce((a, b) => a + b, 0)} 处（只许变少）`)
}

main()
