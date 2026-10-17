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
 *   ② 枚举本体一致（key/label/plays/上限，逐字比对）；**且 `plays` 里每个 id 必须真实存在于
 *      `config/ritualPlays.js` 的玩法注册表**（合法集合从注册表现读，不硬编码 ——
 *      写死的 id 列表会在新增玩法时假失败、改名时假通过，本仓 E7 教训）；
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
// 2026-10-17 旧祈福墙退场：祈运标签在 C 端只剩一处消费 —— 今日一签的「为你配一件」推荐（页面工厂读 bless 参数）。
//   旧墙页的页头祈运 chip / 按标签重排玩法随页面下线，相关判据改为守今日一签的读取与推荐出口。
const PLAY_FACTORY = 'miniprogram/subpackages/plays/utils/ritualPlayPage.js'
/**
 * 玩法页（PRD v1.4 §11.4「玩法各开一页」）——推荐行与"写成心愿"从那之后都在这里。
 * 本守卫只关心"用户真的看得见祈运依据与推荐出口"，所以判据目标跟着代码搬。
 */
const PLAY_VIEWS = ['play-qian']
  .map((n) => `miniprogram/subpackages/plays/${n}/index.wxml`)
// 玩法注册表：`plays` 的合法 id 集合**唯一事实源**（本文件不写死任何一个 id）
const PLAYS = 'miniprogram/subpackages/plays/config/ritualPlays.js'

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

/* ── ②b plays 的每个 id 都必须是注册表里真实存在的玩法 ────────────────────
 * 为什么单列一条：`plays` 是**真实消费者**的输入 ——
 * `subpackages/feature/wish-wall/index.js` 的 `blessPlayIds(tags)` 拿它给玩法瓦片排序；
 * 命中不了的 id 会让 `rank()` 恒等于"未命中"，"这条标签先玩哪个"的产品意图**静默失效**
 * （木鱼就是例子：它是页面常驻卡片、根本不是玩法瓦片，放进 plays 结构上永远不可达）。
 *
 * 合法 id 集合从 `config/ritualPlays.js` **现读**，不硬编码：
 * 新增玩法自动合法；玩法改名/删除，这里立即报红。硬编码 `['qian','cookie','zodiac','mbti']`
 * 会在新增玩法时假失败、在改名时假通过（本仓 E7 教训）。
 */
