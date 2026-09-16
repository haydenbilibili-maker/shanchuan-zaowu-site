#!/usr/bin/env node
/**
 * 埋点采样上限一致性守卫
 *
 * 为什么需要（2026-09-16 审计）：同一埋点指标在不同页面的取样上限互不一致，
 * 「同一时间范围、不同页面对不上」是最难解释的一类报表问题。审计时实测：
 *   Dashboard 200/500/1000 · BehaviorAnalytics 1000/1000 · RealtimeMonitor 200/5000
 *   SearchKeywordsManager 2000×2 · 云函数 4000/500
 *
 * 约定：读取 `analytics_daily` / `user_behaviors` 时必须引用对应侧的
 * `analyticsLimits.js` 常量，不得就地写数字。
 *
 * #26 余项补强（云函数侧）：
 *   此前本守卫**只扫 admin/src**，云函数里就地写死的数字完全不受管，实测有三类问题：
 *     - `getAnalyticsDashboard.loadDailyRollup` 硬编码 `limit(500)`（ERP 是 1000）
 *     - `getHotSearchKeywords` 读 `user_behaviors` **省略 limit** → 服务端默认 100 条，
 *       静默截断，而 ERP 同名指标用 2000
 *     - `topEvents` 传 3000，与 BEHAVIOR_SAMPLE(4000)/BEHAVIOR_PULSE(1000) 都不相等
 *   故新增三项检查：
 *     C. 云函数侧禁止就地写死 / 禁止**省略 limit**（受管集合读取）
 *     D. 两侧同名常量值必须逐字相等（跨页口径的锁）
 *     E. 云函数侧副本必须与真源完全一致（云函数不能跨目录 require）
 *
 * 允许的例外（白名单，须写明理由）：
 *   - `portraitDataLoad.js` / `getRecommendations` 的按**单用户**取样：不参与跨页指标比较
 *   - `getUserStatistics` / `getUserAchievements` 用 `count()` 全量计数：不涉及采样
 *
 * 用法：
 *   node admin/scripts/check-analytics-limits.mjs
 *   node admin/scripts/check-analytics-limits.mjs --selftest
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SRC = join(ROOT, 'admin/src')
const LIMITS_FILE = 'utils/analyticsLimits.js'

/** 云函数侧真源与副本 */
const CLOUD_LIMITS_REL = 'miniprogram/cloudfunctions/getAnalyticsDashboard/analyticsLimits.js'
const CLOUD_LIMITS_COPIES = [
  'miniprogram/cloudfunctions/getAnalyticsDashboard/analyticsLimits.js',
  'miniprogram/cloudfunctions/getHotSearchKeywords/analyticsLimits.js',
  'miniprogram/cloudfunctions/manageMemberCrm/analyticsLimits.js',
]
/** 会读受管集合的云函数目录（新增调用方时在此登记 + 跑 sync 脚本） */
const CLOUD_FN_DIRS = [
  'miniprogram/cloudfunctions/getAnalyticsDashboard',
  'miniprogram/cloudfunctions/getHotSearchKeywords',
  'miniprogram/cloudfunctions/manageMemberCrm',
]
/** 云函数白名单：按单用户取样 / 全量 count，不参与跨页指标比较 */
const CLOUD_ALLOWED_FILES = [
  'getRecommendations/index.js',
  'getUserStatistics/index.js',
  'getUserAchievements/index.js',
]

/** 受管的埋点集合：这些集合的读取上限必须来自常量 */
export const MANAGED_COLLECTIONS = ['analytics_daily', 'user_behaviors']

/** 白名单：按单用户取样，不参与跨页比较 */
export const ALLOWED_FILES = ['admin/src/utils/portraitDataLoad.js']

/** 与 ERP 必须逐字相等的常量名（跨页口径锁） */
export const SHARED_CONSTS = [
  'DAILY_ROLLUP_LIMIT',
  'BEHAVIOR_SAMPLE_LIMIT',
  'BEHAVIOR_PULSE_LIMIT',
  'KEYWORD_SAMPLE_LIMIT',
]

/**
 * 纯函数：扫描 ERP 源码，返回违规列表。
 * 命中形态：fetchCollectionWhere('<managed>', ..., <纯数字>)
 */
export function findHardcodedLimits(src, rel) {
  const problems = []
  const norm = rel.replace(/\\/g, '/')
  if (ALLOWED_FILES.some((a) => norm.endsWith(a.replace('admin/src/', '')))) return problems
  for (const coll of MANAGED_COLLECTIONS) {
    // 跨行容错：collection 名与上限数字之间允许换行
    const re = new RegExp(
      `fetchCollectionWhere\\(\\s*['"\`]${coll}['"\`][\\s\\S]{0,400}?,\\s*(\\d+)\\s*\\)`,
      'g',
    )
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split('\n').length
      problems.push(
        `${norm}:${line}: 读取 \`${coll}\` 时就地写死上限 ${m[1]} —— 请改用 ${LIMITS_FILE} 的常量（跨页口径一致）`,
      )
    }
  }
  return problems
}

