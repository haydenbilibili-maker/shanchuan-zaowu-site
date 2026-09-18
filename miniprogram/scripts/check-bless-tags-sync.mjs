#!/usr/bin/env node
/**
 * 祈运标签（blessTags）一致性守卫（需求 28 · item 6）
 *
 * 背景：同一份**受控枚举**必须同时活在四处，而它们**无法共享代码**：
 *   · `miniprogram/config/blessTags.js`            —— 唯一事实源（C 端页面 / 入口用）
 *   · `miniprogram/cloudfunctions/manageProducts/blessTags.js` —— 云函数副本（写入/管理端查询）
 *   · `miniprogram/cloudfunctions/getBlessProducts/blessTags.js` —— 云函数副本（C 端祈运选品）
 *   · `miniprogram/subpackages/manager/utils/blessTags.js`     —— 小程序管理端副本
 *   · `admin/src/utils/blessTags.js`               —— ERP 副本（独立构建）
 * 没有守卫时只改一处不会被任何检查拦住 → 同一件商品在 ERP 与小程序里会被存成不同标签，
 * 推荐结果因此分叉，而且**两边都不报错**（本仓「白名单静默丢字段」的同一类坑）。
 *
 * 本守卫做四件事：
 *   ① **逐例比对**四个副本的 `sanitizeBlessTags` 输出（含脏值 / 逗号串 / 顺序 / 超限）；
 *   ② 枚举本体一致（key/label/plays/上限，逐字比对）；
 *   ③ 云函数接线：白名单登记 + 写入归一化 + 查询过滤；
 *   ④ 两端表单与 C 端接线：ERP 复选框、小程序 chips、入口带 `bless`、页面按标签重排 + 提示。
 *
 * 用法：
 *   node miniprogram/scripts/check-bless-tags-sync.mjs
 *   node miniprogram/scripts/check-bless-tags-sync.mjs --selftest   # 注入漂移 → 必须检出 → 还原
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const SSOT = 'miniprogram/config/blessTags.js'
const CLOUD = 'miniprogram/cloudfunctions/manageProducts/blessTags.js'
const CLOUD_RECO = 'miniprogram/cloudfunctions/getBlessProducts/blessTags.js'
const RECO_FN = 'miniprogram/cloudfunctions/getBlessProducts/index.js'
const MANAGER = 'miniprogram/subpackages/manager/utils/blessTags.js'
const ADMIN = 'admin/src/utils/blessTags.js'
const CLOUD_FN = 'miniprogram/cloudfunctions/manageProducts/index.js'
const MANAGER_FORM = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
const MANAGER_VIEW = 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml'
const ERP_FORM = 'admin/src/App.vue'
const URL_BUILDER = 'miniprogram/utils/wishWall.js'
const WALL_PAGE = 'miniprogram/subpackages/feature/wish-wall/index.js'
const WALL_VIEW = 'miniprogram/subpackages/feature/wish-wall/index.wxml'

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
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** CJS 副本按真源码跑（副本都是 CJS）；ERP 副本是 ESM，用正则取枚举字面量 */
function loadCjs(file) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', read(file))(module, module.exports)
  return module.exports
}

const ssot = loadCjs(SSOT)
const copies = {
  云函数管理: loadCjs(CLOUD),
  云函数选品: loadCjs(CLOUD_RECO),
  管理端: loadCjs(MANAGER)
}

/* ── ① sanitize 逐例比对 ─────────────────────────────────────────────── */
const CASES = [
  [],
  ['fortune'],
  ['success', 'peace'],
  'fortune,bond',            // 逗号串（URL 参数形态）
  'peace, fortune ,,unknown',// 脏值 + 空格 + 空段
  ['nope', '', null],
  ['fortune', 'fortune'],    // 去重
  ['journey', 'bond', 'study', 'peace'], // 超上限
  null,
  undefined
]
CASES.forEach((input, i) => {
  const want = ssot.sanitizeBlessTags(input)
  Object.entries(copies).forEach(([name, mod]) => {
    const got = mod.sanitizeBlessTags(input)
    check(
      `sanitizeBlessTags 第 ${i + 1} 例：${name}副本与 SSOT 一致`,
      JSON.stringify(got) === JSON.stringify(want),
      `ssot=${JSON.stringify(want)} ${name}=${JSON.stringify(got)}`
    )
  })
})

