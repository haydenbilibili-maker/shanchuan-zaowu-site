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
const stripComments = (t) => String(t)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

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
  console.log('✓ selftest 通过：注入「页面不在白名单」与「密钥文件不再被忽略」均被检出，且已还原源文件')
  process.exit(0)
}

console.log(`祈福墙门店码：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ scene 解析 / 页面接线 / 白名单 / 清单与资产校验全部通过')
