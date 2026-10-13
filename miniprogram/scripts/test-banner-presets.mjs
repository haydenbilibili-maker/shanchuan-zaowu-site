/**
 * 装修海报「功能页跳转」候选 行为断言
 *
 * 为什么需要（2026-09-18）：
 *   1. 候选列表（`SCHEME_PRESETS`）是**运营唯一能选的落点集合**，一份在
 *      `miniprogram/utils/bannerNav.js`（店长工作台装修用），另一份**逐字复制**到
 *      `admin/src/utils/bannerNav.js`（ERP BannerManager 用）——两处编辑的是**同一个 `banners` 集合**。
 *      实测它俩已经漂移：ERP 版少 13 个入口、3 个名称不一致，而**没有任何守卫拦过**。
 *   2. 路径写错**不会报编译错**，只在运营点海报时跳转失败；本仓刚做过一次分包重划分
 *      （页面在 `manager`/`feature`/`extra` 之间搬过），这类失效必须被机械拦住。
 *   3. 新增核心功能（如祈福墙）很容易忘记补进候选 → 用"核心落点必须在列"把它钉住。
 *
 * 用法：
 *   node miniprogram/scripts/test-banner-presets.mjs
 *   node miniprogram/scripts/test-banner-presets.mjs --selftest
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
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

const SSOT = 'miniprogram/utils/bannerNav.js'
const ERP = 'admin/src/utils/bannerNav.js'
const WISH = 'miniprogram/subpackages/feature/wish-labels/index'

const INJECTIONS = {
  // 新增核心功能忘补候选（本轮用户点名的那件事）
  'wish-wall-dropped': {
    file: SSOT,
    from: "  { id: 'wish-wall', label: '马上有 · 心愿签', path: '/subpackages/feature/wish-labels/index' },\n",
    to: ''
  },
  // 运营点了会跳到空白/报错页
  'stale-path': {
    file: SSOT,
    from: "path: '/subpackages/business/about/index' }",
    to: "path: '/subpackages/business/about-old/index' }"
  },
  // 两份副本漂移（改了 ERP 那侧的名字，模拟历史上真实发生过的那种错）
  'copy-drift': {
    file: ERP,
    from: "{ id: 'wish-wall', label: '马上有 · 心愿签',",
    to: "{ id: 'wish-wall', label: '马上有 · 心愿签（旧）',"
  },
  // 重复 id（运营端回填会串台）
  'dup-id': {
    file: SSOT,
    from: "  { id: 'search', label: '搜索', path: '/subpackages/feature/search/index' },",
    to: "  { id: 'search', label: '搜索', path: '/subpackages/feature/search/index' },\n  { id: 'search', label: '搜索（重复）', path: '/subpackages/feature/search/index' },"
  },
  // 祈福墙预设带参数后页面就不再回落默认墙 → 海报跳过去是空白
  // 与当前实现对齐：局部变量写法（历史内联 productKey: normalize… 已弃用）
  'wishwall-requires-key': {
    file: WISH + '.js',
    from: '    const productKey = normalizeProductKey(opts.productKey || fromScene.productKey)',
    to: '    const productKey = normalizeProductKey(opts.productKey)'
  }
}

const INJECT = String(process.env.BANNER_PRESETS_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/** 小程序侧：CommonJS，直接加载（require 只用到 messageHelper） */
function loadSsot() {
  const m = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readSrc(SSOT))(m, m.exports, () => ({ remapLegacyPageUrl: (u) => u }))
  return m.exports
}

/** ERP 侧：ESM 副本 → 内存里降级成 CJS 再加载（不引入构建依赖） */
function loadErp() {
  let src = readSrc(ERP)
  src = src.replace(/export const /g, 'const ').replace(/export function /g, 'function ')
  src += '\nmodule.exports = { SCHEME_PRESETS, validateSchemePath, buildBannerLinkForSave, matchSchemePresetId, ensureLeadingSlash }'
  const m = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(m, m.exports)
  return m.exports
}