/**
 * 纯函数：扫描**云函数**源码，返回违规列表。
 *
 * 两类命中：
 *   1. `.limit(1234)` 出现在受管集合读取的链式调用里 → 就地写死
 *   2. 受管集合 `.get()` 前**没有 limit** → 服务端默认 100 条，静默截断（最隐蔽的一种）
 */
export function findCloudHardcodedLimits(src, rel) {
  const problems = []
  const norm = rel.replace(/\\/g, '/')
  if (CLOUD_ALLOWED_FILES.some((a) => norm.endsWith(a))) return problems
  const lines = src.split('\n')
  for (const coll of MANAGED_COLLECTIONS) {
    const re = new RegExp(`collection\\(\\s*['"\`]${coll}['"\`]\\s*\\)`, 'g')
    for (const m of src.matchAll(re)) {
      // 取该次读取的链式片段（到下一个 `;` 或 400 字符，先到为准）
      const rest = src.slice(m.index, m.index + 400)
      const semi = rest.indexOf(';')
      const chain = semi >= 0 ? rest.slice(0, semi) : rest
      const line = src.slice(0, m.index).split('\n').length
      const lit = chain.match(/\.limit\(\s*(\d+)\s*\)/)
      if (lit) {
        problems.push(
          `${norm}:${line}: 云函数读取 \`${coll}\` 时就地写死上限 ${lit[1]} —— 请改用 ./analyticsLimits 的常量`,
        )
        continue
      }
      // `.count()` 是全量计数，不涉及采样（getUserStatistics / getUserAchievements 属此类）
      const hasGet = /\.get\(/.test(chain)
      const usesConst = /\.limit\(/.test(chain)
      if (hasGet && !usesConst) {
        problems.push(
          `${norm}:${line}: 云函数读取 \`${coll}\` **省略了 limit** → 落服务端默认 100 条（静默截断、口径与 ERP 不一致）`,
        )
      }
    }
  }
  return problems
}

/**
 * 纯函数：抓「把上限当**位置参数**传给受管集合加载器」的写法。
 *
 * 为什么需要：`.limit(3000)` 这类**直接链式**写法能被上面的规则抓到，但
 * `loadBehaviors(startTs, endTs, 3000)` 这种**传参**写法里的数字在函数体外，
 * 链式扫描看不见 —— 实测 `topEvents` 就是这种形态（同一集合的第三种口径）。
 * 规则：这些加载器接受的上限必须传常量，不得传裸数字。
 */
export const MANAGED_LOADER_NAMES = [
  'loadBehaviors',
  'loadDailyRollup',
  'loadKeywordRows',
  'fetchCollectionSorted',
  'fetchCollectionWhere',
]

export function findIndirectHardcodedLimit(src, rel) {
  const problems = []
  const norm = rel.replace(/\\/g, '/')
  if (CLOUD_ALLOWED_FILES.some((a) => norm.endsWith(a))) return problems
  const re = new RegExp(`\\b(${MANAGED_LOADER_NAMES.join('|')})\\s*\\(([^)]*)\\)`, 'g')
  for (const m of src.matchAll(re)) {
    const args = m[2] || ''
    // 函数定义行（`async function loadBehaviors(...)`）不算调用
    const before = src.slice(Math.max(0, m.index - 20), m.index)
    if (/function\s*$/.test(before)) continue
    const lit = args.match(/(?:^|,)\s*(\d{2,})\s*(?:,|$)/)
    if (!lit) continue
    const line = src.slice(0, m.index).split('\n').length
    problems.push(
      `${norm}:${line}: 调用 \`${m[1]}\` 时把上限写成裸数字 ${lit[1]} —— 请传 ./analyticsLimits 的常量（传参形态的跨页口径漂移）`,
    )
  }
  return problems
}

/** 解析形如 `const NAME = 1234` / `export const NAME = 1234` 的常量表 */
export function parseConsts(src) {
  const out = new Map()
  for (const m of src.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*$/gm)) {
    out.set(m[1], Number(m[2]))
  }
  return out
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|vue)$/.test(name)) out.push(p)
  }
  return out
}

