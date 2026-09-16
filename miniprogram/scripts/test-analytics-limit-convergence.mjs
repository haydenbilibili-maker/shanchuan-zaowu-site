/**
 * #26 余项「采样上限在云函数侧的收敛」行为断言
 *
 * 为什么不能只靠守卫的静态扫描：`check-analytics-limits.mjs` 能证明「代码里引用了常量」，
 * 但证不了**实际生效的值**。本次修的三处缺陷都是「值不对」而非「名字不对」：
 *   1. `getHotSearchKeywords` 读 `user_behaviors` 省略 limit → 实际只读 **100 条**（服务端默认）；
 *   2. `loadDailyRollup` 硬编码 500 → 30 天区间的日汇总**静默丢行**；
 *   3. `topEvents` 传 3000 → 同一集合的第三种口径。
 * 所以这里**运行真源码**并截获它实际发出的 limit 值。
 *
 * 用法：
 *   node miniprogram/scripts/test-analytics-limit-convergence.mjs
 *   node miniprogram/scripts/test-analytics-limit-convergence.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const INJECTIONS = {
  // 回到「省略 limit」的历史形态 → 实际只读 100 条
  'hotsearch-omits-limit': {
    file: 'miniprogram/cloudfunctions/getHotSearchKeywords/index.js',
    from: '.limit(KEYWORD_SAMPLE_LIMIT)',
    to: ''
  },
  // 回到硬编码 500
  'daily-rollup-500': {
    file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
    from: '.limit(DAILY_ROLLUP_LIMIT)',
    to: '.limit(500)'
  },
  // 回到 topEvents 的第三口径 3000
  'topevents-3000': {
    file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
    from: 'loadBehaviors(startTs, endTs, BEHAVIOR_SAMPLE_LIMIT)',
    to: 'loadBehaviors(startTs, endTs, 3000)'
  },
  // 两端 describeSample 文案分叉（用户在两个页面看到不同说法）
  'cloud-describe-sample-drifts': {
    file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/analyticsLimits.js',
    from: "  return `已采样最近 ${cap} ${unit}，非全量`",
    to: "  return `采样 ${cap} ${unit}`"
  }
}

const INJECT = String(process.env.ANALYTICS_LIMIT_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/** 从源码里按大括号配对切出一个函数体（真实源码，不是抄一份逻辑） */
function sliceFunction(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('function not found: ' + header)
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces: ' + header)
}

/* ------------------------------------------------------------------ *
 * 1) 两侧常量逐字相等 + describeSample 文案一致
 * ------------------------------------------------------------------ */

const erpSrc = readFileSync(resolve(ROOT, 'admin/src/utils/analyticsLimits.js'), 'utf8')
const cloudSrc = readSrc('miniprogram/cloudfunctions/getAnalyticsDashboard/analyticsLimits.js')

function parseConsts(src) {
  const out = {}
  for (const m of src.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*$/gm)) {
    out[m[1]] = Number(m[2])
  }
  return out
}
const erpConsts = parseConsts(erpSrc)
const cloudConsts = parseConsts(cloudSrc)

for (const name of ['DAILY_ROLLUP_LIMIT', 'BEHAVIOR_SAMPLE_LIMIT', 'BEHAVIOR_PULSE_LIMIT', 'KEYWORD_SAMPLE_LIMIT']) {
  eq(`同名常量两侧一致：${name}`, cloudConsts[name], erpConsts[name])
}
eq('云函数侧日汇总上限（修掉硬编码 500）', cloudConsts.DAILY_ROLLUP_LIMIT, 1000)
eq('云函数侧关键词采样上限（修掉服务端默认 100）', cloudConsts.KEYWORD_SAMPLE_LIMIT, 2000)