const ssot = loadSsot()
const erp = loadErp()
const presets = ssot.SCHEME_PRESETS

/** app.json 已登记页面集合 */
function registeredPages() {
  const app = JSON.parse(readFileSync(resolve(ROOT, 'miniprogram/app.json'), 'utf8'))
  const set = new Set(app.pages || [])
  const subs = app.subPackages || app.subpackages || []
  subs.forEach((sp) => {
    const root = String(sp.root || '').replace(/\/$/, '')
    ;(sp.pages || []).forEach((p) => set.add(`${root}/${p}`))
  })
  return set
}
const REGISTERED = registeredPages()

/** 核心落点清单：新增核心功能后**必须**在这里补一条（含祈福墙） */
const REQUIRED_TARGETS = [
  ['探索首页', '/pages/index/index'],
  ['馆藏', '/pages/category/index'],
  ['标本工坊', '/pages/atelier/index'],
  ['购物车', '/pages/cart/index'],
  ['我的', '/pages/user/index'],
  ['祈福墙（2026-09 新增核心功能）', '/subpackages/feature/wish-labels/index'],
  ['订单列表', '/subpackages/business/orders/index'],
  ['我的礼券夹', '/subpackages/business/coupons/index'],
  ['我的钱包', '/subpackages/extra/user/stored-value/index'],
  ['礼赠', '/subpackages/feature/gift/hub/index'],
  ['我的礼赠', '/subpackages/feature/gift/my-gifts/index'],
  ['AI 鉴定', '/subpackages/feature/identify/index'],
  ['搜索', '/subpackages/feature/search/index'],
  ['山海图鉴', '/subpackages/feature/collection/index'],
  ['线下门店', '/subpackages/business/store/index'],
  ['预约到店', '/subpackages/business/booking/index'],
  ['馆内直播', '/subpackages/content/live/watch/index'],
  ['山海影像', '/subpackages/content/videos/index'],
  ['博物文章', '/subpackages/feature/articles/index'],
  ['我的证书', '/subpackages/extra/user/certificates/index'],
  ['收藏与候补', '/subpackages/extra/user/wishlist/index']
]

/* ------------------------------------------------------------------ *
 * 1) 每条候选路径必须真实可达（运营点了不能跳失败）
 * ------------------------------------------------------------------ */
{
  const broken = []
  presets.forEach((p) => {
    if (!p.path) return // 自定义路径：留空由运营填
    const pathOnly = p.path.split('?')[0]
    if (pathOnly[0] !== '/') broken.push(`${p.id} 路径未以 / 开头：${p.path}`)
    else {
      const rel = pathOnly.slice(1)
      if (!REGISTERED.has(rel)) broken.push(`${p.id} 未登记在 app.json：${p.path}`)
      else if (!existsSync(resolve(ROOT, 'miniprogram/' + rel + '.js')) || !statSync(resolve(ROOT, 'miniprogram/' + rel + '.js')).isFile()) {
        broken.push(`${p.id} 文件不存在：${p.path}`)
      } else if (!existsSync(resolve(ROOT, 'miniprogram/' + rel + '.wxml'))) {
        broken.push(`${p.id} 缺 wxml：${p.path}`)
      }
    }
  })
  check('★ 每条候选路径都已登记且文件存在（分包重划分后不再有失效跳转）', broken.length === 0, broken.join(' / '))
  eq('每条 path 都通过 validateSchemePath（运营手填/预设同口径）',
    presets.filter((p) => p.path && !ssot.validateSchemePath(p.path).ok).length, 0)
}

