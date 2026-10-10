#!/usr/bin/env node
/**
 * 站内信 / 分享「旧路径重映射」落点守卫
 *
 * 为什么需要（2026-09-16）：
 *   `utils/messageHelper.js` 的 `remapLegacyPageUrl()` 负责把**历史遗留路径**
 *   （`/pages/xxx`，写进了已发出的订阅消息、站内信、分享卡片里）映射到现在的分包页面。
 *   它靠 `FEATURE_LEGACY_PREFIXES` / `BUSINESS_LEGACY_PREFIXES` 两个前缀表 +
 *   一段字符串拼接生成目标路径：
 *
 *     mapped = `/subpackages/feature${url.slice('/pages'.length)}`
 *
 *   **这个拼接出的目标和 app.json 的注册页没有任何编译期校验** —— 一旦页面被搬迁
 *   （例如 `feature/user/*` → `extra/user/*`），拼接结果就指向不存在的页面，
 *   用户点通知/点消息时表现为「点击无效」，而且**静态扫描 navigation 调用点也扫不到它**
 *   （它不是字面量，是拼出来的）。
 *
 *   本守卫把两个前缀表原样读出来，逐个跑真实的 `remapLegacyPageUrl()`，
 *   再拿结果去 app.json 的注册页里核对 —— 拼出来的目标也必须落在真实页面上。
 *
 * 用法：
 *   node miniprogram/scripts/test-legacy-remap.mjs
 *   node miniprogram/scripts/test-legacy-remap.mjs --selftest
 * 退出码：存在落不到注册页的旧前缀为 1。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const require = createRequire(import.meta.url)

const APP_JS = join(MP, 'app.js')
const HELPER_JS = join(MP, 'utils/messageHelper.js')

/** 去注释：判「接线是否存在」必须看去注释后的源码，否则注释里写一行就骗过守卫 */
function stripComments(src) {
  return String(src)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 读 app.json，返回「已注册页面」集合（形如 /subpackages/extra/user/profile/index） */
export function registeredPages() {
  const app = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
  const set = new Set()
  for (const p of app.pages || []) set.add('/' + p.replace(/^\//, ''))
  for (const sp of app.subpackages || app.subPackages || []) {
    const root = sp.root.replace(/\/$/, '')
    for (const p of sp.pages || []) set.add('/' + `${root}/${p}`.replace(/^\//, ''))
  }
  return set
}

/** 从 messageHelper 源码里取出一个「旧前缀表」的字面量 */
export function readLegacyPrefixes(src, constName) {
  const m = new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(src)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/**
 * 读「分包内搬迁别名」表（`MOVED_SUBPACKAGE_ALIASES`，形如 `{ from, to }`）。
 *
 * 为什么单独解析：这张表**不是** `/pages/*` 前缀表 —— 它是「分包 → 分包」的第二代搬迁，
 * 表项是成对的 `{from,to}`，`readLegacyPrefixes` 读不出（它只抓单引号字符串）。
 * 表尾跟着 `.sort((a,b)=>…)`，故正则到 `]` 后必须紧跟 `.sort` 才算数（否则会提前截断）。
 */
export function readAliasPairs(src) {
  const m = /const\s+MOVED_SUBPACKAGE_ALIASES\s*=\s*\[([\s\S]*?)\]\s*\.sort/.exec(src)
  if (!m) return null
  return [...m[1].matchAll(/\{\s*from:\s*'([^']+)'\s*,\s*to:\s*'([^']+)'\s*\}/g)]
    .map((x) => ({ from: x[1], to: x[2] }))
}

/**
 * 搬迁别名两条硬口径（**纯函数**，便于自检用合成输入证明它真的会红）：
 *   ① `from` 必须是**死路径** —— 若它仍命中 app.json 的注册页，就是在改写活页面（危险）；
 *   ② 每个别名必须能把该 `to` 下的**每一个真实注册页**从其 `from` 形态映射回来
 *      （自派生证例，不写死 witness：从 app.json 反推 `to + tail` → 旧路径 → 再重映射）。
 *      顺带要求 `to` 下至少有一个注册页，否则别名指向空目标（页面又搬走了 / 写错了 root）。
 */
export function checkAliases(aliases, registered, remap) {
  const problems = []
  for (const a of aliases || []) {
    const alive = [...registered].filter((p) => p === a.from || p.indexOf(`${a.from}/`) === 0)
    if (alive.length) {
      problems.push(`[搬迁别名] ${a.from} 仍是活路径（${alive[0]}）—— 会改写正常页面，禁止这么写`)
      continue
    }
    const targets = [...registered].filter((p) => p.indexOf(`${a.to}/`) === 0)
    if (!targets.length) {
      problems.push(`[搬迁别名] ${a.from} → ${a.to}：目标下没有任何注册页（页面又搬走 or root 写错）`)
      continue
    }
    for (const t of targets) {
      const legacy = a.from + t.slice(a.to.length)
      const mapped = remap(legacy)
      if (!pageOf(mapped, registered)) {
        problems.push(`[搬迁别名] ${legacy} → ${mapped}（不在 app.json 注册页里）`)
      }
    }
  }
  return problems
}

/** 把 remap 结果落到「注册页」判断上：容忍 query/hash、容忍补 /index */
export function pageOf(url, registered) {
  const path = String(url || '').split('?')[0].split('#')[0]
  if (!path) return null
  if (registered.has(path)) return path
  if (registered.has(`${path}/index`)) return `${path}/index`
  return null
}

function loadHelper() {
  // 仓库根 package.json 是 "type": "module"，小程序源码是 CommonJS，
  // 直接 require 会被当成 ESM 解析。用 new Function 提供 module/exports（与 test-wish-wall 同法）。
  const src = readFileSync(join(MP, 'utils/messageHelper.js'), 'utf8')
  const mod = { exports: {} }
  const localRequire = (id) => { throw new Error(`unexpected require ${id}`) }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(mod, mod.exports, localRequire)
  return mod.exports
}

/** 从 bannerNav（小程序或 ERP）源码里取出 { id, label, path } 预设三元组 */
export function parsePresets(src) {
  const out = []
  const RE = /id:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*,\s*path:\s*'([^']*)'/g
  let m
  while ((m = RE.exec(src))) out.push({ id: m[1], label: m[2], path: m[3] })
  return out
}

/**
 * ERP 预设的 path 必须**原样**是 app.json 的注册页。
 *
 * 为什么不用「重映射后再判」（2026-09-17 审计 E3 修正）：
 *   旧实现先跑 `remapLegacyPageUrl()` 再核对，等于把「ERP 写了一个不存在的页面」也算通过 ——
 *   实测 `/pages/store/index` 正是靠 remap 兜住的（真实页在 `subpackages/business/store`）。
 *   但 ERP 是**编辑面**，不能依赖下游的历史 remap：
 *     · ERP 侧 `matchSchemePresetId` 反查（拿存量 path 找预设）不走 remap →
 *       与小程序预设路径不一致时反查失配，页面显示「自定义」而非对应预设；
 *     · 运营在 ERP 里看到的就是这条 path，写错只会被下游掩盖，不会有人报错。
 *   所以口径收紧为：**ERP 预设必须是注册页原样**。
 */
export function checkErpPresetDirect(p, registered) {
  if (!p) return null // { id:'custom', path:'' } 是「自定义路径」占位，允许为空
  return pageOf(p, registered)
    ? null
    : `[ERP 轮播预设] ${p}（不是 app.json 的注册页；ERP 侧反查会失配，勿依赖小程序 remap 兜底）`
}

/** ERP 预设必须是「小程序预设」的子集：同 id 必须同 path，否则两端会持续漂移 */
export function comparePresets(adminList, mpList) {
  const problems = []
  const byId = new Map((mpList || []).map((x) => [x.id, x]))
  for (const a of adminList || []) {
    if (!a.path) continue
    const m = byId.get(a.id)
    if (!m) { problems.push(`[ERP 预设] ${a.id} 在小程序预设里不存在`); continue }
    if (m.path !== a.path) {
      problems.push(`[ERP 预设] ${a.id} path 漂移：ERP ${a.path} ≠ 小程序 ${m.path}`)
    }
  }
  return problems
}

/**
 * ERP 侧「轮播预设」的 path 必须落在注册页上，且与小程序预设逐条一致。
 *
 * 为什么放在这个守卫里：运营在 ERP 里选预设 → 存进 `banners.link` → 小程序
 * `openBannerItem()` 直接 navigateTo。这条链**跨了两个仓库目录**，
 * 任何一侧改路径都不会有人报错。
 */
export function scanErpBannerPresets(registered) {
  const adminFile = resolve(MP, '..', 'admin/src/utils/bannerNav.js')
  const mpFile = resolve(MP, 'utils/bannerNav.js')
  const problems = []
  let checked = 0
  let adminSrc
  try { adminSrc = readFileSync(adminFile, 'utf8') } catch { return { checked, problems } }
  const adminList = parsePresets(adminSrc)
  for (const p of adminList) {
    if (!p.path) continue
    checked += 1
    const bad = checkErpPresetDirect(p.path, registered)
    if (bad) problems.push(bad)
  }
  try {
    const mpList = parsePresets(readFileSync(mpFile, 'utf8'))
    problems.push(...comparePresets(adminList, mpList))
  } catch { /* 小程序侧文件缺失则跳过一致性比对 */ }
  return { checked, problems }
}

export function scan() {
  const src = readFileSync(join(MP, 'utils/messageHelper.js'), 'utf8')
  const helper = loadHelper()
  const registered = registeredPages()
  const names = ['FEATURE_LEGACY_PREFIXES', 'BUSINESS_LEGACY_PREFIXES', 'EXTRA_LEGACY_PREFIXES']
  const problems = []
  let checked = 0
  for (const name of names) {
    const prefixes = readLegacyPrefixes(src, name)
    if (!prefixes) continue // 表可能尚未存在（EXTRA 是随搬迁新增的）
    for (const p of prefixes) {
      checked += 1
      const mapped = helper.remapLegacyPageUrl(p)
      const hit = pageOf(mapped, registered)
      if (!hit) problems.push(`[${name}] ${p} → ${mapped}（不在 app.json 注册页里）`)
    }
    // 注：源码里的字面量顺序不需要有序 —— 每张表都 `.sort((a,b)=>b.length-a.length)`，
    // 真正的风险是「短前缀盖住长前缀」，由下面 tailCases 用真实 URL 断言。
  }
  // 带子路径的形态也要能命中（真实数据是 /pages/user/messages/detail 这种）
  const tailCases = ['/pages/user/messages/detail', '/pages/user/onboarding/done']
  for (const t of tailCases) {
    checked += 1
    if (!pageOf(helper.remapLegacyPageUrl(t), registered)) {
      problems.push(`[子路径] ${t} → ${helper.remapLegacyPageUrl(t)}（不在注册页里）`)
    }
  }

  /* ── 第二代遗留路径：**分包内部搬迁**（2026-09-17 b312a0f 拆 extra 分包）────────
   * 上面四张表只覆盖「主包 → 分包」。页面还搬过第二次家，而那一代路径
   * **印在物料上 / 存在已发出的订阅消息与站内信里**（是真实字面量，不是拼出来的），
   * 旧表不管它们 → 扫物料码 / 点通知直接 404 落首页。 */
  const aliases = readAliasPairs(src)
  if (!aliases || !aliases.length) {
    problems.push('[搬迁别名] messageHelper.js 里找不到 MOVED_SUBPACKAGE_ALIASES（分包内搬迁别名表）'
      + ' —— 印出去的旧路径会落首页')
  } else {
    checked += aliases.length
    problems.push(...checkAliases(aliases, registered, helper.remapLegacyPageUrl))
  }

  /* ── ★ P0：收银台「新用户注册」立牌 ──────────────────────────────
   * 该码生成于 2026-09-15 15:03，当时注册页（当天 b424752 首次新增）在
   * `subpackages/feature/user/onboarding/index`；09-17 b312a0f 搬到 extra/user/onboarding。
   * 印刷品改不了 —— 这条路径必须能被重映射，且 **scene 必须原样带过去**
   * （注册页用 `from=counter_qr` 判「独立注册入口」，丢掉它会把历史回流意图套回来）。 */
  {
    const legacy = 'subpackages/feature/user/onboarding/index'
    const want = '/subpackages/extra/user/onboarding/index'
    checked += 1
    // ⚠️ 走真实入口 normalizeMiniProgramUrl（物料清单/小程序码里的 path 是**不带前导斜杠**的形态，
    //    而 app.json 的注册页带斜杠 —— 用 remapLegacyPageUrl 裸比会因斜杠差异误报）。
    const mapped = helper.normalizeMiniProgramUrl(legacy)
    if (mapped !== want) {
      problems.push(`[P0 注册码] ${legacy} → ${mapped}（期望 ${want}）`)
    } else if (!pageOf(mapped, registered)) {
      problems.push(`[P0 注册码] ${mapped} 不在 app.json 注册页里 —— 扫立牌会落首页`)
    }
    const legacyWithScene = `${legacy}?scene=from%3Dcounter_qr`
    const withScene = helper.normalizeMiniProgramUrl(legacyWithScene)
    if (withScene !== `${want}?scene=from%3Dcounter_qr`) {
      problems.push(`[P0 注册码] scene 未随重映射保留：${legacyWithScene} → ${withScene}`)
    }
    // 更早一代（subpackages/user/*）：project.config.json 已 ignore 该目录，全为死路径
    checked += 1
    const ancient = helper.normalizeMiniProgramUrl('subpackages/user/certificates/index')
    if (!pageOf(ancient, registered)) {
      problems.push(`[P0 注册码] 更早一代 subpackages/user/certificates/index → ${ancient}（不在注册页里）`)
    }
  }

  const erp = scanErpBannerPresets(registered)
  checked += erp.checked
  problems.push(...erp.problems)
  return { checked, problems, registered }
}

/**
 * app 级「注册物料码」兜底入口路由（`app.js#maybeOpenRegisterEntry`）。
 *
 * 为什么和重映射表放在同一条守卫里：它们是同一条链的两段兜底 ——
 *   ① 页面 404 → `onPageNotFound`（依赖本文件的搬迁别名）改写到 extra；
 *   ② 热启动某些安卓机不重走码里页面 → app 级按 scene 再兜一次。
 * 只测 ① 会漏掉"安卓扫码停在首页"那个真实故障形态，只测 ② 会漏掉 onPageNotFound 那条。
 * 驱动方式与 `check-wall-qr.mjs` 的识别码段一致（`new Function('App','wx',...)` + 桩）。
 */
export async function scanAppRegisterEntry() {
  const problems = []
  let checked = 0
  const t = (ok, msg) => { checked += 1; if (!ok) problems.push(msg) }
  let appSrc
  try {
    appSrc = stripComments(readFileSync(APP_JS, 'utf8'))
  } catch (e) {
    problems.push(`[注册入口] 读不到 app.js：${e && e.message}`)
    return { checked, problems }
  }

  // ★ 404 那段必须走 normalizeMiniProgramUrl（注册旧路径就是靠它改写的），且出现在 goHome 之前
  t(/onPageNotFound[\s\S]*?normalizeMiniProgramUrl/.test(appSrc),
    '[注册入口] onPageNotFound 没有经 normalizeMiniProgramUrl 重映射（旧注册页路径会落首页）')
  {
    const noFoundAt = appSrc.indexOf('onPageNotFound')
    const goHomeAt = appSrc.indexOf('goHome()', noFoundAt)
    const remapAt = appSrc.indexOf('normalizeMiniProgramUrl', noFoundAt)
    t(noFoundAt >= 0 && remapAt > -1 && (goHomeAt === -1 || remapAt < goHomeAt),
      '[注册入口] 重映射分支在 goHome 之后（等于没写，用户仍落首页）')
  }
  t(/onShow\(options\)[\s\S]{0,600}?this\.maybeOpenRegisterEntry\(options\)/.test(appSrc),
    '[注册入口] onShow 没接线 maybeOpenRegisterEntry（方法在但没调用 = 等于没写）')

  const calls = { relaunch: [] }
  let captured = null
  // ⚠️ 必须传 require 桩：app.js 顶层 require 了若干模块，不传会让 Node 走
  //    「require() + 模块格式嗅探」并抛 ERR_AMBIGUOUS_MODULE_SYNTAX。
  // ⚠️⚠️ messageHelper 必须给**真模块**：`onPageNotFound` 正是靠它做重映射，
  //    给 `{}` 会让驱动跑出 "normalizeMiniProgramUrl is not a function" → 落到 goHome，
  //    于是断言"落了首页"却红在**校验台自己**身上（判据保真度缺陷，不是产品缺陷）。
  const helperMod = loadHelper()
  const appRequire = (id) => {
    const k = String(id)
    if (k.includes('messageHelper')) return helperMod
    if (k.includes('cloudEnv')) return { CLOUD_ENV: 'test-env' }
    if (k.includes('cloudHealth')) {
      return { checkCloudHealth: () => {}, notifyCloudHealthFailure: () => {} }
    }
    return {}
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('App', 'wx', 'getCurrentPages', 'require', appSrc)(
      (cfg) => { captured = cfg },
      {
        reLaunch: ({ url }) => calls.relaunch.push(url),
        switchTab: ({ url }) => calls.relaunch.push(`switchTab:${url}`),
        navigateTo: () => {}, showToast: () => {}, getSystemInfoSync: () => ({}),
        cloud: { database: () => ({}), callFunction: () => Promise.resolve({ result: {} }) },
        onError: () => {}
      },
      () => [{ route: 'pages/index/index' }],
      appRequire
    )
  } catch (e) {
    problems.push(`[注册入口] app.js 加载失败：${e && e.message}`)
    return { checked, problems }
  }
  t(!!captured && typeof captured.maybeOpenRegisterEntry === 'function',
    '[注册入口] app.js 里没有 maybeOpenRegisterEntry 方法')

  const ONBOARD = '/subpackages/extra/user/onboarding/index'
  const drive = async (options) => {
    calls.relaunch.length = 0
    const ctx = Object.assign(Object.create(null), captured)
    ctx._registerEntryKey = ''
    ctx._registerEntryAt = 0
    ctx.maybeOpenRegisterEntry(options)
    await new Promise((r) => setTimeout(r, 700))
    return calls.relaunch.slice()
  }
  if (captured && typeof captured.maybeOpenRegisterEntry === 'function') {
    const hit = await drive({ query: { scene: 'from=counter_qr' } })
    t(hit.length === 1 && hit[0].indexOf(`${ONBOARD}?scene=`) === 0 && /counter_qr/.test(hit[0]),
      `[注册入口] scene=from=counter_qr 没兜底到注册页：${JSON.stringify(hit)}`)
    const enc = await drive({ query: { scene: 'from%3Dcounter_qr' } })
    t(enc.length === 1 && /counter_qr/.test(enc[0]),
      `[注册入口] scene 是百分号编码形态时没兜底：${JSON.stringify(enc)}`)
    const cold = await drive({ path: ONBOARD.replace(/^\//, ''), query: { scene: 'from=counter_qr' } })
    t(cold.length === 0,
      `[注册入口] 冷启动入口本就是注册页时重复跳了（二次加载/重复埋点）：${JSON.stringify(cold)}`)
    const other = await drive({ query: { scene: 's3' } })
    t(other.length === 0, `[注册入口] 非注册类 scene 被误跳：${JSON.stringify(other)}`)
    const store = await drive({ query: { scene: 'from=store_qr' } })
    t(store.length === 0, `[注册入口] 门店识别码被注册路由抢走（两套 scene 判据串台）：${JSON.stringify(store)}`)
  }

  /* ── 祈福墙立牌：与识别码**共用** `from=store_qr` 令牌（2026-09-20 实测被抢）─────
   * 该码 2026-09-18 生成、已印，指向的祈福墙页是活的，靠 `k=mashangyou` 区分自己。
   * 识别入口路由若不先让路，扫立牌会被 reLaunch 到 AI 识别页（连冷启动也逃不掉）。 */
  const identifyDrive = async (options) => {
    calls.relaunch.length = 0
    const ctx = Object.assign(Object.create(null), captured)
    ctx._identifyEntryKey = ''
    ctx._identifyEntryAt = 0
    ctx._wishWallEntryKey = ''
    ctx._wishWallEntryAt = 0
    ctx.maybeOpenIdentifyEntry(options)
    await new Promise((r) => setTimeout(r, 700))
    return calls.relaunch.slice()
  }
  if (captured && typeof captured.maybeOpenIdentifyEntry === 'function') {
    const WALL = '/subpackages/feature/wish-wall/index'
    const wallCold = await identifyDrive({
      path: WALL.replace(/^\//, ''), query: { scene: 'from=store_qr&k=mashangyou' }
    })
    t(wallCold.length === 0,
      `[物料入口] ★ 冷启动扫祈福墙立牌被识别路由抢走（立牌已印，改不了）：${JSON.stringify(wallCold)}`)
    const wallWarm = await identifyDrive({
      path: 'pages/index/index', query: { scene: 'from=store_qr&k=mashangyou' }
    })
    t(wallWarm.length === 1 && wallWarm[0].indexOf(`${WALL}?scene=`) === 0 && /mashangyou/.test(wallWarm[0]),
      `[物料入口] 热启动扫祈福墙立牌没转发到祈福墙：${JSON.stringify(wallWarm)}`)
    const unknownKey = await identifyDrive({ query: { scene: 'from=store_qr&k=someotherwall' } })
    t(unknownKey.length === 0,
      `[物料入口] 带未知 k= 的物料码被识别路由抢走（不该抢不认识的物料）：${JSON.stringify(unknownKey)}`)
    // 对照：识别码本身必须仍然进识别页（别把修抢页修成修坏识别码）
    const storeOk = await identifyDrive({ path: 'pages/index/index', query: { scene: 'from=store_qr' } })
    t(storeOk.length === 1 && storeOk[0].indexOf('/subpackages/feature/identify/index') === 0,
      `[物料入口] ★ 识别码被误伤（不再进识别页）：${JSON.stringify(storeOk)}`)
    const poster = 'a1b2c3d4e5f60718293a4b5c'
    const ridOk = await identifyDrive({ path: 'pages/index/index', query: { scene: poster } })
    t(ridOk.length === 1 && ridOk[0].indexOf('/subpackages/feature/identify/result/index') === 0,
      `[物料入口] 分享海报码被误伤：${JSON.stringify(ridOk)}`)
  }

  /* ── 端到端：真机扫立牌那一下 ────────────────────────────────────
   * 微信解析不到码里写的 page（旧注册页已搬走）→ 调 onPageNotFound({path,query,isEntryPage:true})。
   * 这里按真机参数驱动一遍，断言它落到**注册页且带着 scene**，而不是 goHome（首页）。
   * 这是"扫码跳到主页"那个现象最贴近真机的一条断言。 */
  if (captured && typeof captured.onPageNotFound === 'function') {
    calls.relaunch.length = 0
    captured.onPageNotFound({
      path: 'subpackages/feature/user/onboarding/index',
      query: { scene: 'from%3Dcounter_qr' },
      isEntryPage: true
    })
    await new Promise((r) => setTimeout(r, 50))
    const hit = calls.relaunch.slice()
    const wentHome = hit.some((u) => u.indexOf('pages/index/index') > -1)
    t(!wentHome, `[注册入口] ★ 扫注册立牌落到了首页（onPageNotFound 没接住）：${JSON.stringify(hit)}`)
    t(hit.length === 1 && hit[0].indexOf(ONBOARD) === 0 && /scene=.*counter_qr/.test(hit[0]),
      `[注册入口] ★ 扫注册立牌没到注册页 / 丢了 scene：${JSON.stringify(hit)}`)
  } else {
    problems.push('[注册入口] app.js 里没有 onPageNotFound，扫旧注册码必落首页')
  }
  return { checked, problems }
}

/* ── 商品知识卡小程序码（2026-10-10 真机：扫「潮痕」知识卡落到鉴定百科，-502003 权限拒绝）──
 * 知识卡码 page=商品详情、scene=商品 _id；鉴定海报码 scene=鉴定记录 _id —— 两者都是 hex。
 * app 级识别入口曾按「hex 即鉴定记录」把知识卡抢到鉴定结果页。这里钉住：
 *   ① generateShareCard 的码指向已注册的商品详情页、scene 为商品 id；
 *   ② 商品详情把纯 scene 解析成商品 id；
 *   ③ 入口页是商品详情时，app 级识别路由不得 reLaunch（鉴定海报码仍照常进结果页）；
 *   ④ 结果页读不到记录时先认商品 id 转商品详情，且数据库原始报错不上屏。
 * 入参为源码字符串，自检在内存里改写，不写盘。 */
export const SHARE_CARD_FILES = {
  appSrc: APP_JS,
  cardFnSrc: join(MP, 'cloudfunctions/generateShareCard/index.js'),
  posterFnSrc: join(MP, 'cloudfunctions/generateSharePoster/index.js'),
  detailSrc: join(MP, 'subpackages/feature/detail/index.js'),
  resultSrc: join(MP, 'subpackages/feature/identify/result/index.js'),
}
const DETAIL_PAGE = 'subpackages/feature/detail/index'
const RESULT_PAGE = 'subpackages/feature/identify/result/index'

function readShareCardSources() {
  const out = {}
  for (const [k, f] of Object.entries(SHARE_CARD_FILES)) out[k] = readFileSync(f, 'utf8')
  return out
}

function extractFunction(src, name) {
  const at = src.indexOf(`function ${name}(`)
  if (at < 0) return ''
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1) }
  }
  return ''
}

function wxacodePageOf(src) {
  const m = /getUnlimited\(\{[\s\S]*?page:\s*'([^']+)'/.exec(stripComments(src))
  return m ? m[1] : ''
}

export async function checkShareCardQr(srcs, registered = registeredPages()) {
  const problems = []
  const t = (ok, msg) => { if (!ok) problems.push(`[知识卡码] ${msg}`) }
  const PID = '7d1e3c5a68f2b0e400a1b2c31f0e9d8c'

  // ① 云函数：知识卡码 → 商品详情；鉴定海报码 → 鉴定结果（两张码各归各页）
  const cardPage = wxacodePageOf(srcs.cardFnSrc)
  t(cardPage === DETAIL_PAGE, `generateShareCard 小程序码 page 应为 ${DETAIL_PAGE}，实为「${cardPage}」`)
  t(registered.has('/' + DETAIL_PAGE), '商品详情页不在 app.json 注册页里（码会扫空）')
  t(/scene\s*=\s*String\(productId/.test(stripComments(srcs.cardFnSrc)),
    'generateShareCard 的 scene 不再是商品 id（商品详情解析不出来）')
  t(wxacodePageOf(srcs.posterFnSrc) === RESULT_PAGE,
    `generateSharePoster（鉴定海报）码 page 应为 ${RESULT_PAGE}`)

  // ② 商品详情：纯 scene 即商品 id
  const resolverSrc = extractFunction(srcs.detailSrc, 'resolveProductIdFromOptions')
  let resolved = ''
  try {
    // eslint-disable-next-line no-new-func
    resolved = new Function('wx', `${resolverSrc}; return resolveProductIdFromOptions`)({})({ scene: PID })
  } catch (e) {
    resolved = `抛错：${e && e.message}`
  }
  t(resolved === PID, `商品详情没把扫码 scene 解析成商品 id（得到「${resolved}」）`)

  // ③ app 级入口路由
  const relaunch = []
  let captured = null
  try {
    // eslint-disable-next-line no-new-func
    new Function('App', 'wx', 'getCurrentPages', 'require', stripComments(srcs.appSrc))(
      (cfg) => { captured = cfg },
      {
        reLaunch: ({ url }) => relaunch.push(url),
        switchTab: ({ url }) => relaunch.push(`switchTab:${url}`),
        navigateTo: () => {}, showToast: () => {}, getSystemInfoSync: () => ({}),
        cloud: { database: () => ({}), callFunction: () => Promise.resolve({ result: {} }) },
        onError: () => {}
      },
      () => [{ route: 'pages/index/index' }],
      (id) => (String(id).includes('cloudHealth')
        ? { checkCloudHealth: () => {}, notifyCloudHealthFailure: () => {} }
        : {})
    )
  } catch (e) {
    problems.push(`[知识卡码] app.js 加载失败：${e && e.message}`)
    return problems
  }
  if (!captured || typeof captured.maybeOpenIdentifyEntry !== 'function') {
    problems.push('[知识卡码] app.js 里没有 maybeOpenIdentifyEntry')
    return problems
  }
  const drive = async (options) => {
    relaunch.length = 0
    const ctx = Object.assign(Object.create(null), captured)
    ctx._identifyEntryKey = ''
    ctx._identifyEntryAt = 0
    ctx.maybeOpenIdentifyEntry(options)
    await new Promise((r) => setTimeout(r, 700))
    return relaunch.slice()
  }
  const card = await drive({ path: DETAIL_PAGE, query: { scene: PID } })
  t(card.length === 0, `★ 扫商品知识卡被识别路由抢走：${JSON.stringify(card)}`)
  const card24 = await drive({ path: '/' + DETAIL_PAGE, query: { scene: PID.slice(0, 24) } })
  t(card24.length === 0, `★ 扫商品知识卡（24 位 id、带前导斜杠的 path）被识别路由抢走：${JSON.stringify(card24)}`)
  const poster = await drive({ path: 'pages/index/index', query: { scene: PID.slice(0, 24) } })
  t(poster.length === 1 && poster[0].indexOf('/' + RESULT_PAGE) === 0,
    `对照：鉴定海报码被误伤（不再进结果页）：${JSON.stringify(poster)}`)

  // ④ 结果页兜底
  const resultCode = stripComments(srcs.resultSrc)
  const loadRecordSrc = (/async loadRecord\(id\)\s*\{[\s\S]*?\n {2}\},/.exec(resultCode) || [''])[0]
  t(/await this\.redirectIfProductId\(id\)/.test(loadRecordSrc),
    '结果页加载失败时没先认商品 id（误入的商品码只会看到报错）')
  const redirSrc = (/async redirectIfProductId\([\s\S]*?\n {2}\},/.exec(resultCode) || [''])[0]
  t(/collection\('products'\)\.doc\(/.test(redirSrc) && redirSrc.indexOf(`/${DETAIL_PAGE}?id=`) >= 0,
    '结果页 redirectIfProductId 没有查商品并转到商品详情')
  t(/loadErrorMsg:\s*friendlyLoadErrorText\(/.test(loadRecordSrc),
    '结果页把原始报错直接写进 loadErrorMsg（errCode 会上屏）')
  let shown = null
  try {
    // eslint-disable-next-line no-new-func
    shown = new Function(`${extractFunction(srcs.resultSrc, 'isDeniedText')}\n${extractFunction(srcs.resultSrc, 'friendlyLoadErrorText')}\nreturn friendlyLoadErrorText`)()(
      'errCode: -502003 database permission denied | errMsg: Permission denied 更多错误信息请访问：https://docs.cloudbase.net/error-code/basic/DATABASE_PERMISSION_DENIED')
  } catch (e) {
    shown = null
  }
  t(typeof shown === 'string' && !/errCode|errMsg|-502003|https?:/i.test(shown),
    `结果页权限拒绝文案仍含原始报错：${JSON.stringify(shown)}`)
  return problems
}

async function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
  const registered = registeredPages()
  const helper = loadHelper()

  t('app.json 注册页被读到（>100）', registered.size > 100)
  t('注册页包含搬迁后的个人中心页', registered.has('/subpackages/extra/user/profile/index'))
  t('注册页已不含搬迁前的个人中心页', !registered.has('/subpackages/feature/user/profile/index'))

  // ★ 核心：搬迁前的落点必须被判为「不存在」——这正是本守卫要抓的回归形态
  t('★ 旧的 feature/user 落点判定为失效（守卫真的会失败）',
    pageOf('/subpackages/feature/user/profile/index', registered) === null)
  t('  └ 对照：新的 extra/user 落点可解析',
    pageOf('/subpackages/extra/user/profile/index', registered) === '/subpackages/extra/user/profile/index')

  // 真实映射必须落在注册页上
  t('★ /pages/user/profile 重映射后落在注册页',
    !!pageOf(helper.remapLegacyPageUrl('/pages/user/profile'), registered))
  t('★ /pages/user/messages 重映射后落在注册页',
    !!pageOf(helper.remapLegacyPageUrl('/pages/user/messages'), registered))
  t('/pages/user/profile 不再映射到 feature/user',
    helper.remapLegacyPageUrl('/pages/user/profile').indexOf('subpackages/feature/user') < 0)

  // ERP 轮播预设：同一条「必须落在注册页」的口径
  {
    const erp = scanErpBannerPresets(registered)
    t('ERP 轮播预设被扫到（>0）', erp.checked > 0)
    t('★ ERP 轮播预设全部落在注册页', erp.problems.length === 0, erp.problems.slice(0, 3).join(' | '))
    t('★ 旧形态的 ERP 预设必须被判失效（守卫真的会失败）',
      pageOf('/subpackages/feature/user/profile/index', registered) === null)
  }

  // ★ E3（2026-09-17 审计）：ERP 预设必须是注册页**原样**，不接受「靠 remap 兜住」
  t('★ ERP 预设直判：旧路径 /pages/store/index 必须被判失效',
    checkErpPresetDirect('/pages/store/index', registered) !== null)
  t('  └ 对照：真实落点 /subpackages/business/store/index 通过',
    checkErpPresetDirect('/subpackages/business/store/index', registered) === null)
  t('  自定义路径占位（空串）不报错', checkErpPresetDirect('', registered) === null)
  t('★ 两端预设漂移（同 id 不同 path）会被检出',
    comparePresets([{ id: 'a', path: '/x' }], [{ id: 'a', path: '/y' }]).length === 1)
  t('  两端完全一致时不报错',
    comparePresets([{ id: 'a', path: '/x' }], [{ id: 'a', path: '/x' }]).length === 0)
  t('★ ERP 多出的 id（小程序没有）会被检出',
    comparePresets([{ id: 'zzz', path: '/x' }], [{ id: 'a', path: '/y' }]).length === 1)
  t('  预设解析器能读出真实条目（>20）', parsePresets(
    readFileSync(resolve(MP, '..', 'admin/src/utils/bannerNav.js'), 'utf8')).length > 20)

  // 前缀表读取
  const src = readFileSync(join(MP, 'utils/messageHelper.js'), 'utf8')
  t('前缀表可被读出（FEATURE/BUSINESS）',
    Array.isArray(readLegacyPrefixes(src, 'FEATURE_LEGACY_PREFIXES'))
    && Array.isArray(readLegacyPrefixes(src, 'BUSINESS_LEGACY_PREFIXES')))
  t('不存在的表返回 null', readLegacyPrefixes(src, 'NOPE_NOT_A_TABLE') === null)

  // ── 第二代：分包内搬迁别名（2026-09-17 b312a0f）──
  const aliases = readAliasPairs(src)
  t('搬迁别名表可被读出（>2 条）', Array.isArray(aliases) && aliases.length > 2)
  t('  含 feature/user → extra/user',
    !!aliases && aliases.some((a) => a.from === '/subpackages/feature/user' && a.to === '/subpackages/extra/user'))
  t('  manager 是逐页列举（绝不含整根 /subpackages/manager）',
    !!aliases && !aliases.some((a) => a.from === '/subpackages/manager'))

  // ★ 印刷物料现场：注册页在 feature/user 的**那一代路径已死**（守卫真的会失败）
  t('★ 印出去的注册码路径已不在注册页里（判据真的会红）',
    pageOf('/subpackages/feature/user/onboarding/index', registered) === null)
  t('  └ 对照：搬到 extra/user 后是注册页',
    pageOf('/subpackages/extra/user/onboarding/index', registered) === '/subpackages/extra/user/onboarding/index')
  t('★ 该死路径必须被重映射回注册页（否则扫立牌落首页）',
    helper.normalizeMiniProgramUrl('subpackages/feature/user/onboarding/index')
    === '/subpackages/extra/user/onboarding/index')
  t('★ 重映射必须保留 scene（注册页靠 from=counter_qr 判独立注册入口）',
    helper.normalizeMiniProgramUrl('subpackages/feature/user/onboarding/index?scene=from%3Dcounter_qr')
    === '/subpackages/extra/user/onboarding/index?scene=from%3Dcounter_qr')

  // 纯函数判据：真实表必须干净，且**两个方向**的回归都能被检出
  t('真实别名表全部通过（0 问题）', checkAliases(aliases, registered, helper.remapLegacyPageUrl).length === 0)
  t('★ 别名把活路径当 from（会改写正常页面）必须被检出',
    checkAliases([{ from: '/subpackages/extra/user', to: '/subpackages/extra/user' }],
      registered, helper.remapLegacyPageUrl).length > 0)
  t('★ 别名目标下没有注册页（页面又搬走/root 写错）必须被检出',
    checkAliases([{ from: '/subpackages/gone-forever', to: '/subpackages/nope' }],
      registered, helper.remapLegacyPageUrl).length > 0)
  t('  合法别名不会被误判（只红真问题）',
    checkAliases([{ from: '/subpackages/feature/user', to: '/subpackages/extra/user' }],
      registered, helper.remapLegacyPageUrl).length === 0)

  /* ── 真实注入：证明新增判据**确实会红**（写完立即还原源码）────────
   * ⚠️ 会写源码 → 必须在**隔离 worktree** 里跑 `--selftest`（共享工作区会覆盖别人在写的内容）。 */
  const runGuard = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  const inject = (file, from, to, why) => {
    const backup = readFileSync(file, 'utf8')
    if (backup.indexOf(from) < 0) {
      console.error(`✗ selftest 注入点找不到（源码已变，注入失效）：${why}`)
      process.exit(1) // 尚未写盘，退出安全
    }
    let ran = false
    let caught = false
    try {
      writeFileSync(file, backup.replace(from, to))
      ran = true
      caught = runGuard().status !== 0
    } finally {
      // ⚠️ 必须**先还原再判成败**：`process.exit()` 不会执行挂起的 finally 块，
      //    把 exit 写在 try 里会把注入留在源码中（2026-09-20 在另一条守卫上实际踩到）。
      writeFileSync(file, backup)
    }
    if (!ran || !caught) {
      console.error(`✗ selftest 失败：${why}，守卫居然没红（已还原源文件）`)
      process.exit(1)
    }
  }
  inject(APP_JS, 'this.maybeOpenRegisterEntry(options)', '',
    '拆掉 onShow 里的注册入口兜底路由')
  inject(HELPER_JS, "{ from: '/subpackages/feature/user', to: '/subpackages/extra/user' }",
    "{ from: '/subpackages/extra/user', to: '/subpackages/extra/user' }",
    '把注册旧路径的搬迁别名改成"改活路径"')
  // 整条删掉别名 → 旧注册页路径无人接管 → onPageNotFound 只能 goHome（真机现象：扫码落首页）
  await inject(HELPER_JS, "  { from: '/subpackages/feature/user', to: '/subpackages/extra/user' },\n", '',
    '整条删掉 feature/user → extra/user 搬迁别名（扫立牌落首页）')
  // 拆掉"让路给祈福墙"那段 → 扫祈福墙立牌被抢到识别页
  await inject(APP_JS, 'const wallKey = /(?:^|[&?])k=([^&]+)/.exec(scene);', '',
    '拆掉祈福墙物料码让路分支（扫祈福墙立牌被抢到识别页）')

  // 商品知识卡码：真源必须干净，内存注入逐条必须红（不写盘）
  {
    const real = readShareCardSources()
    const base = await checkShareCardQr(real, registered)
    t('★ 商品知识卡码真源通过', base.length === 0, base.join(' | '))
    const mutate = (key, from, to) => {
      if (real[key].indexOf(from) < 0) return null
      return Object.assign({}, real, { [key]: real[key].replace(from, to) })
    }
    const cases = [
      ['拆掉 app.js 的商品详情让路（扫知识卡被抢到鉴定结果页）', 'appSrc',
        "if (entryPath === 'subpackages/feature/detail/index') return;", ''],
      ['知识卡码改指向鉴定结果页', 'cardFnSrc',
        "page: 'subpackages/feature/detail/index'", "page: 'subpackages/feature/identify/result/index'"],
      ['商品详情不再把纯 scene 当商品 id', 'detailSrc',
        '  // generateShareCard：scene 即为 productId\n  return scene;', "  return '';"],
      ['结果页加载失败不再认商品 id', 'resultSrc',
        'if (kind !== \'unshared\' && (await this.redirectIfProductId(id))) return', ''],
      ['结果页把原始报错直接上屏', 'resultSrc',
        'loadErrorMsg: friendlyLoadErrorText(msg)', 'loadErrorMsg: msg'],
      ['报错文案回退成原文', 'resultSrc',
        "const t = String(msg || '')\n  if (isDeniedText(t))", "return String(msg || '')\n  const t = ''\n  if (isDeniedText(t))"],
    ]
    for (const [why, key, from, to] of cases) {
      const srcs = mutate(key, from, to)
      if (!srcs) { t(`注入点存在：${why}`, false); continue }
      const got = await checkShareCardQr(srcs, registered)
      t(`★ ${why} → 必须检出`, got.length > 0)
    }
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：注册页读取、旧落点必被判失效、真实映射必须命中注册页、'
    + '分包内搬迁别名（含注册码现场 + scene 保留）全部可判红，且已还原源文件')
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems, registered } = scan()
  const app = await scanAppRegisterEntry()
  const card = await checkShareCardQr(readShareCardSources(), registered)
  for (const p of problems) console.error(`✗ ${p}`)
  for (const p of app.problems) console.error(`✗ ${p}`)
  for (const p of card) console.error(`✗ ${p}`)
  const total = problems.length + app.problems.length + card.length
  if (total) {
    console.error(`\n旧路径重映射未通过：${total} 处（拼接目标不在注册页 / 入口兜底失效，`
      + '用户扫物料码或点通知会「点击无效」或落首页）')
    process.exit(1)
  }
  console.log(`✓ 旧路径重映射全部落到注册页（${checked + app.checked} 项 · 注册页 ${registered.size} 个）`
    + ' · 注册物料码入口兜底路由行为正确')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // 被测页面代码留下的定时器会让进程白挂约 6s；判定已全部完成，冲刷输出后退出（保留 exitCode）
  main().then(
    () => process.stdout.write('', () => process.exit()),
    (e) => { console.error(e); process.exit(1) },
  )
}