function selftest() {
  const cases = [
    ['常量引用不得报错',
      `fetchCollectionWhere('user_behaviors', where, BEHAVIOR_SAMPLE_LIMIT)`, 'a.js', 0],
    ['硬编码 user_behaviors 上限必须报错',
      `fetchCollectionWhere('user_behaviors', { action: 'search' }, 2000)`, 'b.vue', 1],
    ['硬编码 analytics_daily 上限必须报错',
      `fetchCollectionWhere('analytics_daily', { dateKey: d }, 200)`, 'c.vue', 1],
    ['跨行硬编码必须被捕获',
      `fetchCollectionWhere(\n  'user_behaviors',\n  { timestamp: _.gte(ms) },\n  500\n)`, 'd.vue', 1],
    ['非受管集合不受影响',
      `fetchCollectionWhere('orders', { status }, 500)`, 'e.vue', 0],
    ['白名单文件（单用户取样）不得报错',
      `fetchCollectionWhere('user_behaviors', { userId: openid }, 200)`,
      'admin/src/utils/portraitDataLoad.js', 0],
  ]
  let bad = 0
  for (const [name, src, rel, want] of cases) {
    const got = findHardcodedLimits(src, rel).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }

  const cloudCases = [
    ['云函数：常量引用不得报错',
      `db.collection('user_behaviors').where(w).limit(KEYWORD_SAMPLE_LIMIT).get()`, 0],
    ['云函数：就地写死必须报错',
      `db.collection('user_behaviors').where(w).limit(3000).get()`, 1],
    ['★ 云函数：省略 limit 必须报错（服务端默认 100 的静默截断）',
      `db.collection('user_behaviors').where(w).get()`, 1],
    ['云函数：analytics_daily 省略 limit 同样报错',
      `db.collection('analytics_daily').where(w).get()`, 1],
    ['云函数：count() 全量计数不受影响',
      `db.collection('user_behaviors').where(w).count()`, 0],
    ['云函数：白名单函数（单用户取样）不得报错',
      `db.collection('user_behaviors').where(w).limit(50).get()`, 0, 'getRecommendations/index.js'],
  ]
  const indirectCases = [
    ['★ 传参写死上限必须报错（topEvents 的历史形态）',
      `const rows = await loadBehaviors(startTs, endTs, 3000)`, 1],
    ['传参用常量不得报错',
      `const rows = await loadBehaviors(startTs, endTs, BEHAVIOR_SAMPLE_LIMIT)`, 0],
    ['不传上限不得报错',
      `loadBehaviors(startTs, endTs)`, 0],
    ['加载器函数定义不得报错',
      `async function loadBehaviors(startTs, endTs, limit = BEHAVIOR_SAMPLE) {`, 0],
    ['CMS 拉取用变量不得报错',
      `fetchCollectionSorted('user_behaviors', FETCH_CAP)`, 0],
  ]
  for (const [name, src, want] of indirectCases) {
    const got = findIndirectHardcodedLimit(src, 'getAnalyticsDashboard/index.js').length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }
  for (const [name, src, want, rel] of cloudCases) {
    const got = findCloudHardcodedLimits(src, rel || 'getAnalyticsDashboard/index.js').length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }

  const parsed = parseConsts('const A = 10\nconst B = 20\nconst c = 30\nconst D = "x"')
  const constOk = parsed.get('A') === 10 && parsed.get('B') === 20 && !parsed.has('c') && !parsed.has('D')
  if (!constOk) bad++
  console.log(`${constOk ? '✓' : '✗'} 常量解析只认顶层大写数字常量`)

  // ★ 真实文件注入：把本次真正修掉的三个缺陷逐个改回去，守卫必须报错，再还原。
  //   合成用例只能证明「正则写得对」，不能证明「真的能拦住这次这三处」。
  const injections = [
    {
      name: '把 getHotSearchKeywords 的 limit 删掉（回到服务端默认 100 的静默截断）',
      file: 'miniprogram/cloudfunctions/getHotSearchKeywords/index.js',
      from: '.limit(KEYWORD_SAMPLE_LIMIT)',
      to: '',
      expect: /省略了 limit/
    },
    {
      name: '把日汇总上限改回硬编码 500（ERP 是 1000）',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: '.limit(DAILY_ROLLUP_LIMIT)',
      to: '.limit(500)',
      expect: /就地写死上限 500/
    },
    {
      name: '把 topEvents 改回硬编码 3000（同一集合的第三种口径）',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: 'loadBehaviors(startTs, endTs, BEHAVIOR_SAMPLE_LIMIT)',
      to: 'loadBehaviors(startTs, endTs, 3000)',
      expect: /传参形态的跨页口径漂移/
    },
    {
      name: '把 ERP 的 DAILY_ROLLUP_LIMIT 改成 500（与云函数 1000 不一致）',
      file: 'admin/src/utils/analyticsLimits.js',
      from: 'export const DAILY_ROLLUP_LIMIT = 1000',
      to: 'export const DAILY_ROLLUP_LIMIT = 500',
      expect: /同名常量不一致：DAILY_ROLLUP_LIMIT/
    },
    {
      name: '把云函数副本改一个字符（副本漂移）',
      file: 'miniprogram/cloudfunctions/manageMemberCrm/analyticsLimits.js',
      from: 'const CRM_FETCH_CAP = 1000',
      to: 'const CRM_FETCH_CAP = 999',
      expect: /副本与真源不一致/
    }
  ]
  for (const inj of injections) {
    const abs = join(ROOT, inj.file)
    if (!existsSync(abs)) {
      console.log(`- 跳过（文件不存在）：${inj.name}`)
      continue
    }
    const orig = readFileSync(abs, 'utf8')
    if (!orig.includes(inj.from)) {
      bad++
      console.log(`✗ 注入锚点缺失：${inj.name}`)
      continue
    }
    try {
      writeFileSync(abs, orig.replace(inj.from, inj.to))
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
      const output = `${run.stdout || ''}${run.stderr || ''}`
      const caught = run.status !== 0 && inj.expect.test(output)
      if (inj.relax) {
        console.log(`${caught ? '✓' : '·'} ${inj.name}（当前守卫${caught ? '能' : '不能'}自动拦住，需人工复核）`)
      } else if (caught) {
        console.log(`✓ ${inj.name} → 被守卫拦下`)
      } else {
        bad++
        console.log(`✗ ${inj.name} → 未被拦下（status=${run.status}）`)
      }
    } finally {
      writeFileSync(abs, orig)
    }
  }
  // 注入还原后必须重新变绿（证明自检没有把工作区改坏）
  const after = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (after.status !== 0) {
    bad++
    console.log('✗ 注入还原后仍未通过——自检污染了工作区')
    console.log(after.stdout || after.stderr)
  } else {
    console.log('✓ 注入全部还原，工作区重新通过')
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：合成用例 + 真实文件注入（含本次修掉的三处）全部被拦下，且不误报')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  if (!existsSync(join(SRC, LIMITS_FILE))) {
    console.error(`✗ 缺少单一真源 admin/src/${LIMITS_FILE}`)
    process.exit(1)
  }
  if (!existsSync(join(ROOT, CLOUD_LIMITS_REL))) {
    console.error(`✗ 缺少云函数侧真源 ${CLOUD_LIMITS_REL}`)
    process.exit(1)
  }

  const problems = []

  // A. ERP 侧：不得就地写死
  const files = walk(SRC)
  for (const f of files) {
    problems.push(...findHardcodedLimits(readFileSync(f, 'utf8'), relative(ROOT, f)))
  }

  // C. 云函数侧：不得就地写死，也不得省略 limit
  let cloudScanned = 0
  for (const dir of CLOUD_FN_DIRS) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (!name.endsWith('.js')) continue
      if (name === 'analyticsLimits.js') continue
      const rel = `${dir}/${name}`.replace(`${ROOT}/`, '')
      cloudScanned += 1
      const src = readFileSync(abs + '/' + name, 'utf8')
      problems.push(...findCloudHardcodedLimits(src, rel))
      problems.push(...findIndirectHardcodedLimit(src, rel))
    }
  }

  // D. 两侧同名常量必须逐字相等
  const erpConsts = parseConsts(readFileSync(join(SRC, LIMITS_FILE), 'utf8'))
  const cloudConsts = parseConsts(readFileSync(join(ROOT, CLOUD_LIMITS_REL), 'utf8'))
  for (const name of SHARED_CONSTS) {
    const a = erpConsts.get(name)
    const b = cloudConsts.get(name)
    if (a == null || b == null) {
      problems.push(`同名常量缺失：${name}（ERP=${a} 云函数=${b}）—— 两侧都必须定义`)
      continue
    }
    if (a !== b) {
      problems.push(`同名常量不一致：${name} ERP=${a} 云函数=${b} —— 同一指标跨页会给出两个答案`)
    }
  }

  // E. 云函数侧副本必须与真源完全一致
  const canonical = readFileSync(join(ROOT, CLOUD_LIMITS_REL), 'utf8')
  for (const rel of CLOUD_LIMITS_COPIES) {
    if (!existsSync(join(ROOT, rel))) {
      problems.push(`缺少副本 ${rel}（请跑 sync-analytics-limits.sh）`)
      continue
    }
    if (readFileSync(join(ROOT, rel), 'utf8') !== canonical) {
      problems.push(`副本与真源不一致 ${rel}（请跑 sync-analytics-limits.sh）`)
    }
  }

  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n埋点采样上限一致性未通过：${problems.length} 处`)
    process.exit(1)
  }
  console.log(
    `✓ 埋点采样上限一致（ERP ${files.length} 个文件 + 云函数 ${cloudScanned} 个文件均引用常量；` +
    `${SHARED_CONSTS.length} 个同名常量两侧逐字相等；副本 ${CLOUD_LIMITS_COPIES.length} 份一致）`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