/* ------------------------------------------------------------------ *
 * 2) 无重复 id / 无重复 path（否则运营端回填会串台）
 * ------------------------------------------------------------------ */
{
  const ids = presets.map((p) => p.id)
  const paths = presets.filter((p) => p.path).map((p) => p.path)
  eq('id 无重复', ids.length - new Set(ids).size, 0)
  eq('path 无重复', paths.length - new Set(paths).size, 0)
  eq('末项仍是「自定义路径」（运营可手填）', presets[presets.length - 1].id, 'custom')
  eq('自定义项不带 path（避免误存成一个真实页面）', presets[presets.length - 1].path, '')
}

/* ------------------------------------------------------------------ *
 * 3) 核心落点必须在列（新增核心功能忘记补候选 → 这里红）
 * ------------------------------------------------------------------ */
{
  const paths = new Set(presets.map((p) => p.path))
  const missing = REQUIRED_TARGETS.filter(([, path]) => !paths.has(path)).map(([name, path]) => `${name} (${path})`)
  check('★ 核心落点全部在候选里（新增核心功能必须补进来）', missing.length === 0, missing.join(' / '))
  // 藏品详情/预约不是"预设 path"，而是 type 分支生成的链接 —— 单独按分支断言（判据锚在真实契约上）
  eq('type=product → 藏品详情（带 id）', ssot.buildBannerLinkForSave('product', 'p1'), '/subpackages/feature/detail/index?id=p1')
  eq('type=booking → 预约到店', ssot.buildBannerLinkForSave('booking', ''), '/subpackages/business/booking/index')
  eq('type=category → 不给直链（走馆藏 Tab + globalData）', ssot.buildBannerLinkForSave('category', 'x'), '')
  eq('type=scheme → 原样返回路径（保留 query）', ssot.buildBannerLinkForSave('scheme', '/subpackages/content/user/legal/index?type=privacy'), '/subpackages/content/user/legal/index?type=privacy')
  eq('★ ERP 副本的分支行为与小程序一致（product）', erp.buildBannerLinkForSave('product', 'p1'), ssot.buildBannerLinkForSave('product', 'p1'))
  eq('★ ERP 副本的分支行为与小程序一致（booking）', erp.buildBannerLinkForSave('booking', ''), ssot.buildBannerLinkForSave('booking', ''))
  eq('★ ERP 副本的分支行为与小程序一致（scheme 带 query）', erp.buildBannerLinkForSave('scheme', '/subpackages/content/user/legal/index?type=terms'), ssot.buildBannerLinkForSave('scheme', '/subpackages/content/user/legal/index?type=terms'))
  check('★ 祈福墙在候选里，且 path 就是那个页面',
    presets.some((p) => p.id === 'wish-wall' && p.path === '/subpackages/feature/wish-labels/index'))
  check('祈福墙的说明写清了多面墙怎么指（productKey）',
    /productKey/.test(readSrc(SSOT)) && /祈福墙/.test(readSrc(SSOT)))
}

/* ------------------------------------------------------------------ *
 * 4) 两份副本必须逐项一致（id / label / path，含顺序）
 * ------------------------------------------------------------------ */
{
  const a = presets.map((p) => `${p.id}|${p.label}|${p.path}`)
  const b = erp.SCHEME_PRESETS.map((p) => `${p.id}|${p.label}|${p.path}`)
  eq('★ ERP 副本条数一致', b.length, a.length)
  const diff = a.filter((x, i) => b[i] !== x).slice(0, 5)
  check('★ ERP 副本与小程序的候选逐项一致（名称也算）', a.length === b.length && diff.length === 0,
    diff.length ? `首个不一致：小程序 ${diff[0]} / ERP ${b[a.indexOf(diff[0])] || '缺失'}` : '')
  check('两份都从同一份数组取值（没有人在页面里写死候选）',
    /SCHEME_PRESETS/.test(readFileSync(resolve(ROOT, 'admin/src/components/BannerManager.vue'), 'utf8')) &&
      /schemePresets: SCHEME_PRESETS/.test(readFileSync(resolve(ROOT, 'miniprogram/subpackages/manager/manager/managerPageConfig.js'), 'utf8')))
}

