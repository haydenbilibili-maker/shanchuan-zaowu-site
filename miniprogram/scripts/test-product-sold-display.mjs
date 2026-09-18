/**
 * 商品销量展示口径 行为断言（`utils/productStats.js` + `components/ProductCard`）
 *
 * 为什么必须跑真源码 + 钉结构：
 *   1. 「不显示已售 0」是**展示口径**，只有把各种组合（孤品 / 有销量 / 0 销量新品 / 0 销量旧品 /
 *      昆虫随机取到 0）真的算一遍，才能证明它成立；
 *   2. 这条口径的价值前提是「**只改展示、不写库**」——若有人往 `soldCount` 写默认值，
 *      `admin/src/utils/b2bFulfillment.js` 的 `soldCount = 现有 + 数量` 会把假基数与真实销量永久混合。
 *      所以"不写库"也必须是一条**断言**，而不是口头约定。
 *
 * 口径来源：产品负责人 2026-09-18 拍板 方案 A（零造假）——
 *   0 销量时不显示「已售 0」，新建档打「馆方新藏」，否则整条不显示。
 * 详见 docs/商品销量展示口径_2026-09-18.md
 *
 * 用法：
 *   node miniprogram/scripts/test-product-sold-display.mjs
 *   node miniprogram/scripts/test-product-sold-display.mjs --selftest
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

const STATS = 'miniprogram/utils/productStats.js'
const CARD_JS = 'miniprogram/components/ProductCard/index.js'
const CARD_WXML = 'miniprogram/components/ProductCard/index.wxml'
const CARD_WXSS = 'miniprogram/components/ProductCard/index.wxss'

const INJECTIONS = {
  // 0 销量又退回「已售 0」（本轮要修的那件事）
  'zero-sold-rendered': {
    file: STATS,
    from: "  if (count > 0) return { kind: 'sold', text: `已售 ${count}`, count }",
    to: "  if (count >= 0) return { kind: 'sold', text: `已售 ${count}`, count }"
  },
  // 不管建多久都打「馆方新藏」→ 老藏品被标成新品（虚假状态）
  'new-ignores-time': {
    file: STATS,
    from: '  const created = productTimeMs(product && product.createTime)\n  if (!created) return false',
    to: '  const created = productTimeMs(product && product.createTime)\n  if (!created) return true'
  },
  // 时间解析退回裸 new Date → {$date} 形态下新品判定静默失效
  'naive-time-parse': {
    file: STATS,
    from: '    if (value.$date != null) return productTimeMs(value.$date)\n',
    to: ''
  },
  // 卡片回退裸绑定 → 「已售 0」又会出现
  'card-binds-raw-sold': {
    file: CARD_WXML,
    from: '<text class="p-sold {{soldIsNew ? \'is-new\' : \'\'}}" wx:if="{{soldText}}">{{soldText}}</text>',
    to: '<text class="p-sold" wx:if="{{showSold}}">已售 {{soldCount}}</text>'
  },
  // 角标退回"排序上下文"那一套 → 又会出现"有 NEW 角标却没有馆方新藏"
  'badge-from-sort-context': {
    file: CARD_WXML,
    from: '<view wx:if="{{isNewArrival}}" class="tag-new">NEW</view>',
    to: '<view wx:if="{{info.isNew}}" class="tag-new">NEW</view>'
  },
  // 秒级时间戳被当 1970 → 新品判定静默失效（云端实测是毫秒，但历史文档可能是秒）
  'seconds-ignored': {
    file: STATS,
    from: '    return value < 1e12 ? value * 1000 : value',
    to: '    return value'
  },
  // 拿不到建档时间时不再回退 → 老数据/缺字段的商品永远看不到新藏标
  'no-time-no-fallback': {
    file: STATS,
    from: '    return !!(product && product.isNew === true)',
    to: '    return false'
  },
  // 往商品文档写展示值（假数据入库，会与 b2bFulfillment 的真实累加混合）
  'writes-sold-count': {
    file: STATS,
    from: 'function getSoldDisplay(product, nowMs) {',
    to: 'function getSoldDisplay(product, nowMs) {\n  if (product) product.soldCount = 30'
  }
}

const INJECT = String(process.env.SOLD_DISPLAY_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

function loadStats() {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', readSrc(STATS))(module, module.exports)
  return module.exports
}

const stats = loadStats()
const NOW = Date.parse('2026-09-18T12:00:00+08:00')
const DAY = 86400000
const mk = (o) => Object.assign({ _id: 'p1', title: '某标本' }, o || {})

/* ------------------------------------------------------------------ *
 * 1) 不变量：文案永远不是「已售 0」
 * ------------------------------------------------------------------ */
{
  const cases = [
    ['孤品', mk({ isOneOfAKind: true, soldCount: 0, createTime: new Date(NOW) })],
    ['有销量', mk({ soldCount: 7, createTime: new Date(NOW) })],
    ['0 销量新档', mk({ soldCount: 0, createTime: new Date(NOW - DAY) })],
    ['0 销量旧档', mk({ soldCount: 0, createTime: new Date(NOW - 400 * DAY) })],
    ['无建档时间', mk({ soldCount: 0 })],
    ['缺 soldCount', mk({ createTime: new Date(NOW - DAY) })],
    ['脏数据', mk({ soldCount: 'x', createTime: 'bad' })]
  ]
  let worst = ''
  cases.forEach(([name, p]) => {
    const d = stats.getSoldDisplay(p, NOW)
    if (d.text === '已售 0') worst = name
    check(`组合「${name}」不显示「已售 0」`, d.text !== '已售 0', d.text)
  })
  eq('没有任何组合渲染出「已售 0」', worst, '')
  eq('空商品不崩且不显示', JSON.stringify(stats.getSoldDisplay(null, NOW)), JSON.stringify({ kind: 'none', text: '', count: 0 }))
}

