/**
 * 详情页信息卡 · 三级视觉规范守卫
 *
 * 规范见 `subpackages/feature/detail/index.wxss` 头部注释（L1 主视觉 / L2 支撑 / L3 弱化）。
 * 钉住三件容易失守的事：
 *   ① 规范本身还在（注释被删 = 规范失效）；
 *   ② **金色收敛**：L1 之外不得出现品牌亮金（否则金色通胀、页面没有重点）；
 *   ③ 层级手法在：L3 有弱化（opacity/次要色）、信息卡与礼赠面板之间有极细分隔线。
 *
 * 用法：
 *   node miniprogram/scripts/check-detail-visual-tiers.mjs
 *   node miniprogram/scripts/check-detail-visual-tiers.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const WXSS = 'miniprogram/subpackages/feature/detail/index.wxss'
const WXML = 'miniprogram/subpackages/feature/detail/index.wxml'

let passed = 0
let failed = 0
const failures = []
const check = (name, cond, extra) => {
  if (cond) passed += 1
  else { failed += 1; failures.push(`${name}${extra ? ' — ' + extra : ''}`) }
}
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const wxss = read(WXSS)
const wxml = read(WXML)

/** 取某个选择器块里的声明文本（不剥注释，注释也要算"规范还在"） */
const block = (sel) => {
  // 同名选择器可能有多条（后来的覆盖先前的）→ 必须聚合，只看第一条会误判
  // 同名选择器可能有多条，**后写的覆盖先写的** → 只看最后一条才是有效声明
  const re = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`, 'g')
  let out = ''
  let m
  while ((m = re.exec(wxss))) out = m[1]
  return out
}
const BRAND_GOLD = /#C4A76C|var\(--brass-400|var\(--color-primary|var\(--gold/   // 2026-10-15 P2：--gold 已全站改名 --color-primary，两者都认

/* ── ① 规范还在 ─────────────────────────────────────────────────────────── */
check('★ 三级规范注释还在（L1/L2/L3 均写明）',
  /L1 主视觉/.test(wxss) && /L2 支撑/.test(wxss) && /L3 弱化/.test(wxss))
check('规范写明「L1 之外不得出现品牌亮金」', /L1 之外不得出现品牌亮金/.test(wxss))
check('规范指向守卫（改规范要一起改）', /check:detail-visual-tiers/.test(wxss))

/* ── ② 金色收敛（核心不变量） ───────────────────────────────────────────── */
check('★ 价格用品牌金（L1 允许）', BRAND_GOLD.test(block('.num')) || BRAND_GOLD.test(block('.symbol')))
check('★ 一键送礼 CTA 用品牌金（L1 允许）', BRAND_GOLD.test(block('.gift-cta')))
check('★ 场景 chips **不得**用品牌亮金（否则金色通胀）',
  !BRAND_GOLD.test(block('.gift-scene-chip')),
  'chips 又变亮金 → 页面失去重点')
check('品类角标 / 学名 等 L3 不得用品牌亮金',
  !BRAND_GOLD.test(block('.latin-sub')) && !BRAND_GOLD.test(block('.service-item')))

/* ── ③ 层级手法在 ───────────────────────────────────────────────────────── */
check('★ L3 学名有弱化（opacity < 1）', /opacity:\s*0?\.\d+/.test(block('.latin-sub')))
check('★ 信息卡与礼赠面板之间有极细分隔线', /class="card-divider"/.test(wxml) && /\.card-divider\s*\{/.test(wxss))
check('★ 礼赠面板存在（面板不被删）', /class="gift-panel"/.test(wxml))
check('★ 省钱标签用「省 ¥N」而非「N 折」', /tool\.saveLabel\(displayPrice, discountRate\)/.test(wxml))

/* ── 输出 / 自检 ───────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 详情页三级视觉规范检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 详情页三级视觉：${passed} 项通过（规范在 / 金色收敛 / 层级手法在）`)
}

function selftest() {
  const injections = [
    {
      name: '场景 chips 又变亮金（金色通胀）',
      file: WXSS,
      from: '  border-color: rgba(196, 167, 108, 0.26);\n  color: #B9B2A6;',
      to: '  border-color: var(--brass-400);\n  color: var(--brass-400);'
    },
    {
      // 2026-10-15 P2：全站 --gold → --color-primary 后，金色通胀会以新名字出现，BRAND_GOLD 必须认得它
      name: '场景 chips 以 --color-primary 变亮金（新令牌名下的金色通胀）',
      file: WXSS,
      from: '  border-color: rgba(196, 167, 108, 0.26);\n  color: #B9B2A6;',
      to: '  border-color: rgba(196, 167, 108, 0.26);\n  color: var(--color-primary);'
    },
    {
      name: '分隔线被删（两块气场糊在一起）',
      file: WXML,
      from: '      <view class="card-divider" aria-hidden="true"></view>\n',
      to: ''
    },
    {
      name: '学名不再弱化（opacity 去掉）',
      file: WXSS,
      from: '  font-size: 24rpx;\n  opacity: 0.72;',
      to: '  font-size: 24rpx;'
    },
    {
      name: '三级规范注释被删（规范失效）',
      file: WXSS,
      from: 'L3 弱化（最小/最灰）',
      to: '其他层级'
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) { console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`); bad += 1; continue }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) { console.log(`✗ 未能逐字还原：${inj.file}`); bad += 1; continue }
    if (r.status === 0) { console.log(`✗ 注入回归未被检出：${inj.name}`); bad += 1 } else console.log(`  ✓ 已检出：${inj.name}`)
  }
  if (bad) { console.log(`✗ 自检失败：${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