/* ------------------------------------------------------------------ *
 * 5) 祈福墙专项：预设 → C 端入口组件的 URL 同源；页面必须回落默认墙
 * ------------------------------------------------------------------ */
{
  const wishWallUtil = (() => {
    const m = { exports: {} }
    const read = (f) => readFileSync(resolve(ROOT, 'miniprogram/' + f), 'utf8')
    // ⚠️ 必须传 `require` 桩：wishWall.js 真的 require('../config/blessTags')；
    // 且不传时 Node 会对该源码做模块格式嗅探并抛 ERR_AMBIGUOUS_MODULE_SYNTAX（实测）
    const req = (id) => {
      const name = String(id)
      if (name.includes('blessTags')) return { resolveBlessTags: () => [] }
      // ⚠️ 2026-09-21：`wishWall.js` 新增了 `require('./wishTextCount')`（字数口径的唯一实现），
      //    而原桩只认带 `config/` 或 `utils/` 的写法 → `./wishTextCount` 落到 throw：
      //    `Error: unstubbed ./wishTextCount`，本守卫当场红。
      //    **守卫正确地抓到了新引入的跨模块依赖**（这正是它该做的）。
      //    修法：**同级相对路径**（`./x`）按被加载文件自己的目录（这里是 `utils/`）解析，
      //    这样以后再往 `wishWall.js` 加同级依赖，不会被同一类问题再咬一次。
      const rel = name.startsWith('.') && !name.startsWith('..') ? 'utils/' + name.replace(/^\.\//, '') : name
      if (rel.includes('config/') || rel.includes('utils/')) {
        const m2 = { exports: {} }
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', read(rel.replace(/^\.\.\//, '').replace(/^\.\//, '') + '.js'))(m2, m2.exports)
        return m2.exports
      }
      throw new Error('unstubbed ' + name)
    }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', read('utils/wishWall.js'))(m, m.exports, req)
    return m.exports
  })()
  const built = wishWallUtil.buildWishWallUrl({ _id: 'p1', title: '马上有', wishWallEnabled: true }, { from: 'detail' })
  check('★ C 端入口组件生成的 URL 与候选 path 同源（前缀一致）',
    built.indexOf('/subpackages/feature/wish-labels/index?') === 0, built)
  const pageSrc = readSrc(WISH + '.js')
  // 允许两种等价写法：
  //   A) setData 内联 productKey: normalizeProductKey(...)
  //   B) 局部变量 const productKey = normalizeProductKey(...); setData({ productKey })
  // 判据钉「opts || fromScene 回落」+「结果写入 productKey」，勿要求过时的内联字面。
  check('★ 缺失/非法 productKey 一律回落默认墙（海报不带参数也能打开）',
    /normalizeProductKey\(opts\.productKey \|\| fromScene\.productKey\)/.test(pageSrc) &&
      (/productKey:\s*normalizeProductKey/.test(pageSrc) ||
        /const\s+productKey\s*=\s*normalizeProductKey/.test(pageSrc)))
  check('页面同时接受 scene（门店小程序码）与 productKey 两种作用域来源',
    /parseWishWallScene/.test(pageSrc))
  const preset = presets.find((p) => p.id === 'wish-wall')
  check('候选里也允许带 productKey（指向某一面墙）',
    ssot.validateSchemePath('/subpackages/feature/wish-labels/index?productKey=k').ok === true,
    JSON.stringify(ssot.validateSchemePath('/subpackages/feature/wish-labels/index?productKey=k')))
  eq('常见拼错（外链 / 相对路径）仍被拦', ssot.validateSchemePath('https://x.com/a').ok, false)
  void preset
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, BANNER_PRESETS_INJECT: name },
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

console.log(`\n装修海报功能页候选断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 功能页候选通过（路径真实可达 / 核心落点在列含祈福墙 / 两份副本逐项一致）')
