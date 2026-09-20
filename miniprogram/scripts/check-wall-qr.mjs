#!/usr/bin/env node
/**
 * 祈福墙「门店物料小程序码」守卫（需求 28 · 门店现场转化）
 *
 * 为什么需要它：这张码是**印刷品** —— 印到立牌上就改不了。它的三类失败都**不会报错**：
 *   ① 码指向的页面不在云函数白名单里 → 生成时才发现（或者更糟：生成失败没人知道）；
 *   ② 码里的 `scene` 页面**解析不出来** → 扫码进的是默认墙、来源统计丢失，用户与店员都无感；
 *   ③ 码生成成了一张**空白图** → 印出来才发现（本仓 2026-09-18 刚在"亮码"上栽过一次空白二维码）。
 *
 * 判据分两段：
 *   A. **永远成立**：scene 解析器行为（纯函数，用固定样例）+ 页面接线（用解析器、记录来源）+ 云函数白名单 + CLI 支持写清单；
 *   B. **清单存在时才启用**：`qr-assets/wish-wall-store-qr.json` 一旦存在（说明码已生成），
 *      它的 scene 必须能被页面解析器解析出目标墙、长度 ≤32、PNG 存在且**不是空白图**（尺寸/体积下限）。
 *      —— 这样"生成了码"与"码被验证过"自动绑在一起，不会出现"图有了但没人验"。
 *
 * 用法：
 *   node miniprogram/scripts/check-wall-qr.mjs
 *   node miniprogram/scripts/check-wall-qr.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const WISH_WALL_UTIL = 'miniprogram/utils/wishWall.js'
const WALL_PAGE = 'miniprogram/subpackages/feature/wish-wall/index.js'
const QR_FN = 'miniprogram/cloudfunctions/getStoreQRCode/index.js'
const QR_CLI = 'miniprogram/scripts/generate-store-qr.js'
const MANIFEST = 'miniprogram/scripts/qr-assets/wish-wall-store-qr.json'
const ASSET = 'miniprogram/scripts/qr-assets/wish-wall-store-qr.png'
const PAGE_PATH = 'subpackages/feature/wish-wall/index'
// ── AI 识别码（同一族：门店物料码）2026-09-20 新增：安卓扫识别码落首页的真机反馈 ──
const APP_JS = 'miniprogram/app.js'
const IDENTIFY_MANIFEST = 'miniprogram/scripts/qr-assets/identify-store-qr.json'
const IDENTIFY_ASSET = 'miniprogram/scripts/qr-assets/identify-store-qr.png'
const IDENTIFY_PAGE = 'subpackages/feature/identify/index'
const IDENTIFY_RESULT = 'subpackages/feature/identify/result/index'
/** 微信 scene 上限（超出会被截断成另一串，等于码指向了别的东西） */
const SCENE_MAX = 32
/** 430×430 的空白 PNG 压出来只有几 KB；真实小程序码（含铜色 + 透明底）在几十 KB 量级 */
const MIN_ASSET_BYTES = 8 * 1024

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
// ⚠️ 注释剥离必须**避开正则字面量里的 `\/`**（2026-09-20 实测）：
//    `.replace(/^\//, '')` 里紧跟着的 `//` 会被当成注释起点 → 该行被截断 →
//    一旦把源码交给 new Function 求值就 SyntaxError（校验台保真度缺陷，不是产品缺陷）。
//    故注释起点要求前一个字符既不是 `:`（https://）也不是 `\`（转义斜杠）。
const stripComments = (t) => String(t)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')