/* ── ①b 场景兜底逐例比对（存量商品没有显式标签时走这条路） ────────────── */
const RESOLVE_CASES = [
  { blessTags: ['fortune'], giftScenes: ['wedding'] },   // 显式优先
  { giftScenes: ['enrollment', 'wedding'] },             // 场景兜底
  { giftScenes: ['graduation'] },
  { giftScenes: ['nope'] },
  { giftScenes: [] },
  {}
]
RESOLVE_CASES.forEach((input, i) => {
  const want = ssot.resolveBlessTags(input)
  Object.entries(copies).forEach(([name, mod]) => {
    const got = mod.resolveBlessTags(input)
    check(
      `resolveBlessTags 第 ${i + 1} 例：${name}副本与 SSOT 一致`,
      JSON.stringify(got) === JSON.stringify(want),
      `ssot=${JSON.stringify(want)} ${name}=${JSON.stringify(got)}`
    )
  })
})
check(
  '★ 8 个礼赠场景都映射到受控标签（漏一个 = 那类商品推荐不出来）',
  Object.keys(ssot.SCENE_BLESS).length === 8 &&
    Object.values(ssot.SCENE_BLESS).every((k) => ssot.BLESS_TAG_KEYS.includes(k)),
  JSON.stringify(ssot.SCENE_BLESS)
)

/* ── ② 枚举本体一致（key/label/plays/上限/场景映射） ─────────────────── */
const shape = (mod) => JSON.stringify({
  max: mod.MAX_BLESS_TAGS,
  keys: mod.BLESS_TAG_KEYS,
  tags: mod.BLESS_TAGS.map((t) => ({ key: t.key, label: t.label, plays: t.plays })),
  // 场景兜底映射也要同源：它决定"存量商品能不能被推荐出来"（缺一处就等于功能空转）
  sceneBless: mod.SCENE_BLESS,
  blessScenes: mod.BLESS_SCENES
})
Object.entries(copies).forEach(([name, mod]) => {
  check(`枚举本体一致（${name}副本）`, shape(mod) === shape(ssot), shape(mod) === shape(ssot) ? '' : 'key/label/plays/上限有差异')
})
const adminSrc = read(ADMIN)
const adminKeys = [...adminSrc.matchAll(/key: '([a-z]+)',\s*\n\s*label: '([^']+)'/g)].map((m) => `${m[1]}:${m[2]}`)
check(
  'ERP 副本枚举与本文件同源（key:label 逐条一致）',
  JSON.stringify(adminKeys) === JSON.stringify(ssot.BLESS_TAGS.map((t) => `${t.key}:${t.label}`)),
  adminKeys.join(',')
)
check(
  '枚举受控：key 唯一、label 唯一、上限为正且 ≤ 5',
  new Set(ssot.BLESS_TAG_KEYS).size === ssot.BLESS_TAGS.length &&
    new Set(ssot.BLESS_TAGS.map((t) => t.label)).size === ssot.BLESS_TAGS.length &&
    ssot.MAX_BLESS_TAGS > 0 && ssot.MAX_BLESS_TAGS <= 5
)
check(
  '每个标签都点名了玩法（否则这条标签对"玩法推荐"没有作用）',
  ssot.BLESS_TAGS.every((t) => Array.isArray(t.plays) && t.plays.length > 0)
)

/* ── ③ 云函数接线 ────────────────────────────────────────────────────── */
const cloudFn = stripComments(read(CLOUD_FN))
check('云函数副本被真正 require（不是躺在目录里没人用）', /require\('\.\/blessTags'\)/.test(cloudFn))
check('blessTags 进了写入白名单（没登记 = 保存时被静默丢掉）', /'blessTags'/.test(cloudFn) && /ALLOWED_FIELDS/.test(cloudFn))
check('写入时归一化（非法 key 不落库）', /hasOwnProperty\.call\(data, 'blessTags'\)[\s\S]{0,200}?sanitizeBlessTags\(data\.blessTags\)/.test(cloudFn))
check('支持按标签过滤（推荐查询要用）', /blessTag[\s\S]{0,200}?conditions\.push\(\{ blessTags: blessTag \}\)/.test(cloudFn))

