/**
 * 主题名（双层命名）守卫
 *
 * 背景：藏品名称过于常规、缺场景感；但 `title` 同时承担检索 / 识别 / 对账，
 * 直接改成文艺名会「搜不到、认不出、对账对不上」→ 采用**双层命名**：
 *   `title` = 标准名（不动）；`themeName` = 文艺主题名（详情/礼赠主视觉、列表副行）；`themeNote` = 一句话点题。
 *
 * 本守卫钉住四件容易静默失效的事：
 *   ① **字段贯通**：`manageProducts` 的字段白名单是**静默**的（不登记 = 保存时字段被丢掉、界面还提示"已保存"）
 *      → 两个字段必须在白名单里，且服务端有纪律清洗；
 *   ② **命名纪律**（行为级，直接跑云函数里的真源码）：2–8 汉字、禁流行语/品牌/名人、批内去重、
 *      与标准名重复者剔除、最多 5 个；
 *   ③ **只建议不覆盖**：一键补齐只弹候选选择器，**不得**把 AI 结果直接写进 themeName；
 *   ④ **展示口径**：详情与礼赠以 themeName 为主视觉、title 降为副行，且礼赠链路把字段透传下来。
 *
 * 用法：
 *   node miniprogram/scripts/test-product-theme-name.mjs
 *   node miniprogram/scripts/test-product-theme-name.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const MP = 'miniprogram/'
const MANAGE = MP + 'cloudfunctions/manageProducts/index.js'
const ASSIST = MP + 'cloudfunctions/assistProductCopy/index.js'
const MANAGER_JS = MP + 'subpackages/manager/manager/managerPageConfig.js'
const MANAGER_WXML = MP + 'subpackages/manager/manager/workspace/_subviews.wxml'
const DETAIL_WXML = MP + 'subpackages/feature/detail/index.wxml'
const HUB_WXML = MP + 'subpackages/feature/gift/hub/index.wxml'
const HUB_JS = MP + 'subpackages/feature/gift/hub/index.js'
const GIFT_FN = MP + 'cloudfunctions/getGiftSceneProducts/index.js'

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
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const manage = stripComments(read(MANAGE))
const assistSrc = read(ASSIST)
const managerJs = stripComments(read(MANAGER_JS))
const managerWxml = read(MANAGER_WXML)
const detailWxml = read(DETAIL_WXML)
const hubWxml = read(HUB_WXML)
const hubJs = stripComments(read(HUB_JS))
const giftFn = stripComments(read(GIFT_FN))

/* ── ① 字段贯通（静默丢字段是这套白名单的老问题） ───────────────────────── */
check("★ manageProducts 白名单含 'themeName'/'themeNote'（漏登记 = 保存时静默丢字段）",
  /'themeName', 'themeNote'/.test(manage), '字段未登记进白名单')
check('★ 服务端清洗 themeName（2–8 汉字，不合规丢弃）',
  /\^\[\\u4e00-\\u9fa5\]\{2,8\}\$/.test(manage) && /data\.themeName = .* : ''/.test(manage),
  '缺少服务端纪律兜底')
check('服务端清洗 themeNote（截 40 字）', /data\.themeNote = String\(data\.themeNote \|\| ''\)\.trim\(\)\.slice\(0, 40\)/.test(manage))

/* ── ② 命名纪律（行为级：直接跑云函数里的真源码） ─────────────────────── */
{
  const pick = (name) => {
    const m = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(assistSrc)
    return m ? m[0] : null
  }
  const banned = /const THEME_NAME_BANNED = \[[^\]]*\]/.exec(assistSrc)
  const fns = [banned && banned[0], pick('isValidThemeName'), pick('normalizeThemeCandidates')].filter(Boolean)
  check('能从云函数取出纪律真源码（守卫不是空转）', fns.length === 3, `取到 ${fns.length}/3`)
  if (fns.length === 3) {
    // eslint-disable-next-line no-new-func
    const mod = new Function(`${fns.join('\n')}; return { isValidThemeName, normalizeThemeCandidates }`)()
    eq('「时间的守卫者」合规', mod.isValidThemeName('时间的守卫者'), true)
    eq('「双宿双飞」合规', mod.isValidThemeName('双宿双飞'), true)
    eq('含字母/数字不合规', mod.isValidThemeName('time守卫者'), false)
    eq('超 8 字不合规', mod.isValidThemeName('这是一个非常非常长的主题名字'), false)
    eq('单字不合规', mod.isValidThemeName('蝶'), false)
    eq('含流行语不合规', mod.isValidThemeName('绝绝子守卫者'), false)
    eq('空值不合规', mod.isValidThemeName(''), false)
    const out = mod.normalizeThemeCandidates([
      { themeName: '双宿双飞', note: '两蝶成对', scenes: ['wedding'] },
      { themeName: '双宿双飞', note: '重复项', scenes: [] },
      { themeName: 'bad name', note: '', scenes: [] },
      { themeName: '时间的守卫者', note: '', scenes: ['anniversary'] }
    ], '大蓝闪蝶贝壳钟表')
    eq('去重后剩 2 个', out.length, 2)
    eq('保持顺序', out.map((c) => c.themeName).join(','), '双宿双飞,时间的守卫者')
    eq('与标准名重复者被剔除',
      mod.normalizeThemeCandidates([{ themeName: '大蓝闪蝶' }], '大蓝闪蝶贝壳钟表').length, 0)
    eq('最多 5 个',
      mod.normalizeThemeCandidates(Array.from({ length: 9 }, (_, i) => ({ themeName: `主题名称${'甲乙丙丁戊己庚辛'[i]}` })), '').length, 5)
  }
}

