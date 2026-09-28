#!/usr/bin/env node
/**
 * 出货单粘贴解析单测（settlement 域）
 *
 * 钉死真机样例：
 *   A) 2026.9.22出货 + 品名-20个（横杠）
 *   B) 2026年9月22日出货 + 品名20个（中文日期、无横杠）
 * 源：manageStoreShipment/shipmentDefaults.js · parseShipmentText / parseItemLine
 *
 *   node miniprogram/scripts/test-shipment-parse.mjs
 *   node miniprogram/scripts/test-shipment-parse.mjs --selftest
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../..')
const DEFAULTS = join(
  ROOT,
  'miniprogram/cloudfunctions/manageStoreShipment/shipmentDefaults.js'
)
const selftest = process.argv.includes('--selftest')

function load() {
  // CommonJS 模块；清缓存以便自检还原后重读
  delete require.cache[require.resolve(DEFAULTS)]
  return require(DEFAULTS)
}

let passed = 0
let failed = 0
function eq(name, got, want) {
  const ok = Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want)
  if (ok) {
    passed += 1
  } else {
    failed += 1
    console.error(`✗ ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`)
  }
}
function ok(name, cond) {
  if (cond) passed += 1
  else {
    failed += 1
    console.error(`✗ ${name}`)
  }
}

const SAMPLE = `2026.9.22出货
山川造物
杂蝶冰箱贴-20个
雅灰蝶冰箱贴-4个
熊蜂植物果实标本框-4个
雅灰蝶植物果实标本框-4个
雅灰蝶熊蜂植物标本框-2个

星宸标本
雅灰蝶冰箱贴-2个
`

/** 中文年月日 + 无横杠「品名20个」 */
const SAMPLE_CN = `2026年9月22日出货
山川造物
杂蝶冰箱贴20个
雅灰蝶冰箱贴4个
熊蜂植物果实标本框4个
雅灰蝶植物果实标本框4个
雅灰蝶熊蜂植物标本框2个

星宸标本
雅灰蝶冰箱贴2个
`

function assertDualStore(tag, r) {
  ok(`${tag} ok`, r.ok === true)
  ok(`${tag} canWrite`, r.canWrite === true)
  eq(`${tag} 出货日`, r.shipmentDate, '2026-09-22')
  eq(`${tag} 两店`, r.summary.storeCount, 2)
  eq(`${tag} 总行数`, r.summary.itemCount, 6)
  eq(`${tag} 总件数`, r.summary.totalQty, 36)
  ok(`${tag} 无 failedLines`, !(r.failedLines && r.failedLines.length))
  ok(`${tag} 无 warnings`, !(r.warnings && r.warnings.length))
  eq(`${tag} 山川造物件数`, r.shipments[0].totalQty, 34)
  eq(`${tag} 星宸件数`, r.shipments[1].totalQty, 2)
  eq(`${tag} 首行品名`, r.shipments[0].items[0].itemName, '杂蝶冰箱贴')
  eq(`${tag} 首行数量`, r.shipments[0].items[0].qty, 20)
  eq(`${tag} 门店1`, r.shipments[0].storeName, '山川造物')
  eq(`${tag} 门店2`, r.shipments[1].storeName, '星宸标本')
}

