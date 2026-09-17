/**
 * 列表封面（礼赠 hub / 标本师主页）守卫
 *
 * 真机反馈：两处列表**封面全空**（标题价格正常）。实测（tcb fn invoke getGiftSceneProducts）确认：
 *   商品的 `images[0]` 就是 `cloud://` 云文件 ID，图是好的 —— 问题在客户端各写了一套封面逻辑：
 *   · 礼赠 hub 把 `cloud://` 转临时链，转换没命中时**把值丢成空串**（`… : ''`）→ 封面全空；
 *   · 标本师主页只认服务端临时链（会过期），没有「原始云文件 ID」这条更稳的路。
 * 而本仓既有口径（首页 / 馆藏 ProductList）是：**云文件 ID 直接交给 <image>**（可直接渲染、不过期），
 * 需要缩略时才 `thumbUrl()`（不可用时回落原值）。
 *
 * 本守卫钉住：① 取值链是共享的、**绝不把 cloud:// 丢空**；② 两页都走共享链；
 *            ③ 列表数据里不再依赖会过期的临时链；④ 封面加载失败有回落，不留破图。
 *
 * 用法：
 *   node miniprogram/scripts/test-list-cover-images.mjs
 *   node miniprogram/scripts/test-list-cover-images.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const IMAGE_URL = 'miniprogram/utils/imageUrl.js'
const HUB_JS = 'miniprogram/subpackages/feature/gift/hub/index.js'
const HUB_WXML = 'miniprogram/subpackages/feature/gift/hub/index.wxml'
const FRAMER_JS = 'miniprogram/subpackages/business/framer/index.js'
const STAFF_FN = 'miniprogram/cloudfunctions/manageStaff/index.js'

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

/** imageUrl 里用到 wx（getImageInfo）—— 桩掉即可，firstImageOf 本身是纯函数 */
function loadImageUrl() {
  const module = { exports: {} }
  const wxStub = { getImageInfo: () => {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'wx', read(IMAGE_URL))(module, module.exports, wxStub)
  return module.exports
}

const imageUrl = loadImageUrl()
const hubJs = stripComments(read(HUB_JS))
const hubWxml = read(HUB_WXML)
const framerJs = stripComments(read(FRAMER_JS))
const staffFn = stripComments(read(STAFF_FN))

/* ── 1) 取值链（纯函数，真源码） ─────────────────────────────────────────── */
eq('★ images[0] 优先（即使它是 cloud:// 也不能丢）',
  imageUrl.firstImageOf({ images: ['cloud://env.bucket/products/a.png'] }), 'cloud://env.bucket/products/a.png')
eq('★ cloud:// 不会被判空', imageUrl.firstImageOf({ images: ['cloud://x'] }) === '' , false)
eq('images 空 → 回落 image', imageUrl.firstImageOf({ images: [], image: 'b' }), 'b')
eq('回落 coverImage（服务端字段）', imageUrl.firstImageOf({ coverImage: 'c' }), 'c')
eq('回落 cover', imageUrl.firstImageOf({ cover: 'd' }), 'd')
eq('回落 httpImage', imageUrl.firstImageOf({ httpImage: 'e' }), 'e')
eq('全空 → 空串', imageUrl.firstImageOf({ images: [] }), '')
eq('null 安全', imageUrl.firstImageOf(null), '')
eq('空白字符串不算有效值', imageUrl.firstImageOf({ image: '   ', cover: 'd' }), 'd')

/* ── 2) 礼赠 hub ─────────────────────────────────────────────────────────── */
check('★ hub 封面走共享取值链', /imageUrl\.firstImageOf\(/.test(hubJs))
check('★ hub 不再为封面做临时链转换（会过期、失败即丢空）',
  !/batchTempFileURLs\s*\(/.test(hubJs), '又回去转临时链 → 转换失败时封面会全空')
check('★ hub 不再出现「cloud:// 就丢空」的写法',
  !/startsWith\('cloud:\/\/'\)\s*\?\s*raw\s*:\s*''/.test(hubJs), 'cover 计算又把 cloud:// 丢成空串')
check('hub 封面经 thumbUrl（不可用时回落原值）', /imageUrl\.thumbUrl\(raw\)/.test(hubJs))
check('★ hub 封面加载失败有回落（不留破图）',
  /onCoverError\(e\)/.test(hubJs) && /binderror="onCoverError"/.test(hubWxml),
  '缺 binderror → 破图会一直挂着')

/* ── 3) 标本师主页 ───────────────────────────────────────────────────────── */
check('★ 标本师主页封面走共享取值链', /imageUrl\.firstImageOf\(item\)/.test(framerJs))
check('★ 标本师主页优先用不过期的原始 ID，而不是服务端临时链',
  /imageUrl\.thumbUrl\(raw\)/.test(framerJs) && /coverFileId/.test(framerJs),
  '仍只认会过期的临时链')
check('标本师主页保留兜底图与错误回落',
  /FALLBACK_COVER/.test(framerJs) && /onWorkCoverError/.test(read(FRAMER_JS)))
check('★ 云函数 works 同时给出原始云文件 ID 与 images',
  /coverFileId: raw/.test(staffFn) && /images: Array\.isArray\(item\.images\)/.test(staffFn),
  'works 只回传临时链 → 客户端没有更稳的来源')

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 列表封面检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 列表封面：${passed} 项通过（取值链不丢 cloud:// / 两页走同一链 / 不依赖会过期的临时链 / 有错误回落）`)
}

function selftest() {
  const injections = [
    {
      name: '取值链不再看 images（回到只认 coverImage）',
      file: IMAGE_URL,
      from: '  const candidates = [imgs[0], item.image, item.coverImage, item.cover, item.httpImage]',
      to: '  const candidates = [item.coverImage]'
    },
    {
      name: 'hub 又回去转临时链（失败即封面全空）',
      file: HUB_JS,
      from: '        const raw = imageUrl.firstImageOf(p)\n        const cover = raw ? imageUrl.thumbUrl(raw) : \'\'',
      to: '        const raw = imageUrl.firstImageOf(p)\n        const urlMap = await batchTempFileURLs([raw])\n        const cover = (raw && urlMap[raw]) || (raw && !String(raw).startsWith(\'cloud://\') ? raw : \'\') || \'\''
    },
    {
      name: 'hub 去掉封面错误回落',
      file: HUB_WXML,
      from: '                  binderror="onCoverError"\n',
      to: ''
    },
    {
      name: '标本师主页又只认临时链',
      file: FRAMER_JS,
      from: '        const raw = imageUrl.firstImageOf(item) || item.coverFileId || \'\'',
      to: "        const raw = item.coverImage || ''"
    },
    {
      name: '云函数 works 不再给原始云文件 ID',
      file: STAFF_FN,
      from: '        coverFileId: raw,\n',
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