/** 直接跑真源码的纯函数（CJS） */
function loadCjs(file) {
  const module = { exports: {} }
  const dir = file.slice(0, file.lastIndexOf('/'))
  const localRequire = (id) => {
    if (!String(id).startsWith('.')) throw new Error('unexpected require ' + id)
    const stack = []
    for (const part of `${dir}/${id}`.split('/')) {
      if (part === '.' || part === '') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    let rel = stack.join('/')
    if (!rel.endsWith('.js')) rel += '.js'
    return loadCjs(rel)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', read(file))(module, module.exports, localRequire)
  return module.exports
}

const wish = loadCjs(WISH_WALL_UTIL)

/* ── A. 永远成立的那部分 ─────────────────────────────────────────────── */
const CASES = [
  ['from=store_qr&k=mashangyou', 'store_qr', 'mashangyou'],
  ['from%3Dstore_qr%26k%3Dmashangyou', 'store_qr', 'mashangyou'], // wxacode 会做一次 URL 编码
  ['k=ma-shang-you&from=counter', 'counter', 'ma-shang-you'],
  ['from=store_qr', 'store_qr', ''],
  ['nope=1', '', ''],
  ['', '', '']
]
CASES.forEach(([scene, from, key]) => {
  const got = wish.parseWishWallScene(scene)
  check(
    `scene 解析：${scene || '(空)'} → from=${from || '(空)'} key=${key || '(空)'}`,
    got && got.from === from && got.productKey === key,
    JSON.stringify(got)
  )
})
check(
  'scene 解析不抛、不猜（null/数字/超长都不炸）',
  wish.parseWishWallScene(null).from === '' &&
    wish.parseWishWallScene(123).productKey === '' &&
    wish.parseWishWallScene('k='.repeat(40)).productKey === ''
)

const pageSrc = stripComments(read(WALL_PAGE))
check(
  '页面用同一个解析器处理 scene（不是各写一套正则）',
  /parseWishWallScene\(opts\.scene\)/.test(pageSrc) && /fromScene\.productKey/.test(pageSrc)
)
check(
  'scene 只在显式参数缺失时生效（普通 URL 入口不被抢）',
  /normalizeProductKey\(opts\.productKey \|\| fromScene\.productKey\)/.test(pageSrc) &&
    /String\(opts\.from \|\| fromScene\.from \|\| 'direct'\)/.test(pageSrc)
)
check(
  '门店来源进埋点（否则"现场扫码"与线上入口分不开）',
  /entryFrom:/.test(pageSrc) && /trackBehavior\('wish_wall_enter', 'from', this\.data\.entryFrom\)/.test(pageSrc)
)

const qrFn = stripComments(read(QR_FN))
check(
  '祈福墙页面在云函数白名单里（不在 → 生成时直接失败）',
  new RegExp(`'${PAGE_PATH}':\\s*true`).test(qrFn),
  PAGE_PATH
)
check(
  '云函数仍强制 scene 非空 + 白名单校验（安全边界没被这次改动松掉）',
  /if \(!ALLOWED_PAGES\[page\]\)/.test(qrFn) && /if \(!scene\)/.test(qrFn)
)
check('生成脚本支持写侧车清单（--manifest），守卫才有可对账的"这张码是什么"',
  /manifest: args\.manifest/.test(read(QR_CLI)) && /manifestPath/.test(read(QR_CLI)))
// ★ 这条流水线会让人把 AppSecret 写进 scripts/.env.qr —— 那个文件必须真的被忽略。
// （2026-09-18 核查：miniprogram/.gitignore 里已有该规则，但脚本注释让人以为"随便写没事"，
//   所以把"必须被忽略"变成判据，避免哪天规则被删掉却没人发现。）
const ignoreSources = ['.gitignore', 'miniprogram/.gitignore']
  .filter((f) => existsSync(resolve(ROOT, f)))
  .map((f) => read(f))
  .join('\n')
check('★ 存 AppSecret 的 scripts/.env.qr 在 .gitignore 里（写进去不会被提交）',
  /^\s*scripts\/\.env\.qr\s*$/m.test(ignoreSources) ||
    /^\s*\/?miniprogram\/scripts\/\.env\.qr\s*$/m.test(ignoreSources))

/* ── B. 码生成之后才启用的那部分 ─────────────────────────────────────── */
const manifestAbs = resolve(ROOT, MANIFEST)
const assetAbs = resolve(ROOT, ASSET)
if (!existsSync(manifestAbs)) {
  console.log('· 还没有生成门店码（缺 qr-assets/wish-wall-store-qr.json）——只校验 A 段不变量')
} else {
  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(manifestAbs, 'utf8'))
  } catch (e) {
    check('侧车清单是可解析的 JSON', false, e.message)
  }
  if (manifest) {
    check('清单里的 page 就是祈福墙', manifest.page === PAGE_PATH, String(manifest.page))
    check(
      `scene 长度 ≤ ${SCENE_MAX}（微信上限，超了会被截断成另一串）`,
      String(manifest.scene || '').length > 0 && String(manifest.scene || '').length <= SCENE_MAX,
      `${String(manifest.scene || '').length} 字符：${manifest.scene}`
    )
    const parsed = wish.parseWishWallScene(manifest.scene)
    check(
      '★ 清单里的 scene 能被页面解析器解出目标墙（解不出 = 扫码进错墙、来源丢失）',
      parsed.from === 'store_qr' && !!parsed.productKey,
      JSON.stringify(parsed)
    )
    check('清单宽度在云函数允许区间（280–1280）', Number(manifest.width) >= 280 && Number(manifest.width) <= 1280, String(manifest.width))

    check('PNG 资产存在（清单在、图不在 = 物料没落地）', existsSync(assetAbs), ASSET)
    if (existsSync(assetAbs)) {
      const buf = readFileSync(assetAbs)
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      check('资产是 PNG（否则打印/排版环节会出问题）', isPng, `前 4 字节 ${buf.slice(0, 4).toString('hex')}`)
      if (isPng) {
        // IHDR：宽高在固定偏移上（大端 32 位）—— 不引第三方库也能读
        const w = buf.readUInt32BE(16)
        const h = buf.readUInt32BE(20)
        check(`资产尺寸 = 清单里的宽度（${w}×${h}）`, w === Number(manifest.width) && h === Number(manifest.width), `${w}×${h}`)
      }
      check(
        `★ 资产不是空白图（体积 ≥ ${Math.round(MIN_ASSET_BYTES / 1024)}KB；空白码印出去才发现）`,
        statSync(assetAbs).size >= MIN_ASSET_BYTES,
        `${statSync(assetAbs).size}B`
      )
    }

    // 打印版（白底 JPG）：深色立牌与黑白打印要用它。与既有 -white.jpg 同规格（430×430 JPEG）。
    // 码是印刷品 —— "主图在、打印版丢了" 同样会让门店拿到不能用的物料。
    const whiteAbs = resolve(ROOT, ASSET.replace(/\.png$/, '-white.jpg'))
    check('打印版白底 JPG 存在（深色立牌/黑白打印用）', existsSync(whiteAbs), ASSET.replace(/\.png$/, '-white.jpg'))
    if (existsSync(whiteAbs)) {
      const wbuf = readFileSync(whiteAbs)
      const isJpg = wbuf.length > 3 && wbuf[0] === 0xff && wbuf[1] === 0xd8 && wbuf[2] === 0xff
      check('打印版是 JPEG（与既有 -white.jpg 同规格）', isJpg, `前 3 字节 ${wbuf.slice(0, 3).toString('hex')}`)
    }
  }
}

