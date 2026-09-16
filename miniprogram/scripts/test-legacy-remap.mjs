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
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const require = createRequire(import.meta.url)

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

/**
 * ERP 侧「轮播预设」的 path 也必须落在注册页上。
 *
 * 为什么放在这个守卫里：运营在 ERP 里选预设 → 存进 `banners.link` → 小程序
 * `openBannerItem()` 直接 navigateTo。这条链**跨了两个仓库目录**，
 * 任何一侧改路径都不会有人报错 —— 实测 `admin/src/utils/bannerNav.js` 有 6 条
 * 预设仍指向 `subpackages/feature/user/*`（个人中心已迁到 extra/user），
 * 运营一旦选中就是「点了没反应」。这里把它并进同一条守卫：
 * **「凡是会被 navigateTo 的路径，都必须在 app.json 里」**。
 */
export function scanErpBannerPresets(registered, helper) {
  const file = resolve(MP, '..', 'admin/src/utils/bannerNav.js')
  const problems = []
  let checked = 0
  let src
  try { src = readFileSync(file, 'utf8') } catch { return { checked, problems } }
  for (const m of src.matchAll(/path:\s*'([^']*)'/g)) {
    const p = m[1]
    if (!p) continue // { id:'custom', path:'' } 是「自定义路径」占位
    checked += 1
    // 关键：预设是**旧路径也没关系** —— 小程序 openBannerItem() 会先跑 remapLegacyPageUrl()
    // 再 navigateTo。所以按「运行时真实落点」判定：先重映射，再核对注册页。
    const mapped = helper ? helper.remapLegacyPageUrl(p) : p
    if (!pageOf(mapped, registered)) {
      problems.push(`[ERP 轮播预设] ${p} → ${mapped}（重映射后仍不在注册页，运营选中后点击无效）`)
    }
  }
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
  const erp = scanErpBannerPresets(registered, helper)
  checked += erp.checked
  problems.push(...erp.problems)
  return { checked, problems, registered }
}

function selftest() {
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
    const erp = scanErpBannerPresets(registered, helper)
    t('ERP 轮播预设被扫到（>0）', erp.checked > 0)
    t('★ ERP 轮播预设全部落在注册页', erp.problems.length === 0, erp.problems.slice(0, 3).join(' | '))
    t('★ 旧形态的 ERP 预设必须被判失效（守卫真的会失败）',
      pageOf('/subpackages/feature/user/profile/index', registered) === null)
  }

  // 前缀表读取
  const src = readFileSync(join(MP, 'utils/messageHelper.js'), 'utf8')
  t('前缀表可被读出（FEATURE/BUSINESS）',
    Array.isArray(readLegacyPrefixes(src, 'FEATURE_LEGACY_PREFIXES'))
    && Array.isArray(readLegacyPrefixes(src, 'BUSINESS_LEGACY_PREFIXES')))
  t('不存在的表返回 null', readLegacyPrefixes(src, 'NOPE_NOT_A_TABLE') === null)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：注册页读取、旧落点必被判失效、真实映射必须命中注册页')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems, registered } = scan()
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n旧路径重映射未通过：${problems.length} 处（拼接目标不在注册页，用户点通知会「点击无效」）`)
    process.exit(1)
  }
  console.log(`✓ 旧路径重映射全部落到注册页（${checked} 个旧前缀 · 注册页 ${registered.size} 个）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
