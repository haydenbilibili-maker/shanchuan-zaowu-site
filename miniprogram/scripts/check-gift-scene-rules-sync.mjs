/**
 * 礼赠场景规则一致性守卫（云函数副本 ↔ 脚本 SSOT）
 *
 * 背景：场景标签规则要同时活在两个地方，而它们**无法共享代码**：
 *   · `scripts/giftSceneRules.mjs` —— 仓库脚本的 SSOT（扫描存量、批量候选都用它）；
 *   · `cloudfunctions/assistProductCopy/giftScenes.js` —— 云函数副本（云函数只能 require 自己目录内的文件）。
 * 没有守卫时，只改一边不会被任何检查拦住 → 同一件商品在「一键补齐」与「批量脚本」里会得到不同标签。
 *
 * 本守卫做三件事：
 *   ① **逐例比对**：8 个根分类 × 9 个价格档（含边界与异常价）= 72 例，两边输出必须逐字一致；
 *   ② **接线**：云函数确实用 proposeScenes 算并随 data 返回 giftScenes；客户端 payload 确实带 price
 *      （规则依赖价格档，漏传就会把收藏级当轻礼送）；
 *   ③ 边界与异常（下架 / ¥0.01 异常价 / 零价）两边同样一致。
 *
 * 用法：
 *   node miniprogram/scripts/check-gift-scene-rules-sync.mjs
 *   node miniprogram/scripts/check-gift-scene-rules-sync.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const CLOUD_RULES = 'miniprogram/cloudfunctions/assistProductCopy/giftScenes.js'
const CLOUD_FN = 'miniprogram/cloudfunctions/assistProductCopy/index.js'
const SCRIPT_RULES = 'scripts/giftSceneRules.mjs'
const MANAGER_JS = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'

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
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** 云函数副本是 CJS；脚本是 ESM —— 两边都取真源码 */
function loadCloudRules() {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', read(CLOUD_RULES))(module, module.exports)
  return module.exports
}
const cloud = loadCloudRules()
const script = await import(pathToFileURL(resolve(ROOT, SCRIPT_RULES)).href)
const cloudFn = stripComments(read(CLOUD_FN))
const managerJs = stripComments(read(MANAGER_JS))

/* ── ① 72 例逐例比对 ───────────────────────────────────────────────────── */
const ROOTS = ['昆虫馆', '动物馆', '海洋馆', '首饰馆', '矿石馆', '植物馆', '衍生品', '首饰馆' === 'x' ? '' : '(无)']
// ⚠️ 必须覆盖**每个阈值的两侧**：只测 799/800 时，把阈值改成 1000 也测不出来
// （本守卫的自检抓过这个缺口 —— 阈值附近 ±1 才是真正的判据）
const PRICES = [
  0, 0.01, 4, 88, 198,
  299, 300, 301,        // STATEMENT_MIN
  799, 800, 801,        // LIGHT_GIFT_MAX
  900, 1500,
  2999, 3000, 3001,     // COLLECTOR_MIN
  9999, 10000, 10001,   // TOP_TIER_MIN
  15800, 58888
]
const cases = []
for (const root of ROOTS) for (const price of PRICES) cases.push({ rootCategoryName: root, price, isOffShelf: false })
// 下架与缺字段
cases.push({ rootCategoryName: '昆虫馆', price: 399, isOffShelf: true })
cases.push({ price: 399 })
cases.push({ rootCategoryName: '首饰馆', price: 0 })

const diffs = []
for (const c of cases) {
  const a = JSON.stringify(cloud.proposeScenes(c))
  const b = JSON.stringify(script.proposeScenes(c))
  if (a !== b) diffs.push(`${c.rootCategoryName || '(无)'} ¥${c.price}${c.isOffShelf ? ' 下架' : ''}: 云=${a} 脚本=${b}`)
}
check(`★ 云函数副本 ↔ 脚本 SSOT 逐例一致（${cases.length} 例）`, diffs.length === 0, diffs.slice(0, 3).join(' | '))

// 关键边界各给一条具名断言（错在哪一眼可见）
{
  const at = (root, price, extra = {}) => ({ rootCategoryName: root, price, isOffShelf: false, ...extra })
  const cases2 = [
    ['收藏级（¥58888）只给纪念日', at('动物馆', 58888), ['anniversary']],
    ['¥4 真实在售小件 → 轻礼档', at('植物馆', 4), ['birthday', 'enrollment', 'graduation', 'new_job', 'gratitude']],
    ['¥0.01 异常价 → 不给标签', at('昆虫馆', 0.01), []],
    ['下架 → 不给标签', at('昆虫馆', 399, { isOffShelf: true }), []],
    ['首饰馆 → 含纪念日、不含乔迁/新婚',
      at('首饰馆', 500), ['birthday', 'anniversary', 'enrollment', 'graduation', 'new_job', 'gratitude']]
  ]
  for (const [name, input, want] of cases2) {
    check(`  · ${name}`, JSON.stringify(cloud.proposeScenes(input)) === JSON.stringify(want),
      `got ${JSON.stringify(cloud.proposeScenes(input))}`)
  }
}

/* ── ② 接线 ────────────────────────────────────────────────────────────── */
check('★ 云函数引入并使用 proposeScenes', /require\('\.\/giftScenes'\)/.test(cloudFn) && /const giftScenes = proposeScenes\(/.test(cloudFn))
check('★ 云函数把 giftScenes 随 data 返回', /data: \{[\s\S]{0,200}giftScenes,/.test(cloudFn))
check('★ 规则需要价格档 → 客户端 payload 必须带 price',
  /price: Number\(p\.price\) \|\| 0/.test(managerJs),
  '漏传 price 会把收藏级当轻礼送（一键补齐时）')

/* ── 输出 / 自检 ───────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 礼赠场景规则一致性检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 礼赠场景规则：${passed} 项通过（${cases.length} 例逐例一致 / 关键边界具名 / 接线：云函数算并入返回、客户端传 price）`)
}

function selftest() {
  const injections = [
    {
      name: '云函数副本的轻礼阈值被改（与脚本漂移）',
      file: CLOUD_RULES,
      from: 'const LIGHT_GIFT_MAX = 800',
      to: 'const LIGHT_GIFT_MAX = 1000'
    },
    {
      name: '云函数副本的收藏级阈值被改',
      file: CLOUD_RULES,
      from: 'const TOP_TIER_MIN = 10000',
      to: 'const TOP_TIER_MIN = 5000'
    },
    {
      name: '脚本 SSOT 的陈列类清单被改',
      file: SCRIPT_RULES,
      from: "const DISPLAY_ROOTS = ['昆虫馆', '动物馆', '海洋馆', '植物馆', '矿石馆', '衍生品']",
      to: "const DISPLAY_ROOTS = ['昆虫馆', '动物馆', '海洋馆', '植物馆']"
    },
    {
      name: '云函数不再计算 giftScenes（接线断）',
      file: CLOUD_FN,
      from: '        giftScenes,',
      to: ''
    },
    {
      name: '客户端不再传 price（规则失去价格档）',
      file: MANAGER_JS,
      from: '          price: Number(p.price) || 0',
      to: '          priceHint: 0'
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