/* ── 汇总 ─────────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  // 注入：把祈福墙从云函数白名单里拿掉 → 守卫必须红
  const target = resolve(ROOT, QR_FN)
  const original = readFileSync(target, 'utf8')
  const drifted = original.replace(`  '${PAGE_PATH}': true, // 祈福墙（门店现场扫码落愿；scene: from=store_qr&k=<墙key>）\n`, '')
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
    console.error('✗ selftest 失败：把祈福墙踢出白名单，守卫居然没红')
    process.exit(1)
  }
  // 第二条注入：把**所有** .gitignore 里的密钥文件规则删掉 → 守卫必须红
  // ⚠️ 第一版只改 miniprogram/.gitignore，而根 .gitignore 也有同名规则 → 判据仍然满足、注入没被检出。
  // 注入必须打到"判据真正读取的全部来源"，否则就是一条假自检。
  const ignoreTargets = ['.gitignore', 'miniprogram/.gitignore']
    .map((f) => resolve(ROOT, f))
    .filter((f) => existsSync(f))
  const backups = ignoreTargets.map((f) => ({ f, text: readFileSync(f, 'utf8') }))
  // ⚠️ 必须带 g：同一条规则在根 .gitignore 里有两行（scripts/.env.qr 与 miniprogram/scripts/.env.qr），
  // 不带 g 只删第一行，第二行仍满足判据 → 注入"没被检出"（自检自己抓到的第二个假自检）
  const stripped = backups.map((b) => ({ f: b.f, text: b.text.replace(/^\s*(?:miniprogram\/)?scripts\/\.env\.qr\s*$/gm, '') }))
  if (stripped.every((x, i) => x.text === backups[i].text)) {
    console.error('✗ selftest 第二条无法注入（.gitignore 锚点没找到）')
    process.exit(1)
  }
  let caught2 = false
  try {
    stripped.forEach((x) => writeFileSync(x.f, x.text))
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    caught2 = run.status !== 0
  } finally {
    backups.forEach((b) => writeFileSync(b.f, b.text))
  }
  if (!caught2) {
    console.error('✗ selftest 失败：删掉 .env.qr 的忽略规则，守卫居然没红（AppSecret 可能被提交）')
    process.exit(1)
  }
  // 第三条：拆掉识别码兜底路由（安卓热启动再次落首页）
  const appAbs = resolve(ROOT, APP_JS)
  const appBackup = readFileSync(appAbs, 'utf8')
  const appStripped = appBackup.replace('    this.maybeOpenIdentifyEntry(options);\n', '')
  if (appStripped === appBackup) {
    console.error('✗ selftest 第三条无法注入（app.js onShow 锚点没找到）')
    process.exit(1)
  }
  let caught3 = false
  try {
    writeFileSync(appAbs, appStripped)
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    caught3 = run.status !== 0
  } finally {
    writeFileSync(appAbs, appBackup)
  }
  if (!caught3) {
    console.error('✗ selftest 失败：拆掉识别码兜底路由，守卫居然没红（安卓扫码又会落首页）')
    process.exit(1)
  }

  // 第四条：识别码清单指到一个未登记的页面（扫码 404 → 落首页）
  const imAbs2 = resolve(ROOT, IDENTIFY_MANIFEST)
  if (existsSync(imAbs2)) {
    const imBackup = readFileSync(imAbs2, 'utf8')
    const imBad = imBackup.replace('"page": "subpackages/feature/identify/index"', '"page": "subpackages/feature/identify/old-index"')
    let caught4 = false
    try {
      writeFileSync(imAbs2, imBad)
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
      caught4 = run.status !== 0
    } finally {
      writeFileSync(imAbs2, imBackup)
    }
    if (!caught4) {
      console.error('✗ selftest 失败：清单 page 改成未登记路径，守卫居然没红')
      process.exit(1)
    }
  }
  // 第五条：去掉 getEnterOptionsSync 兜底（安卓热启动会再落首页）
  const appBackup2 = readFileSync(appAbs, 'utf8')
  // 两个入口函数**都**去掉才叫"兜底被删"（只删一个会被另一个的正则掩护过去 —— 改前就是这样）
  const appNoEnter = appBackup2
    .split('if (sceneOf(opts) == null && typeof wx.getEnterOptionsSync === \'function\') {')
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf('\n      }\n') + 9)))
    .join('')
  if (appNoEnter === appBackup2) {
    console.error('✗ selftest 第五条无法注入（getEnterOptionsSync 锚点没找到）')
    process.exit(1)
  }
  let caught5 = false
  try {
    writeFileSync(appAbs, appNoEnter)
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    caught5 = run.status !== 0
  } finally {
    writeFileSync(appAbs, appBackup2)
  }
  if (!caught5) {
    console.error('✗ selftest 失败：去掉 getEnterOptionsSync 兜底，守卫居然没红')
    process.exit(1)
  }
  console.log('✓ selftest 通过：注入「页面不在白名单」「密钥文件不再被忽略」「拆掉识别码兜底路由」「清单 page 未登记」「去掉热启动 scene 兜底」均被检出，且已还原源文件')
  process.exit(0)
}

/* ── C. AI 识别码入口（2026-09-20：iOS 正常、安卓扫码落首页）──────────
 * 真机反馈的现象是"扫码后停在首页"。可核的事实：生成侧参数**都对**（页面在白名单、
 * checkPath=false、envVersion 默认 release），识别页路径也从未搬过家 —— 所以问题在**入口路由**：
 *   ① 小程序在后台时扫码（热启动），部分安卓机只把小程序切到前台、不重走码里指定的页面；
 *   ② 任何路径解析不到都会走 onPageNotFound，而那里**原先一律 goHome（落首页）**。
 * 下面既钉"兜底路由存在且行为正确"，也钉"印刷码指向的页面在当前版本里必须解析得到"。 */
{
  const appSrc = stripComments(read(APP_JS))
  const calls = { relaunch: [], switched: [] }
  let captured = null
  // ⚠️ 必须传 `require` 桩：app.js 顶层就 require 了 4 个模块，不传会让 Node 走进
  //    "require() + 模块格式嗅探" 分支并抛 ERR_AMBIGUOUS_MODULE_SYNTAX（与祈福墙守卫同款坑）。
  const appRequire = (id) => {
    const k = String(id)
    if (k.includes('cloudEnv')) return { CLOUD_ENV: 'test-env' }
    if (k.includes('cloudHealth')) return { checkCloudHealth: () => {}, notifyCloudHealthFailure: () => {} }
    return {}
  }
  // eslint-disable-next-line no-new-func
  new Function('App', 'wx', 'getCurrentPages', 'require', appSrc)(
    (cfg) => { captured = cfg },
    {
      reLaunch: ({ url }) => calls.relaunch.push(url),
      switchTab: ({ url }) => calls.switched.push(url),
      navigateTo: () => {}, showToast: () => {}, getSystemInfoSync: () => ({}),
      cloud: { database: () => ({}), callFunction: () => Promise.resolve({ result: {} }) },
      onError: () => {}
    },
    () => [{ route: 'pages/index/index' }],
    appRequire
  )
  check('app.js 能被加载（App 配置已捕获）', !!captured && typeof captured.maybeOpenIdentifyEntry === 'function')
  // ★ 接线断言：方法存在 ≠ 真的被调用（第一版判据只驱动了方法本身，
  //   注入"拆掉 onShow 里那行"检不出 —— 自检抓到的判据漏洞，已补）
  check('★ onShow 真的调用了识别码兜底路由（方法在但没接线 = 等于没写）',
    /onShow\(options\)[\s\S]{0,400}?this\.maybeOpenIdentifyEntry\(options\)/.test(appSrc))

  const drive = (options) => {
    calls.relaunch.length = 0
    const ctx = Object.assign(Object.create(null), captured)
    ctx._identifyEntryKey = ''
    ctx.maybeOpenIdentifyEntry(options)
    return new Promise((r) => setTimeout(() => r(calls.relaunch.slice()), 700))
  }
  if (captured && typeof captured.maybeOpenIdentifyEntry === 'function') {
    const storeHit = await drive({ query: { scene: 'from=store_qr' } })
    check('★ 门店识别码（scene=from=store_qr）→ 兜底跳到识别页',
      storeHit.length === 1 && storeHit[0].indexOf('/subpackages/feature/identify/index') === 0, JSON.stringify(storeHit))
    const rid = 'a1b2c3d4e5f60718293a4b5c'
    const posterHit = await drive({ query: { scene: rid } })
    check('★ 分享海报码（scene=记录 id）→ 兜底跳到识别结果页',
      posterHit.length === 1 && posterHit[0].indexOf('/subpackages/feature/identify/result/index') === 0, JSON.stringify(posterHit))
    const cold = await drive({ path: IDENTIFY_PAGE, query: { scene: 'from=store_qr' } })
    check('冷启动入口就是识别页时**不再重复跳**（避免二次加载/重复埋点）', cold.length === 0, JSON.stringify(cold))
    const other = await drive({ query: { scene: 's3' } })
    check('非识别类 scene 不受影响（图鉴 spot 仍走原路径）', other.length === 0, JSON.stringify(other))
  }

  check('★ onPageNotFound 对识别类路径**回识别页**而不是落首页',
    /if \(\/identify\/i\.test\(rawPath\)\)/.test(appSrc)
    && /identify\/index\?from=/.test(appSrc))
  const goHomeAt = appSrc.indexOf('goHome()')
  check('识别分支出现在 goHome 兜底**之前**（否则等于没写）',
    goHomeAt === -1 || appSrc.indexOf('/identify/i.test(rawPath)') < goHomeAt)

  /* ★ 热启动兜底：**逐个入口路由**判，不看整份 app.js。
   * ⚠️ 原来只看 `/getEnterOptionsSync/.test(appSrc)` —— 自检里"去掉某个入口的兜底"因此**判不出来**
   *   （另一个入口还有同一个调用，整文件级正则照样命中）。
   *   这不是判据洁癖：安卓热启动时 `onShow` 的 options 可能是**旧的**，缺兜底的入口在那个物料上
   *   就是"iOS 能用、安卓不行"（2026-09-20 产品负责人报的正是这一类）。
   *
   * 路由清单**从 app.js 派生**（不写死名单）：凡读入口 scene 的 App 方法都算 ——
   *   `sceneOf(` 或任何 `*.scene`。只认 `sceneOf(` 会漏掉自己内联解析的那种
   *   （图鉴 spot 路由就是这样漏掉的，它今天也补上了兜底）。
   * 排除生命周期钩子（onLaunch/onShow/onPageNotFound… 它们**转发** options，不自己解析物料）。 */
  {
    const LIFECYCLE = new Set(['onLaunch', 'onShow', 'onHide', 'onError', 'onPageNotFound', 'onUnhandledRejection', 'onUncaughtException', 'onThemeChange', 'onMemoryWarning'])
    const nameRe = /\n  ([a-zA-Z_][\w]*)\(([^)]*)\) \{/g
    const marks = []
    let m
    while ((m = nameRe.exec(appSrc))) marks.push({ name: m[1], at: m.index })
    const routers = []
    for (let i = 0; i < marks.length; i += 1) {
      const body = appSrc.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : appSrc.length)
      if (LIFECYCLE.has(marks[i].name)) continue
      if (/sceneOf\(|\.scene\b/.test(body)) routers.push({ name: marks[i].name, body })
    }
    check('★ 入口路由清单能从 app.js 派生（至少 3 个读入口 scene 的方法）',
      routers.length >= 3, `派生到：${routers.map((r) => r.name).join(', ') || '(空)'}`)
    // 兜底可以**自己调** `wx.getEnterOptionsSync()`，也可以**委托**给会话层的 `getEnterSceneText()`
    //   —— 但委托必须是真的：那条 helper 自己也得调 `getEnterOptionsSync`（否则判据会被"委托"绕过）。
    const sessionSrc = stripComments(readFileSync(resolve(ROOT, 'miniprogram/utils/analytics/session.js'), 'utf8'))
    const helperCovers = /getEnterOptionsSync/.test(sessionSrc)
    check('★ 会话层 getEnterSceneText() 自己就带热启动兜底（委托型入口靠它）',
      helperCovers, 'session.js 里没有 getEnterOptionsSync —— 委托型入口的兜底是假的')
    for (const r of routers) {
      const direct = /getEnterOptionsSync/.test(r.body)
      const delegated = /getEnterSceneText\(/.test(r.body)
      check(`★★ ${r.name} 自带热启动兜底（直接调 getEnterOptionsSync，或委托 getEnterSceneText）`,
        direct || (delegated && helperCovers),
        '该入口缺兜底 —— 安卓热启动时这一步会丢 scene（"iOS 能用、安卓不行"）')
    }
  }

  const qrFn2 = stripComments(read(QR_FN))
  check('★ 门店码云函数把 envVersion 钉成 release 白名单（印 trial/develop 码 = 没装那版的设备扫码落首页）',
    /\['release', 'trial', 'develop'\]\.includes\(event && event\.envVersion\)/.test(qrFn2)
    && /:\s*'release'/.test(qrFn2))
  check('★ 门店码云函数 checkPath:false（页面未随版本发布时也能生成，交由入口兜底路由接住）',
    /checkPath:\s*false/.test(qrFn2))

  const cli = stripComments(read(QR_CLI))
  check('CLI 默认 page = 识别页 / scene = from=store_qr（印出去的默认口径）',
    /args\.page \|\| 'subpackages\/feature\/identify\/index'/.test(cli)
    && /args\.scene \|\| 'from=store_qr'/.test(cli))
  check('CLI 传 check_path:false + env_version（与云函数同口径）',
    /check_path:\s*false/.test(cli) && /env_version:\s*opts\.envVersion/.test(cli))

  // 印刷码清单：印刷品改不了，必须留下"它指向哪"的可核对记录
  const imAbs = resolve(ROOT, IDENTIFY_MANIFEST)
  const iaAbs = resolve(ROOT, IDENTIFY_ASSET)
  if (!existsSync(imAbs)) {
    check('★ 识别码侧车清单存在（印出去的码必须能对账指向哪一页）', false, IDENTIFY_MANIFEST)
  } else {
    const im = JSON.parse(readFileSync(imAbs, 'utf8'))
    check('识别码清单 page = 识别页', im.page === IDENTIFY_PAGE, String(im.page))
    check('★ 识别码 page 必须**已登记在 app.json**（未登记 = 扫码 404 → 落首页）',
      (() => {
        const app = JSON.parse(read(APP_JS.replace('app.js', 'app.json')))
        const set = new Set(app.pages || [])
        ;(app.subPackages || app.subpackages || []).forEach((sp) => {
          const root = String(sp.root || '').replace(/\/$/, '')
          ;(sp.pages || []).forEach((pg) => set.add(root + '/' + pg))
        })
        return set.has(im.page)
      })(), String(im.page))
    check('识别码清单 envVersion = release（trial/develop 码在正式版设备上会回落首页）',
      im.envVersion === 'release', String(im.envVersion))
    check('识别码 scene 非空且 ≤ 32', String(im.scene || '').length > 0 && String(im.scene || '').length <= SCENE_MAX, String(im.scene))
    check('识别码 scene 含 from=store_qr（页面据此记来源）', /from=store_qr/.test(String(im.scene || '')))
    check('识别码资产存在且为 PNG', existsSync(iaAbs) && readFileSync(iaAbs).slice(1, 4).toString('hex') === '504e47', IDENTIFY_ASSET)
    if (existsSync(iaAbs)) {
      check(`★ 识别码资产不是空白图（≥ ${Math.round(MIN_ASSET_BYTES / 1024)}KB）`,
        statSync(iaAbs).size >= MIN_ASSET_BYTES, `${statSync(iaAbs).size}B`)
    }
    check('回填清单标了 provenance（不许把回填冒充生成时记录）',
      !!im.provenance && /backfill/i.test(String(im.provenance)), String(im.provenance))
  }
}

console.log(`祈福墙门店码：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ scene 解析 / 页面接线 / 白名单 / 清单与资产校验全部通过')
