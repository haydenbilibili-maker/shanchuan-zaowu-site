#!/usr/bin/env node
/**
 * 云函数引用集合 ↔ 安全规则覆盖守卫（含**常量名解析**）
 *
 * 背景（2026-09-17 全面审计，C2 顺带发现）：
 *   此前核对「云函数引用的集合是否都有规则文件」时只扫**字面量** `db.collection('x')`，
 *   得出「68 个集合全部有规则、差集为空」。但云函数里大量写成
 *   `const BINDS = 'platform_order_binds'` + `db.collection(BINDS)` —— 字面量扫描**扫不到**，
 *   于是这类集合长期不在一规则文件、不在 `COLLECTIONS`、没有 schema（三处同步的盲区）。
 *   系统性重算（解析常量）后一次揪出 **9 个**：
 *     atlas_logs / gift_contacts / gift_dates / platform_order_binds /
 *     store_coupon_redeems / store_ledger_deletions /
 *     stored_value_accounts / stored_value_ledgers / stored_value_recharge_orders
 *   本守卫把「解析常量后再比对规则」固化下来，防止盲区重现。
 *
 * 动态变量名（值是运行时决定的集合名，不是固定集合）会被跳过，并在下方显式登记原因。
 *
 * 用法：
 *   node miniprogram/scripts/check-fn-collection-rules.mjs
 *   node miniprogram/scripts/check-fn-collection-rules.mjs --selftest
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const CF = join(MP, 'cloudfunctions')
const RULES = join(ROOT, 'cloudbase', 'rules')

/**
 * 这些标识符不是「固定集合名」，而是运行时决定的变量/参数 —— 跳过，不参与比对。
 * 每一条都写清原因，避免变成「随手加白名单」。
 */
const DYNAMIC_NAMES = new Set([
  'collection', // 多数函数把它作为 action 参数传入（如 getStoreConfig / manageStoreConfig）
  'collectionName', // 同上
  'name', // 循环变量 / 参数
  'otherCol', // getUserMessages 在 user_messages 与 notification_logs 之间**运行时**二选一
  'targetCollection', // toggleWant：按内容类型选集合
])

/**
 * 由**解构 require 的兄弟模块**导出的集合常量（本守卫不跨文件解析，故显式登记）。
 * 每一条都必须写清「来自哪个模块、指向哪个集合」—— 将来若把常量改成别的集合，
 * 这里会与规则文件比对失败，从而暴露而不是被静默跳过。
 */
const HANDOFF_CONSTANTS = new Map([
  ['GIFT_SETTINGS_COL', 'gift_settings'],   // manageGift：来自 ./giftSettingsMeta 的 COLLECTION
  ['RULES_COLLECTION', 'deposit_rules'],    // createDepositIntent：来自 ./depositRules 的 COLLECTION
])

/**
 * 纯函数：从一组 {name, source} 里解析出引用的集合名。
 * @returns {{ literals: string[], constants: string[], dynamic: string[], resolved: string[] }}
 */