/* ── ③ 只建议不覆盖 ────────────────────────────────────────────────────── */
check('★ 一键补齐后弹「候选选择器」而不是直接写入',
  /this\.pickThemeNameCandidate\(/.test(managerJs))
check('★ 不得把 AI 返回直接写进 themeName（只能由挑选器写）',
  !/'tempProduct\.themeName':\s*d\./.test(managerJs) && /'tempProduct\.themeName': picked\.themeName/.test(managerJs),
  'AI 结果被自动覆盖 → 名称属于产品判断，必须由人挑选')
check('候选带场景标签（与场景口径合流）', /SCENE_LABEL/.test(managerJs) && /scenes/.test(managerJs))
check('表单可编辑两个字段（否则运营改不了）',
  /data-field="themeName"/.test(managerWxml) && /data-field="themeNote"/.test(managerWxml))

/* ── ④ 展示口径与透传 ──────────────────────────────────────────────────── */
check('★ 详情页：themeName 主视觉 + title 降为副行',
  /class="title-theme"[\s\S]{0,80}product\.themeName/.test(detailWxml)
  && /class="title-main \{\{product\.themeName \? 'is-sub' : ''\}\}"/.test(detailWxml),
  '详情页未按双层命名展示')
check('★ 礼赠卡：themeName 主视觉 + title 副行',
  /class="product-theme"[\s\S]{0,80}item\.themeName/.test(hubWxml)
  && /class="product-title \{\{item\.themeName \? 'is-sub' : ''\}\}"/.test(hubWxml))
check('★ 详情页展示题记 themeNote（带主题名时才显示）',
  /class="title-theme-note"[^>]*product\.themeNote/.test(detailWxml))
check('★ 礼赠卡展示题记 themeNote', /class="product-theme-note"[^>]*item\.themeNote/.test(hubWxml))
check('★ 礼赠链路透传 themeName（云函数 leanProduct）', /themeName: row\.themeName \|\| ''/.test(giftFn))
check('★ 礼赠页映射带上 themeName', /themeName: p\.themeName \|\| ''/.test(hubJs))

/* ── 输出 / 自检 ───────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 主题名（双层命名）检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 主题名（双层命名）：${passed} 项通过（字段贯通 / 命名纪律 / 只建议不覆盖 / 展示口径与透传）`)
}

function selftest() {
  const injections = [
    {
      name: '白名单丢掉 themeName（保存时静默丢字段）',
      file: MANAGE,
      from: "'themeName', 'themeNote'",
      to: "'themeNameOnly'"
    },
    {
      name: '命名纪律放宽（允许字母数字）',
      file: ASSIST,
      from: 'if (!/^[\\u4e00-\\u9fa5]{2,8}$/.test(t)) return false',
      to: 'if (!/^.{2,12}$/.test(t)) return false'
    },
    {
      name: '禁词表被清空（流行语又会通过）',
      file: ASSIST,
      from: "const THEME_NAME_BANNED = ['网红', '爆款', '绝绝子', '爱豆', '明星', '同款', '平替', '秒杀', '限量抢']",
      to: 'const THEME_NAME_BANNED = []'
    },
    {
      name: '一键补齐改成直接覆盖 themeName（绕过人的判断）',
      file: MANAGER_JS,
      from: '      this.pickThemeNameCandidate(Array.isArray(d.nameCandidates) ? d.nameCandidates : []);',
      to: "      this.setData({ 'tempProduct.themeName': d.themeName || '' });"
    },
    {
      name: '详情页退回只显示标准名',
      file: DETAIL_WXML,
      // ⚠️ 2026-09-18 锚点随源码更新：详情页把「题记」挪到了标准名**之后**
      // （原来是 主题名 → 题记 → 标准名，现在 主题名 → 标准名 → 题记）。
      // 注入的**意图不变**：去掉主题名与题记，只剩标准名 —— 若页面还能显示主题名，说明它另有来源。
      from: `        <text class="title-theme" wx:if="{{product.themeName}}">{{product.themeName}}</text>
        <!-- 题记：与主题名配套的一句话（送礼时它比四字名更打动人） -->
        <text class="title-main {{product.themeName ? 'is-sub' : ''}}">{{product.title}}</text>
        <text class="title-theme-note" wx:if="{{product.themeName && product.themeNote}}">{{product.themeNote}}</text>`,
      to: `        <text class="title-main">{{product.title}}</text>`
    },
    {
      name: '详情页丢掉题记（只剩四字名）',
      file: DETAIL_WXML,
      from: `        <text class="title-theme-note" wx:if="{{product.themeName && product.themeNote}}">{{product.themeNote}}</text>`,
      to: ''
    },
    {
      name: '礼赠链路不再透传 themeName',
      file: GIFT_FN,
      from: "    themeName: row.themeName || '',\n",
      to: ''
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