/* ── ③b C 端祈运选品函数（item 6 的弱推链路） ─────────────────────────── */
const recoFn = stripComments(read(RECO_FN))
check('选品函数用本目录副本校验标签（不认未受控的 key）',
  /require\('\.\/blessTags'\)/.test(recoFn) && /sanitizeBlessTags\(\[e\.tag/.test(recoFn))
check('选品同时覆盖「显式标签」与「场景兜底」（只查一边 = 存量商品推荐不出来）',
  /blessTags: tag/.test(recoFn) && /giftScenes: _\.in\(scenes\)/.test(recoFn) && /scenesForBless\(tag\)/.test(recoFn))
check('选品有「退一步只查显式标签」的降级（老环境逻辑运算不稳时不至于整条挂掉）',
  (recoFn.match(/collection\('products'\)/g) || []).length >= 2 &&
    /where\(\{ blessTags: tag, isOffShelf: _\.neq\(true\) \}\)/.test(recoFn))
check('选品**不做兜底**（源码里没有"热门/兜底"查询；无命中的行为由 test:wish-wall 实跑断言）',
  !/queryHot/.test(recoFn) && !/orderBy\('sales'/.test(recoFn))
check('选品排序是确定性的（没有随机打乱 → 同一天同一标签结果一致）',
  !/Math\.random/.test(recoFn) && /sortPool/.test(recoFn))
check('★ 推荐依据逐行判定（显式标签=t\|场景兜底=scene）——不许一律标 tag 冒充"同好也在看"',
  /explicitIds\.has\(String\(r\._id\)\) \? 'tag' : 'scene'/.test(recoFn) &&
    !/leanProduct\(r, 'tag'\)\)/.test(recoFn))
const recoUtilSrc = stripComments(read('miniprogram/utils/blessProducts.js'))
// 口径再升级（2026-09-18 细节雕刻）：推荐区标题统一成"这面墙的祈运标签 + 为你配一件"，
// 并且**任何"同好也在看"式的社会证明都不许出现**（系统没有共同浏览数据）。
check('★ 推荐区文案只说真知道的事（这面墙的祈运标签），且页面不写死、不编社会证明',
  /function recoLabel\(blessLabel\)/.test(recoUtilSrc) &&
    /偏「\$\{label\}」· 为你配一件/.test(recoUtilSrc) &&
    !/同好/.test(recoUtilSrc) &&
    // 页面现在写成三元：`{{reco ? reco.label : (…这面墙的藏品…)}}` —— 只看它是否用了这个字段
    /reco\.label/.test(read(WALL_VIEW)))

/* ── ④ 两端表单与 C 端接线 ───────────────────────────────────────────── */
const managerForm = stripComments(read(MANAGER_FORM))
const managerView = stripComments(read(MANAGER_VIEW))
check('小程序管理端：读取 / 归一化 / 保存三处都接了 blessTags',
  /readBlessTags\(item\)/.test(managerForm) &&
    /sanitizeBlessTags\(p\.blessTags\)/.test(managerForm) &&
    /blessTags: \[\]/.test(managerForm))
check('小程序管理端：多选交互与上限提示都在（超限不静默丢选择）',
  /toggleProductBlessTag/.test(managerForm) && /最多选 \$\{MAX_BLESS_TAGS\} 个祈运标签/.test(managerForm))
check('小程序管理端：视图画出了 chips（只写逻辑不画 = 用户点不到）',
  /wx:for="\{\{blessTagOptions\}\}"/.test(managerView) && /toggleProductBlessTag/.test(managerView))

const erpForm = stripComments(read(ERP_FORM))
check('ERP：复选框 + 读回 + 提交三处都接了 blessTags',
  /v-model="form\.blessTags"/.test(erpForm) &&
    /readBlessTags\(item\)/.test(erpForm) &&
    /blessTags: sanitizeBlessTags\(form\.value\.blessTags\)/.test(erpForm))

const urlBuilder = stripComments(read(URL_BUILDER))
const wallPage = stripComments(read(WALL_PAGE))
const wallView = stripComments(read(WALL_VIEW))
check('入口 URL 带祈运标签（bless 参数）', /bless=\$\{encodeURIComponent\(bless\)\}/.test(urlBuilder))
check('入口用 resolveBlessTags（显式优先 + 场景兜底）——存量商品不必先回填',
  /resolveBlessTags\(p\)\.join/.test(urlBuilder) && /require\('\.\.\/config\/blessTags'\)/.test(urlBuilder))
check('页面读 bless 并重排玩法（applyBlessScope）', /applyBlessScope\(opts\.bless\)/.test(wallPage) && /blessPlayIds\(tags\)/.test(wallPage))
// 口径更新（2026-09-18 产品确认）：祈运提示从玩法区**挪进页头**那颗 chip（`blessLabelText`），
// 玩法区不再有 .ww-plays-guide —— 判据跟着口径走，仍然要求"用户真的看得见"
check('页面显示祈运 chip + 商品入口',
  /class="ww-bless"/.test(wallView) && /blessLabelText/.test(wallView) && /bindtap="goProduct"/.test(wallView))

/* ── 汇总 ───────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  // 注入漂移：改 SSOT 的一个 label → 副本一致性必须红
  const target = resolve(ROOT, SSOT)
  const original = readFileSync(target, 'utf8')
  const drifted = original.replace("label: '求安'", "label: '求宁'")
  if (drifted === original) {
    console.error('✗ selftest 无法注入（锚点没找到）')
    process.exit(1)
  }
  let caught = false
  try {
    writeFileSync(target, drifted)
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    caught = run.status !== 0
  } finally {
    writeFileSync(target, original)
  }
  if (!caught) {
    console.error('✗ selftest 失败：改了一处 label，守卫居然没红（判据没接上副本比对）')
    process.exit(1)
  }
  console.log('✓ selftest 通过：注入副本漂移被检出，且已还原源文件')
  process.exit(0)
}

console.log(`祈运标签一致性：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 四处副本同源、云函数接线完整、两端表单可编辑、C 端按标签重排玩法')