export function resolveCollections(files) {
  const literals = new Set()
  const constantsUsed = new Set()
  const dynamic = new Set()
  const constMap = new Map()

  for (const { source } of files) {
    for (const m of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([a-z0-9_]+)['"]/g)) {
      constMap.set(m[1], m[2])
    }
  }
  for (const { source } of files) {
    // 去掉注释，避免注释里的示例被当成真实引用
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '').replace(/\/\/[^\n]*/g, '')
    for (const m of code.matchAll(/db\.collection\(\s*([A-Za-z_][A-Za-z0-9_]*|['"][a-z0-9_]+['"])\s*\)/g)) {
      const raw = m[1]
      if (raw.startsWith("'") || raw.startsWith('"')) { literals.add(raw.slice(1, -1)); continue }
      if (DYNAMIC_NAMES.has(raw)) { dynamic.add(raw); continue }
      if (constMap.has(raw)) { constantsUsed.add(constMap.get(raw)); continue }
      if (HANDOFF_CONSTANTS.has(raw)) { constantsUsed.add(HANDOFF_CONSTANTS.get(raw)); continue }
      dynamic.add(raw) // 其余未知标识符按动态处理
    }
  }
  const resolved = [...new Set([...literals, ...constantsUsed])].sort()
  return { literals: [...literals].sort(), constants: [...constantsUsed].sort(), dynamic: [...dynamic].sort(), resolved }
}

/** 纯函数：哪些集合没有规则文件 */
export function missingRules(collections, rulesExists) {
  return collections.filter((c) => !rulesExists(c))
}

function scanRepo() {
  const files = []
  for (const e of readdirSync(CF, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = join(CF, e.name)
    const walk = (p) => {
      for (const x of readdirSync(p, { withFileTypes: true })) {
        if (x.name === 'node_modules' || x.name.startsWith('.')) continue
        const q = join(p, x.name)
        if (x.isDirectory()) walk(q)
        else if (x.name.endsWith('.js')) files.push({ name: e.name, source: readFileSync(q, 'utf8') })
      }
    }
    walk(dir)
  }
  const res = resolveCollections(files)
  const rulesExists = (c) => existsSync(join(RULES, `${c}.json`))
  return { ...res, problems: missingRules(res.resolved, rulesExists), rulesExists }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }

  const lit = resolveCollections([{ name: 'f', source: "await db.collection('orders').add({})" }])
  t('字面量集合被解析', lit.literals.includes('orders'))

  const con = resolveCollections([{ name: 'f', source: "const BINDS = 'platform_order_binds'\nawait db.collection(BINDS).add({})" }])
  t('★ 常量集合被解析（盲区修复的关键）', con.constants.includes('platform_order_binds'))

  const dyn = resolveCollections([{ name: 'f', source: "await db.collection(collectionName).get()" }])
  t('运行时常量名被跳过', dyn.resolved.length === 0 && dyn.dynamic.includes('collectionName'))

  const commented = resolveCollections([{ name: 'f', source: "// db.collection('ghost_collection')\nconst a = 1" }])
  t('注释里的集合不算引用', commented.literals.length === 0)

  const notConst = resolveCollections([{ name: 'f', source: "const lower = 'x'\nawait db.collection(lower).get()" }])
  t('小写/未知标识符按动态处理（不误报）', notConst.resolved.length === 0)

  const handoff = resolveCollections([{ name: 'f', source: 'await db.collection(GIFT_SETTINGS_COL).get()' }])
  t('★ 解构 require 的集合常量按登记解析（gift_settings）', handoff.constants.join() === 'gift_settings')
  t('  未登记的未知大写标识符仍按动态跳过（不误报）',
    resolveCollections([{ name: 'f', source: 'await db.collection(SOMETHING_NEW).get()' }]).resolved.length === 0)

  t('★ 缺规则文件会被列出',
    missingRules(['orders', 'nope_x'], (c) => c === 'orders').join() === 'nope_x')
  t('  全部有规则 → 无问题', missingRules(['orders'], () => true).length === 0)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：常量集合会被解析、动态名与注释不误报、缺规则会被列出')
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const { resolved, literals, constants, dynamic, problems } = scanRepo()
  if (problems.length) {
    console.error(`✗ 云函数引用了没有安全规则的集合 ${problems.length} 个：`)
    problems.forEach((c) => console.error(`  - ${c}（补 cloudbase/rules/${c}.json，并在 admin/src/cloud.js 登记）`))
    process.exit(1)
  }
  console.log(`✓ 云函数引用的 ${resolved.length} 个集合全部有安全规则（字面量 ${literals.length} / 常量 ${constants.length}）`)
  if (dynamic.length) console.log(`  （跳过 ${dynamic.length} 个运行时集合名：${dynamic.join(', ')}）`)
}