/* ------------------------------------------------------------------ *
 * 2) 四种出口各就各位
 * ------------------------------------------------------------------ */
{
  eq('有销量 → 已售 N',
    stats.getSoldDisplay(mk({ soldCount: 7, createTime: new Date(NOW) }), NOW).text, '已售 7')
  eq('有销量的 kind 是 sold',
    stats.getSoldDisplay(mk({ soldCount: 7, createTime: new Date(NOW) }), NOW).kind, 'sold')
  eq('★ 0 销量 + 新建档 → 馆方新藏',
    stats.getSoldDisplay(mk({ soldCount: 0, createTime: new Date(NOW - DAY) }), NOW).text, '馆方新藏')
  eq('★ 0 销量 + 旧建档 → 整条不显示（不是「已售 0」）',
    stats.getSoldDisplay(mk({ soldCount: 0, createTime: new Date(NOW - 400 * DAY) }), NOW).text, '')
  eq('孤品 → 不显示销量（由孤品角标承载）',
    stats.getSoldDisplay(mk({ isOneOfAKind: true, soldCount: 3 }), NOW).text, '')
  eq('镇店之宝同样不显示',
    stats.getSoldDisplay(mk({ isTreasure: true, soldCount: 3 }), NOW).text, '')
}

/* ------------------------------------------------------------------ *
 * 3) 昆虫随机取到 0 时也不能显示「已售 0」——这是同一类 bug 的隐藏分支
 * ------------------------------------------------------------------ */
{
  let zeroSeed = ''
  for (let i = 0; i < 5000; i++) {
    if (stats.getDisplaySoldCount({ _id: 'seed' + i, title: '蝴蝶标本' }) === 0) {
      zeroSeed = 'seed' + i
      break
    }
  }
  check('随机美化值域确实包含 0（构造得到，否则本条断言无意义）', !!zeroSeed, zeroSeed)
  if (zeroSeed) {
    const p = { _id: zeroSeed, title: '蝴蝶标本', soldCount: 0, createTime: new Date(NOW - DAY) }
    eq('★ 随机取到 0 的蝴蝶卡不显示「已售 0」', stats.getSoldDisplay(p, NOW).text, '馆方新藏')
    const old = Object.assign({}, p, { createTime: new Date(NOW - 400 * DAY) })
    eq('★ 随机取到 0 的旧蝴蝶卡整条不显示', stats.getSoldDisplay(old, NOW).text, '')
  }
}

