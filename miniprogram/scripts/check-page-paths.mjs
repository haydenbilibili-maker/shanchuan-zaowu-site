#!/usr/bin/env node
/**
 * 小程序页面路径守卫
 *
 * 为什么需要（2026-09-16 包体优化前建立）：把页面在分包之间搬迁是**唯一**能压低单个
 * 分包体积的手段（拆文件不改变体积）。但搬迁必须改掉**所有**指向它的 URL ——
 * 漏一处就是「点击无效 / 白屏」，而且**编译期不报错**，只在用户点到那一刻才炸。
 *
 * 本仓库此前没有任何东西在管这件事。实测已存在同类缺陷的形态：
 *   `subpackages/feature/articles/detail` 的 `require` 少退一层（见 check:require-paths），
 *   也是「写错一层、点到了才炸」。
 *
 * 检查项：
 *   A. `app.json` 注册的每个页面，四件套（js/json/wxml）是否都在
 *   B. 代码里出现的每个 `/pages/...` 或 `/subpackages/...` 跳转路径，是否都能在 `app.json` 找到
 *   C. `app.json` 里 tabBar 的 pagePath 必须是主包页面（分包页不能当 tab）
 *
 * 会跳过：含 `${}` / `{{}}` 的动态路径、`plugin://`、http(s) 外链、`web-view` src。
 *
 * 用法：
 *   node miniprogram/scripts/check-page-paths.mjs
 *   node miniprogram/scripts/check-page-paths.mjs --json
 *   node miniprogram/scripts/check-page-paths.mjs --selftest
 * 退出码：有问题为 1。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'miniprogram_npm', '.git'])

/**
 * 已知的**历史遗留路径**：它们出现在「旧路径 → 新路径」的重映射表里
 * （`utils/messageHelper.js` 的 remapLegacyPageUrl），是**映射源**而不是跳转目标。
 * 显式登记而不是放宽规则 —— 否则真正的「跳转指向不存在页面」也会被一起放过。
 */
export const LEGACY_REMAP_PATHS = new Set([
  'pages/about',
  'pages/ar',
  'pages/booking',
  'pages/store',
  'pages/store-zone',
  'pages/custom/hub',
  'pages/custom/framer-recruit',
  'pages/atelier',
  'subpackages/feature/custom/hub'
])