const ritualPlays = loadCjs(PLAYS)
const PLAY_IDS = (ritualPlays.RITUAL_PLAYS || []).map((p) => p.id)
check(
  '玩法注册表可读且非空（plays 判据的事实源；读不到就无从判定）',
  PLAY_IDS.length > 0,
  `RITUAL_PLAYS=${JSON.stringify(PLAY_IDS)}`
)
const badPlayIds = (tags) => {
  const bad = []
  ;(tags || []).forEach((t) => {
    ;(t.plays || []).forEach((id) => {
      if (!PLAY_IDS.includes(id)) bad.push(`${t.key}:${id}`)
    })
  })
  return bad
}
const playSources = [['SSOT', ssot], ...Object.entries(copies).map(([name, mod]) => [`${name}副本`, mod])]
playSources.forEach(([label, mod]) => {
  const bad = badPlayIds(mod.BLESS_TAGS)
  check(
    `plays 里的玩法 id 都存在于玩法注册表（${label}）`,
    bad.length === 0,
    bad.length ? `非法 id: ${bad.join(', ')}（注册表：${PLAY_IDS.join(', ')}）` : ''
  )
})
// ERP 副本是 ESM（不能 require），按既有形态用正则取 plays 字面量
const adminPlays = [...adminSrc.matchAll(/plays:\s*\[([^\]]*)\]/g)].map((m) =>
  [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
)
check(
  'ERP 副本 plays 条数与标签数一致（缺一条会让下面逐条校验错位）',
  adminPlays.length === ssot.BLESS_TAGS.length,
  `ERP=${adminPlays.length} 标签=${ssot.BLESS_TAGS.length}`
)
{
  const bad = []
  adminPlays.forEach((ids, i) => {
    const key = ssot.BLESS_TAG_KEYS[i] || `#${i}`
    ids.forEach((id) => {
      if (!PLAY_IDS.includes(id)) bad.push(`${key}:${id}`)
    })
  })
  check(
    'plays 里的玩法 id 都存在于玩法注册表（ERP 副本）',
    bad.length === 0,
    bad.length ? `非法 id: ${bad.join(', ')}（注册表：${PLAY_IDS.join(', ')}）` : ''
  )
}

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
const recoUtilSrc = stripComments(read('miniprogram/subpackages/plays/utils/blessProducts.js'))
// 口径再升级（2026-09-18 细节雕刻）：推荐区标题统一成"这面墙的祈运标签 + 为你配一件"，
// 并且**任何"同好也在看"式的社会证明都不许出现**（系统没有共同浏览数据）。
check('★ 推荐区文案只说真知道的事（这面墙的祈运标签），且页面不写死、不编社会证明',
  /function recoLabel\(blessLabel\)/.test(recoUtilSrc) &&
    /偏「\$\{label\}」· 为你配一件/.test(recoUtilSrc) &&
    !/同好/.test(recoUtilSrc) &&
    // 页面写成三元：`{{reco ? reco.label : (…这面墙的藏品…)}}` —— 只看它是否用了这个字段。
    // ⚠️ 2026-09-21（§11.4）：推荐行搬到玩法页，扫描面跟着搬（否则"文案口径"这条会挂在旧位置上）。
    PLAY_VIEWS.every((f) => /reco\.label/.test(read(f))))

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
const playFactory = stripComments(read(PLAY_FACTORY))
check('入口 URL 带祈运标签（bless 参数）', /bless=\$\{encodeURIComponent\(bless\)\}/.test(urlBuilder))
check('入口用 resolveBlessTags（显式优先 + 场景兜底）——存量商品不必先回填',
  /resolveBlessTags\(p\)\.join/.test(urlBuilder) && /require\('\.\.\/config\/blessTags'\)/.test(urlBuilder))
// 2026-09-24 P2-6：第二参 productKey 供 wallDefaultBlessTags 兜底；判据允许单参/双参
check('今日一签读 bless 参数（归一化后取首个标签作推荐依据与页头文案）',
  /sanitizeBlessTags\(opts\.bless \|\| ''\)/.test(playFactory) && /blessLabelText:\s*tags\.length \? blessLabel\(tags\[0\]\)/.test(playFactory))
check('今日一签带着 bless 去写心愿 / 推荐按首个标签取（标签不在路上丢）',
  /bless=\$\{encodeURIComponent\(this\.data\.blessTags\.join\(','\)\)\}/.test(playFactory) &&
    /pickReco\(res && res\.result, tag, blessLabel\(tag\)\)/.test(playFactory))
check('今日一签结果页有能点的推荐 / 商品入口',
  PLAY_VIEWS.every((f) => /bindtap="\{\{reco \? 'goRecoProduct' : 'goProduct'\}\}"/.test(read(f))))

/* ── 汇总 ───────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  const runGuard = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  // 每轮：注入 → 子进程跑守卫必须红（且红在指定判据上）→ 还原 → **逐字节**比对
  const INJECTIONS = [
    {
      name: '副本漂移（SSOT 的 label 改一个字）',
      file: SSOT,
      from: "label: '求安'",
      to: "label: '求宁'",
      expect: '枚举本体一致', // 原有判据：副本比对接上即可
      expectAny: false
    },
    {
      name: 'SSOT 的 plays 塞入不存在的玩法 id',
      file: SSOT,
      from: "plays: ['qian', 'cookie']",
      to: "plays: ['not_a_play', 'cookie']",
      expect: 'plays 里的玩法 id 都存在于玩法注册表（SSOT） — 非法 id: fortune:not_a_play'
    },
    {
      // 只改 ERP 副本：它不参与 shape() 逐字比对，所以**只有新判据**能抓到它
      // （这是新判据真的独立生效、而不是被既有副本比对兜住的证明）
      name: 'ERP 副本的 plays 塞入不存在的玩法 id（只有新判据能抓到）',
      file: ADMIN,
      from: "plays: ['qian', 'cookie']",
      to: "plays: ['not_a_play', 'cookie']",
      expect: 'plays 里的玩法 id 都存在于玩法注册表（ERP 副本） — 非法 id: fortune:not_a_play'
    }
  ]
  let allCaught = true
  for (const inj of INJECTIONS) {
    const target = resolve(ROOT, inj.file)
    const original = readFileSync(target, 'utf8')
    const drifted = original.replace(inj.from, inj.to)
    if (drifted === original) {
      console.error(`✗ selftest 无法注入（锚点没找到）：${inj.name}`)
      process.exit(1)
    }
    let run
    try {
      writeFileSync(target, drifted)
      run = runGuard()
    } finally {
      writeFileSync(target, original)
    }
    const output = `${run.stdout || ''}${run.stderr || ''}`
    const detected = run.status !== 0 && (inj.expectAny || output.includes(inj.expect))
    const restored = readFileSync(target, 'utf8') === original
    if (!detected || !restored) {
      allCaught = false
      console.error(
        `✗ selftest 失败：${inj.name}` +
          (detected ? '（注入被检出，但源文件还原后与原字节不一致）' : '（注入没有被守卫检出）')
      )
      console.error(output.split('\n').filter(Boolean).slice(0, 8).map((l) => '    ' + l).join('\n'))
    } else {
      console.log(`✓ selftest：${inj.name} → 已检出且逐字节还原`)
    }
  }
  if (!allCaught) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTIONS.length} 类注入全部被检出，源文件逐字节还原`)
  process.exit(0)
}

console.log(`祈运标签一致性：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 四处副本同源、云函数接线完整、两端表单可编辑、今日一签按标签推荐')