/* ------------------------------------------------------------------ *
 * 4) 新品判据：以 createTime 为准（与 C 端「最新」排序同源）
 * ------------------------------------------------------------------ */
{
  eq('★ 默认窗口 7 天（产品负责人 2026-09-18 定）', stats.NEW_ARRIVAL_DAYS, 7)
  eq('6 天前 → 新品', stats.isNewArrival(mk({ createTime: new Date(NOW - 6 * DAY) }), NOW), true)
  eq('8 天前 → 非新品', stats.isNewArrival(mk({ createTime: new Date(NOW - 8 * DAY) }), NOW), false)
  eq('正好 7 天 → 非新品（边界不含）', stats.isNewArrival(mk({ createTime: new Date(NOW - 7 * DAY) }), NOW), false)
  eq('★ 9 天前的商品不再打「新藏」（线上实测：186 件集中在 7–14 天前，收窗后才不泛滥）',
    stats.getSoldDisplay(mk({ soldCount: 0, createTime: new Date(NOW - 9 * DAY) }), NOW).text, '')
  eq('★ 缺 createTime → **不算**新品（不乱打标）', stats.isNewArrival(mk({}), NOW), false)
  eq('★ {$date} 形态认得出', stats.isNewArrival(mk({ createTime: { $date: NOW - DAY } }), NOW), true)
  eq('ISO 串认得出', stats.isNewArrival(mk({ createTime: new Date(NOW - DAY).toISOString() }), NOW), true)
  eq('数字毫秒认得出', stats.isNewArrival(mk({ createTime: NOW - DAY }), NOW), true)
  eq('未来时间（时钟漂移）按新品处理，不会露出「已售 0」',
    stats.isNewArrival(mk({ createTime: NOW + DAY }), NOW), true)
  eq('脏时间不算新品', stats.isNewArrival(mk({ createTime: 'x' }), NOW), false)
  // ── 形态鲁棒性（2026-09-18 实测云端为 Date；历史/脚本写入可能是别的形态）──
  eq('★ 秒级时间戳（10 位）也认（否则被当 1970，新品判定静默失效）',
    stats.isNewArrival(mk({ createTime: Math.floor((NOW - DAY) / 1000) }), NOW), true)
  eq('★ Mongo 扩展 JSON {$date:{$numberLong}} 也认',
    stats.isNewArrival(mk({ createTime: { $date: { $numberLong: String(NOW - DAY) } } }), NOW), true)
  eq('★ 只有 _createTime（云开发自动字段）时也认',
    stats.isNewArrival(mk({ _createTime: NOW - DAY }), NOW), true)
  eq('★ 拿不到任何时间 → 退回卡片 NEW 角标用的那个信号（两者必须一致）',
    stats.isNewArrival(mk({ isNew: true }), NOW), true)
  eq('拿不到时间且没有角标信号 → 不算新品（不乱打标）',
    stats.isNewArrival(mk({}), NOW), false)
  eq('有明确时间且超窗 → 即使角标信号为真也不算新品（时间优先）',
    stats.isNewArrival(mk({ createTime: NOW - 400 * DAY, isNew: true }), NOW), false)
  eq('productTimeMs 秒级归一为毫秒', stats.productTimeMs(1789716520), 1789716520000)
  eq('productTimeMs 0/负数视为无效', stats.productTimeMs(0) + stats.productTimeMs(-1), 0)
  eq('productTimeMs 脏数据不崩', stats.productTimeMs({ nope: 1 }) + stats.productTimeMs(null), 0)
  eq('窗口可覆写', stats.isNewArrival(mk({ createTime: new Date(NOW - 5 * DAY) }), NOW, 3), false)
}

/* ------------------------------------------------------------------ *
 * 5) 结构：卡片接的是新出口；**只改展示、不写库**
 * ------------------------------------------------------------------ */
{
  const cardJs = readSrc(CARD_JS)
  const cardWxml = readSrc(CARD_WXML)
  const cardWxss = readSrc(CARD_WXSS)
  const statsSrc = readSrc(STATS)

  check('★ 卡片走 getSoldDisplay（唯一出口）', /getSoldDisplay\(/.test(cardJs) && /soldText:/.test(cardJs))
  // ★ 同源：NEW 角标与「馆方新藏」必须由同一个 isNewArrival 驱动
  check('★ NEW 角标与「馆方新藏」同源（角标不再用 info.isNew 那一套）',
    /<view wx:if="\{\{isNewArrival\}\}" class="tag-new">/.test(cardWxml) &&
      !/wx:if="\{\{info\.isNew\}\}"/.test(cardWxml))
  check('★ 角标数据也来自 isNewArrival()', /isNewArrival: newArrival/.test(cardJs) && /isNewArrival\(info\)/.test(cardJs))
  check('★ WXML 绑的是 soldText，不再是裸「已售 {{soldCount}}」',
    /\{\{soldText\}\}/.test(cardWxml) && !/已售 \{\{soldCount\}\}/.test(cardWxml))
  check('「馆方新藏」有独立样式（铜色小标），不是普通销量文字', /\.p-sold\.is-new/.test(cardWxss))
  check('★ 展示层不写库：productStats 里没有任何 soldCount 赋值',
    !/\.soldCount\s*=/.test(statsSrc) && !/soldCount\s*:/.test(statsSrc.replace(/getSoldCount[\s\S]*?\}/, '')))
  check('★ 保留「不往 DB 写默认值」的理由（b2bFulfillment 真实累加仍在）',
    /soldCount: \(parseInt\(product\.soldCount, 10\) \|\| 0\) \+ it\.quantity/.test(
      readFileSync(resolve(ROOT, 'admin/src/utils/b2bFulfillment.js'), 'utf8')))
  check('契约写在源码注释里（后来者知道为什么不许写库）', /b2bFulfillment/.test(statsSrc))
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, SOLD_DISPLAY_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) console.log(`  ✓ 注入 ${name} 被检出`)
    else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    const lines = `${clean.stdout || ''}\n${clean.stderr || ''}`
      .split('\n')
      .filter((l) => l.includes('✗'))
      .slice(0, 6)
    console.error(lines.length ? lines.map((l) => '    ' + l.trim()).join('\n') : (clean.stdout || clean.stderr))
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

console.log(`\n商品销量展示口径断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 销量展示口径通过（永不显示「已售 0」/ 0 销量新品打「馆方新藏」/ 只改展示不写库）')