/** 纯函数：从 app.json 收集已注册页面（去掉前导斜杠） */
export function registeredPages(appJson) {
  const out = new Set()
  for (const p of appJson.pages || []) out.add(String(p).replace(/^\//, ''))
  for (const sp of appJson.subpackages || appJson.subPackages || []) {
    const root = String(sp.root || '').replace(/\/$/, '')
    for (const p of sp.pages || []) out.add(`${root}/${p}`.replace(/^\//, ''))
  }
  return out
}

/**
 * 纯函数：从源码里抽出「看起来是站内页面路径」的字符串。
 * 只认以 `/pages/` 或 `/subpackages/` 开头的，避免把外链、资源路径误判。
 */
const PATH_LIT = `['"\`](/?(?:pages|subpackages)/[A-Za-z0-9_\\-/]+)(?:\\?[^'"\`]*)?['"\`]`

/**
 * 纯函数：**只从跳转调用点**抽取路径。
 *
 * 为什么不再扫「所有字符串字面量」：`utils/messageHelper.js` 有一张
 * 「旧路径 → 新路径」重映射表（44 条历史路径，如 `/pages/detail` → `subpackages/feature/detail/index`）。
 * 那 44 条是**映射源**、不是跳转目标 —— 全量扫会被迫把它们整表加进白名单，
 * 白名单一大，守卫就形同虚设。改为只认真正会触发跳转的四类位置：
 *   1. `wx.navigateTo/redirectTo/reLaunch/switchTab({ url: '...' })`
 *   2. `<navigator ... url="...">`
 *   3. `path: '...'`（客服/动作表产出的跳转目标）
 *   4. 裸 `url: '...'`（helper 拼装后交给 wx.navigateTo）
 */
export function collectPagePaths(src) {
  const out = []
  const text = String(src || '')
  const patterns = [
    new RegExp(`wx\\.(?:navigateTo|redirectTo|reLaunch|switchTab)\\s*\\(\\s*\\{[^}]*?url\\s*:\\s*${PATH_LIT}`, 'g'),
    new RegExp(`<navigator[^>]*?url\\s*=\\s*${PATH_LIT}`, 'g'),
    new RegExp(`\\bpath\\s*:\\s*${PATH_LIT}`, 'g'),
    new RegExp(`\\burl\\s*:\\s*${PATH_LIT}`, 'g')
  ]
  // 4 个模式会重叠命中同一处（如 wx.navigateTo 内同时命中模式 1 与模式 4），
  // 按**命中位置**去重，否则「引用次数」会翻倍、误导搬迁时的核对
  const seen = new Set()
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const p = m[1]
      if (!p || p.indexOf('/assets/') !== -1) continue
      // 关键：用**路径本身**在文本中的偏移去重，而不是 match 的起点 ——
      // 模式 1 从 `wx.navigateTo(` 起算、模式 4 从 `url:` 起算，起点不同但路径同一处
      const off = m.index + m[0].lastIndexOf(m[1])
      const key = `${off}:${p}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/** 纯函数：归一化（去前导斜杠、去查询串、去尾部斜杠） */
export function normalizePath(p) {
  return String(p || '')
    .replace(/^\//, '')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
}

/** 纯函数：判断一组路径里哪些未注册 */
export function findUnknown(paths, registered) {
  const bad = new Map()
  for (const raw of paths) {
    const p = normalizePath(raw)
    if (!p) continue
    if (registered.has(p)) continue
    if (LEGACY_REMAP_PATHS.has(p)) continue
    if (!bad.has(p)) bad.set(p, 0)
    bad.set(p, bad.get(p) + 1)
  }
  return bad
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|wxml|json|wxs)$/.test(name)) out.push(p)
  }
  return out
}

function main() {
  const selftest = process.argv.includes('--selftest')
  const asJson = process.argv.includes('--json')

  if (selftest) {
    let bad = 0
    const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
    const reg = registeredPages({
      pages: ['pages/index/index'],
      subpackages: [{ root: 'subpackages/feature', pages: ['detail/index'] }]
    })
    t('registeredPages 收主包页', reg.has('pages/index/index'))
    t('registeredPages 收分包页（root+page 拼接）', reg.has('subpackages/feature/detail/index'))
    t('collectPagePaths 抓 wx.navigateTo 的 url', collectPagePaths("wx.navigateTo({url:'/pages/index/index'})").length === 1)
    t('collectPagePaths 抓带查询串的路径', collectPagePaths("url:'/subpackages/feature/detail/index?id=1'")[0] === '/subpackages/feature/detail/index')
    t('collectPagePaths 忽略外链', collectPagePaths("src:'https://a.com/pages/x'").length === 0)
    t('normalizePath 去查询串与斜杠', normalizePath('/pages/index/index?x=1') === 'pages/index/index')
    t('★ 未注册路径必须报出', findUnknown(['/pages/nope/index'], reg).size === 1)
    t('已注册路径不报', findUnknown(['/subpackages/feature/detail/index'], reg).size === 0)

    // 真实文件注入：把一个真实跳转路径改成一个不存在的页面
    const probe = join(MP, 'utils/productDetailNav.js')
    const orig = readFileSync(probe, 'utf8')
    try {
      const mutated = orig.replace('/subpackages/feature/detail/index', '/subpackages/feature/detailXX/index')
      if (mutated === orig) { bad += 1; console.log('✗ 注入锚点缺失') } else {
        const unknown = findUnknown(collectPagePaths(mutated), reg)
        t('★ 注入「指向不存在页面」被检出', unknown.size === 1)
      }
    } finally {
      if (readFileSync(probe, 'utf8') !== orig) { bad += 1; console.log('✗ 自检污染工作区') }
      else console.log('✓ 注入已还原')
    }
    if (bad) { console.error(`\n自检失败 ${bad} 项`); process.exit(1) }
    console.log('\n自检通过：注册页收集、路径抽取、未注册检出、真实注入都能工作')
    return
  }

  const appJson = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
  const registered = registeredPages(appJson)

  // A. 页面四件套完整性
  const missingFiles = []
  for (const p of registered) {
    for (const ext of ['js', 'json', 'wxml']) {
      if (!existsSync(join(MP, `${p}.${ext}`))) missingFiles.push(`${p}.${ext}`)
    }
  }

  // B. 代码里引用但未注册的路径
  const files = walk(MP)
  const allPaths = []
  for (const f of files) {
    for (const p of collectPagePaths(readFileSync(f, 'utf8'))) allPaths.push(p)
  }
  const unknown = findUnknown(allPaths, registered)

  // C. tabBar 必须是主包页
  const badTabs = []
  for (const item of (appJson.tabBar && appJson.tabBar.list) || []) {
    const p = normalizePath(item.pagePath)
    if (!registered.has(p)) badTabs.push(`${p}（未注册）`)
    else if (p.startsWith('subpackages/')) badTabs.push(`${p}（分包页不能作为 tabBar）`)
  }

  const problems = [
    ...missingFiles.map((m) => `页面文件缺失：${m}`),
    ...[...unknown.entries()].map(([p, n]) => `跳转指向未注册页面：/${p}（出现 ${n} 次）`),
    ...badTabs.map((t) => `tabBar 非法：${t}`)
  ]

  if (asJson) {
    console.log(JSON.stringify({ registered: registered.size, scanned: files.length, paths: allPaths.length, problems }, null, 2))
  } else {
    problems.forEach((p) => console.error(`✗ ${p}`))
    if (!problems.length) {
      console.log(`✓ 页面路径全部有效（注册 ${registered.size} 个页面 · 扫描 ${files.length} 个文件 · ${allPaths.length} 处路径引用）`)
    }
  }
  if (problems.length) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