// describeSample 文案两端一致（同一概念不应有两种说法）
const cloudLimits = (() => {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', cloudSrc)(module, module.exports)
  return module.exports
})()
const erpDescribe = (() => {
  const m = erpSrc.match(/export function describeSample\([\s\S]*?\n\}/)
  if (!m) return null
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0].replace('export function', 'function')}; return describeSample`)()
})()
check('ERP describeSample 可提取', !!erpDescribe)
if (erpDescribe) {
  const samples = [[2000, 2000], [5, 2000], [1000, 1000], [0, 0]]
  samples.forEach(([a, l]) => {
    eq(`describeSample 两端同文案（${a}/${l}）`, cloudLimits.describeSample(a, l), erpDescribe(a, l))
  })
}

/* ------------------------------------------------------------------ *
 * 2) getHotSearchKeywords：实际发出的 limit 值 + 采样标注
 * ------------------------------------------------------------------ */

function makeHotSearchDb(rows) {
  const captured = { limit: null, orderBy: null }
  return {
    captured,
    db: {
      command: { gte: (v) => ({ $gte: v }) },
      collection(name) {
        if (name !== 'user_behaviors') throw new Error('unexpected collection ' + name)
        const api = {
          where() { return api },
          orderBy() { captured.orderBy = true; return api },
          limit(n) { captured.limit = n; return api },
          async get() { return { data: rows } }
        }
        return api
      }
    }
  }
}

function loadHotSearch(rows) {
  const { captured, db } = makeHotSearchDb(rows)
  const cloudStub = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db }
  const module = { exports: {} }
  const src = readSrc('miniprogram/cloudfunctions/getHotSearchKeywords/index.js')
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(module, module.exports, (id) => {
    if (id === 'wx-server-sdk') return cloudStub
    if (id === './analyticsLimits') return cloudLimits
    throw new Error('unexpected require ' + id)
  })
  return { main: module.exports.main, captured }
}

const fewRows = Array.from({ length: 5 }, () => ({ keyword: 'Morpho', action: 'search' }))
{
  const { main, captured } = loadHotSearch(fewRows)
  const res = await main({ limit: 10, timeRange: 7 })
  eq('★ 关键词查询必须显式带 limit（不再落 100 条默认）', captured.limit, 2000)
  check('查询按时间倒序（保证「最近」语义）', captured.orderBy === true)
  eq('未触顶 → 不标采样', res.sampled, false)
  eq('未触顶 → note 为空', res.note, '')
  eq('响应透出实际采样上限', res.sampleLimit, 2000)
  check('关键词统计仍正确', Array.isArray(res.data) && res.data.includes('Morpho'))
}

{
  const capRows = Array.from({ length: 2000 }, (_, i) => ({ keyword: 'k' + (i % 7), action: 'search' }))
  const { main } = loadHotSearch(capRows)
  const res = await main({ limit: 10, timeRange: 7 })
  eq('★ 触顶 → 显式标记 sampled', res.sampled, true)
  check('★ 触顶 → 给出可读说明（不再静默）', /已采样最近 2000 条/.test(res.note || ''), res.note)
}

/* ------------------------------------------------------------------ *
 * 3) loadDailyRollup：实际发出的 limit 值
 * ------------------------------------------------------------------ */

const dashSrc = readSrc('miniprogram/cloudfunctions/getAnalyticsDashboard/index.js')
{
  const body = sliceFunction(dashSrc, 'async function loadDailyRollup(dateKeys)')
  const captured = { limit: null }
  const db = {
    collection(name) {
      if (name !== 'analytics_daily') throw new Error('unexpected collection ' + name)
      const api = {
        where() { return api },
        limit(n) { captured.limit = n; return api },
        async get() { return { data: [] } }
      }
      return api
    }
  }
  const _ = { in: (v) => ({ $in: v }) }
  // eslint-disable-next-line no-new-func
  const fn = new Function('db', '_', 'DAILY_ROLLUP_LIMIT', `${body}; return loadDailyRollup`)(
    db,
    _,
    cloudLimits.DAILY_ROLLUP_LIMIT
  )
  await fn(['2026-09-15', '2026-09-16'])
  eq('★ 日汇总读取上限 = 真源常量（不再是硬编码 500）', captured.limit, cloudConsts.DAILY_ROLLUP_LIMIT)
}

/* ------------------------------------------------------------------ *
 * 4) topEvents：传给加载器的上限值（第三种口径已收敛）
 * ------------------------------------------------------------------ */

{
  const body = sliceFunction(dashSrc, 'async function topEvents(event)')
  const captured = { limit: null }
  const loadBehaviors = async (s, e, limit) => { captured.limit = limit; return [] }
  const parseRange = () => ({ startTs: 0, endTs: 1 })
  const aggregateRows = () => ({ byAction: [] })
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'parseRange',
    'loadBehaviors',
    'aggregateRows',
    'BEHAVIOR_SAMPLE_LIMIT',
    `${body}; return topEvents`
  )(parseRange, loadBehaviors, aggregateRows, cloudConsts.BEHAVIOR_SAMPLE_LIMIT)
  await fn({})
  eq('★ topEvents 用共享采样上限（不是第三种口径 3000）', captured.limit, cloudConsts.BEHAVIOR_SAMPLE_LIMIT)
  check('topEvents 不再传 3000', captured.limit !== 3000, String(captured.limit))
}

/* ------------------------------------------------------------------ *
 * 5) 云函数侧副本一致 + 云函数不再出现受管集合的裸数字
 * ------------------------------------------------------------------ */

const { readdirSync, existsSync } = await import('node:fs')
const copies = [
  'miniprogram/cloudfunctions/getAnalyticsDashboard/analyticsLimits.js',
  'miniprogram/cloudfunctions/getHotSearchKeywords/analyticsLimits.js',
  'miniprogram/cloudfunctions/manageMemberCrm/analyticsLimits.js'
]
copies.forEach((rel) => {
  const abs = resolve(ROOT, rel)
  check(`副本存在 ${rel}`, existsSync(abs))
  if (existsSync(abs)) {
    eq(`副本与真源一致 ${rel}`, readFileSync(abs, 'utf8'), readFileSync(resolve(ROOT, copies[0]), 'utf8'))
  }
})

for (const dir of ['getAnalyticsDashboard', 'getHotSearchKeywords', 'manageMemberCrm']) {
  const abs = resolve(ROOT, 'miniprogram/cloudfunctions', dir)
  if (!existsSync(abs)) continue
  // 只要求**入口**引用真源：同目录的 staffGuard / memberLevels 等辅助模块不读受管集合
  const entry = resolve(abs, 'index.js')
  if (!existsSync(entry)) continue
  const src = readFileSync(entry, 'utf8')
  check(`云函数 ${dir}/index.js 引用了 analyticsLimits 真源`, /require\(['"]\.\/analyticsLimits['"]\)/.test(src))
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, ANALYTICS_LIMIT_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) {
      console.log(`  ✓ 注入 ${name} 被检出`)
    } else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    console.error(clean.stdout || clean.stderr)
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n#26 采样上限收敛断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 采样上限在云函数侧已收敛（实际发出的 limit 值 / 触顶标注 / 两端常量与文案一致 / 副本同步）')