function runAssertions(D) {
  // ── 行级（横杠）──
  eq('I1 纯数字', D.parseItemLine('杂蝶冰箱贴-20'), { itemName: '杂蝶冰箱贴', qty: 20 })
  eq('I2 紧贴「个」', D.parseItemLine('杂蝶冰箱贴-20个'), { itemName: '杂蝶冰箱贴', qty: 20 })
  eq('I3 空格+个', D.parseItemLine('杂蝶冰箱贴-20 个'), { itemName: '杂蝶冰箱贴', qty: 20 })
  eq('I4 只', D.parseItemLine('雅灰蝶冰箱贴-4只'), { itemName: '雅灰蝶冰箱贴', qty: 4 })
  eq('I5 件', D.parseItemLine('熊蜂植物果实标本框-4 件'), {
    itemName: '熊蜂植物果实标本框',
    qty: 4
  })
  eq('I6 品名内含横杠取末段数量', D.parseItemLine('A-B型标本-3个'), {
    itemName: 'A-B型标本',
    qty: 3
  })
  eq('I7 非法无数量', D.parseItemLine('杂蝶冰箱贴'), null)
  eq('I8 空行', D.parseItemLine(''), null)

  // ── 行级（无横杠）──
  eq('I9 无横杠紧贴个', D.parseItemLine('杂蝶冰箱贴20个'), {
    itemName: '杂蝶冰箱贴',
    qty: 20
  })
  eq('I10 无横杠空格+个', D.parseItemLine('雅灰蝶冰箱贴4 个'), {
    itemName: '雅灰蝶冰箱贴',
    qty: 4
  })
  eq('I11 无横杠须带量词', D.parseItemLine('杂蝶冰箱贴20'), null)

  // ── 日期 ──
  eq('D1 点号月日', D.parseShipmentDateLine('2026.9.22出货'), '2026-09-22')
  eq('D2 中文逗号', D.parseShipmentDateLine('2026，9.14出货'), '2026-09-14')
  eq('D3 ISO', D.parseShipmentDateLine('2026-09-22出货'), '2026-09-22')
  eq('D4 中文年月日', D.parseShipmentDateLine('2026年9月22日出货'), '2026-09-22')
  eq('D5 中文年月日空格', D.parseShipmentDateLine('2026 年 9 月 22 日 出货'), '2026-09-22')

  // ── 整段：点号 + 横杠 ──
  assertDualStore('S', D.parseShipmentText(SAMPLE))

  // 空格+个的整段变体也必须过
  const spaced = SAMPLE.replace(/-(\d+)个/g, '-$1 个')
  const r2 = D.parseShipmentText(spaced)
  ok('S15 空格+个整段 ok', r2.ok === true)
  eq('S16 空格+个总件数', r2.summary.totalQty, 36)

  // ── 整段：中文日期 + 无横杠 ──
  assertDualStore('CN', D.parseShipmentText(SAMPLE_CN))
}

if (selftest) {
  const bak = DEFAULTS + '.bak-selftest'
  if (!existsSync(DEFAULTS)) {
    console.error('selftest: 找不到 shipmentDefaults.js')
    process.exit(1)
  }
  copyFileSync(DEFAULTS, bak)
  try {
    const src = readFileSync(DEFAULTS, 'utf8')
    // 注入：去掉量词兼容 → 真机样例（横杠+个）必须失败
    const injected2 = src.replace(
      "s.match(/^(.+)-(\\d+)\\s*(?:个|只|件|盒|套|箱)?\\s*$/u)",
      "s.match(/^(.+)-(\\d+)\\s*$/)"
    )
    if (injected2 === src) {
      console.error('selftest: 注入点未命中（正则源串变了？）')
      process.exit(1)
    }
    writeFileSync(DEFAULTS, injected2)
    const D = load()
    const r = D.parseShipmentText(SAMPLE)
    if (r.ok === true || (r.summary && r.summary.itemCount === 6)) {
      console.error('selftest: 注入后样例仍成功 —— 守卫未真正失效')
      process.exit(1)
    }
    console.log('出货粘贴解析：selftest ok（注入后样例失败，已被检出）')
  } finally {
    copyFileSync(bak, DEFAULTS)
    unlinkSync(bak)
    delete require.cache[require.resolve(DEFAULTS)]
  }
  process.exit(0)
}

const D = load()
runAssertions(D)
console.log(`出货粘贴解析：通过 ${passed} / ${passed + failed}`)
if (failed) {
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log(
  '✓ 粘贴解析断言全部通过（点号/中文日期、横杠/无横杠数量、双门店样例）'
)
