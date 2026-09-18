/**
 * 藏品图片上传守卫 行为断言（`subpackages/manager/utils/imageUploadGuard.js`）
 *
 * 为什么必须跑真源码：这条链路的正确性**只在"压缩工具的真实语义"下才成立** ——
 *   1. `wx.compressImage({ quality })` **只降质量、不改像素边长**（降边长要传 compressedWidth/compressHeight）；
 *   2. 所以"按边长决定是否继续压"的循环，若不真正降边长，条件会**恒为真**（2026-09-18 修复的那个 P0：
 *      所有手机原图被压到 quality 35 入库 → 详情主图/长图文/列表卡全线糊）；
 *   3. 压缩必须**每次从原图来**，压"上一次的输出"会累积代际损失。
 *
 * 本守卫用**忠实模拟微信语义**的桩（不传压缩尺寸=边长不变）把这些行为钉住。
 *
 * 用法：
 *   node miniprogram/scripts/test-image-upload-guard.mjs
 *   node miniprogram/scripts/test-image-upload-guard.mjs --selftest
 */
import { readFileSync } from 'node:fs'
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

const GUARD_FILE = 'miniprogram/subpackages/manager/utils/imageUploadGuard.js'

const INJECTIONS = {
  // 不传压缩尺寸 → 只降质量、边长不变（这就是把全站图压糊的原始 bug）
  'resize-param-dropped': {
    file: GUARD_FILE,
    from: '    if (size && size.width > 0 && size.height > 0) {\n      payload.compressedWidth = size.width\n      payload.compressHeight = size.height\n    }',
    to: '    void size'
  },
  // 声称支持降边长但实际没降 → 边长仍超限却放行（静默不缩）
  'resize-support-lying': {
    file: GUARD_FILE,
    from: '    return typeof wx.canIUse === \'function\' && wx.canIUse(\'compressImage.object.compressedWidth\') === true',
    to: '    return false'
  },
  // 压"上一次的输出" → 累积代际损失
  'cumulative-recompress': {
    file: GUARD_FILE,
    from: '      const out = await compress(filePath, quality, edgeReduced ? target : null)',
    to: '      const out = await compress(outPath, quality, edgeReduced ? target : null)'
  },
  // 去掉质量地板 → 又一路压到 30 以下
  'quality-floor-removed': {
    file: GUARD_FILE,
    from: 'const MIN_QUALITY = 70',
    to: 'const MIN_QUALITY = 20'
  },
  // 不再拦"分辨率过低" → 糊图能上架
  'min-edge-dropped': {
    file: GUARD_FILE,
    from: '  if (width && height && Math.max(width, height) < minEdge) {',
    to: '  if (false) {'
  },
  // 不再按边长收缩（fitEdge 恒返回 null）→ 大图原样入库
  'fit-edge-dropped': {
    file: GUARD_FILE,
    from: '  if (longest <= maxEdge) return null',
    to: '  return null\n  if (longest <= maxEdge) return null'
  }
}

const INJECT = String(process.env.IMG_UPLOAD_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/**
 * 忠实模拟 `wx.compressImage`：
 *   · 传 compressedWidth/compressHeight → 输出等比缩到该尺寸
 *   · 不传 → 输出**像素尺寸与源图完全一致**（微信语义；旧 bug 就错在以为它会缩）
 *   · quality 只影响字节；字节模型按"2400×1800 @q85 ≈ 0.92MB"校准
 */
function makeWx(opts = {}) {
  const resizeSupported = opts.resizeSupported !== false
  const registry = new Map()
  const calls = []
  let seq = 0
  const bytes = (w, h, q) => Math.round((w * h * 0.213 * q) / 85)
  const register = (path, width, height, size) => {
    registry.set(path, { width, height, size: size == null ? bytes(width, height, 90) : size })
    return path
  }
  const wx = {
    canIUse: (k) => (String(k).indexOf('compressImage.object.compressedWidth') !== -1 ? resizeSupported : false),
    getImageInfo: ({ src, success, fail }) => {
      if (opts.noImageInfo) {
        if (fail) fail({ errMsg: 'getImageInfo unavailable' })
        return
      }
      const rec = registry.get(src)
      if (!rec) {
        if (fail) fail({ errMsg: 'not found' })
        return
      }
      if (success) success({ width: rec.width, height: rec.height, path: src })
    },
    getFileSystemManager: () => ({
      getFileInfo: ({ filePath, success, fail }) => {
        const rec = registry.get(filePath)
        if (!rec) {
          if (fail) fail({ errMsg: 'not found' })
          return
        }
        if (success) success({ size: rec.size })
      }
    }),
    compressImage: (o) => {
      const rec = registry.get(o.src)
      if (!rec) {
        if (o.fail) o.fail({ errMsg: 'bad src' })
        return
      }
      calls.push({ src: o.src, quality: o.quality, w: o.compressedWidth, h: o.compressHeight })
      let w = rec.width
      let h = rec.height
      if (resizeSupported && o.compressedWidth > 0 && o.compressHeight > 0) {
        w = o.compressedWidth
        h = o.compressHeight
      }
      const out = `tmp_${++seq}`
      register(out, w, h, bytes(w, h, o.quality))
      if (o.success) o.success({ tempFilePath: out })
    }
  }
  return { wx, registry, calls, register, bytes }
}

function loadGuard(wxStub) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'wx', readSrc(GUARD_FILE))(module, module.exports, wxStub)
  return module.exports
}

const MB = 1024 * 1024

/* ------------------------------------------------------------------ *
 * 1) 纯函数：等比目标边长
 * ------------------------------------------------------------------ */
{
  const guard = loadGuard(makeWx().wx)
  eq('不需要缩小时返回 null（不无谓压缩）', guard.fitEdge(1200, 900, 2400), null)
  eq('长边等于上限也不缩', guard.fitEdge(2400, 1000, 2400), null)
  eq('★ 4000×3000 等比缩到 2400×1800（4:3 不变形）',
    JSON.stringify(guard.fitEdge(4000, 3000, 2400)), JSON.stringify({ width: 2400, height: 1800 }))
  eq('竖图按长边缩（3000×4000 → 1800×2400）',
    JSON.stringify(guard.fitEdge(3000, 4000, 2400)), JSON.stringify({ width: 1800, height: 2400 }))
  eq('正方形也等比', JSON.stringify(guard.fitEdge(5000, 5000, 2400)), JSON.stringify({ width: 2400, height: 2400 }))
  eq('极小图不会算出 0 边', guard.fitEdge(5000, 3, 2400).height, 1)
  eq('缺边长 → 不缩（交给后续核验）', guard.fitEdge(0, 0, 2400), null)
  check('导出质量地板与首选质量', guard.MIN_QUALITY >= 70 && guard.TARGET_QUALITY >= guard.MIN_QUALITY)
}

/* ------------------------------------------------------------------ *
 * 2) 放行 / 拒绝
 * ------------------------------------------------------------------ */
{
  const sim = makeWx()
  const guard = loadGuard(sim.wx)
  sim.register('ok.jpg', 1200, 900, 1.2 * MB)
  const r = await guard.prepareUploadImage('ok.jpg', { label: '藏品图' })
  eq('合规图放行', r.ok, true)
  eq('合规图路径原样（不压缩）', r.path, 'ok.jpg')
  eq('★ 合规图一次压缩都不做', r.info.compressedTimes, 0)

  const sim2 = makeWx()
  const guard2 = loadGuard(sim2.wx)
  sim2.register('small.jpg', 300, 200, 40 * 1024)
  const r2 = await guard2.prepareUploadImage('small.jpg', { label: '藏品图' })
  eq('★ 分辨率过低的图被拒（不让糊图上架）', r2.ok, false)
  check('拒绝理由说清长边下限', /分辨率过低/.test(r2.reason || '') && /400px/.test(r2.reason || ''), r2.reason)

  eq('缺路径直接拒绝', (await guard.prepareUploadImage('', {})).ok, false)
}

/* ------------------------------------------------------------------ *
 * 3) ★ 大图必须真的降边长（本轮 P0 的回归判据）
 * ------------------------------------------------------------------ */
{
  const sim = makeWx()
  const guard = loadGuard(sim.wx)
  sim.register('big.jpg', 4000, 3000, 6 * MB)
  const r = await guard.prepareUploadImage('big.jpg', { label: '藏品图' })
  eq('超大手机原图放行', r.ok, true)
  eq('★ 输出长边 ≤ 2400（旧实现是 4000 + quality 35）', Math.max(r.info.outWidth, r.info.outHeight), 2400)
  eq('★ 等比：4000×3000 → 2400×1800', `${r.info.outWidth}x${r.info.outHeight}`, '2400x1800')
  eq('★ 只压一次就达标（不空转、不累积）', r.info.compressedTimes, 1)
  eq('★ 压缩来源始终是原图（不压上一次的输出）', sim.calls.every((c) => c.src === 'big.jpg'), true)
  eq('★ 首选质量 88，不因边长修复而无谓降质', r.info.quality, 88)
  eq('体积落在预算内', r.info.overBudget, false)
  eq('标记"边长已按比例缩放"', r.info.edgeReduced, true)
  check('压缩尺寸参数真的传下去了（否则边长不会变）', sim.calls[0].w === 2400 && sim.calls[0].h === 1800,
    JSON.stringify(sim.calls[0]))
}

/* ------------------------------------------------------------------ *
 * 4) ★ 紧预算下的质量地板：宁可变大，也不把图压糊
 * ------------------------------------------------------------------ */
{
  const sim = makeWx()
  const guard = loadGuard(sim.wx)
  sim.register('big.jpg', 4000, 3000, 6 * MB)
  // 预算压到 300KB：边长已到 2400，仍需降质量
  const r = await guard.prepareUploadImage('big.jpg', { label: '藏品图', maxBytes: 300 * 1024 })
  eq('边长仍然达标（先缩后降质）', Math.max(r.info.outWidth, r.info.outHeight), 2400)
  eq('★ 质量不低于地板 70（旧实现会掉到 35）', r.info.quality >= 70, true)
  eq('★ 回传的是**实际生效**的质量（不是循环多减一步的值）', r.info.quality, 78)
  eq('每次降质都从原图重来', sim.calls.every((c) => c.src === 'big.jpg'), true)
  eq('★ 地板仍超预算 → 标记 overBudget 但**放行**（不阻塞管理员）', r.info.overBudget, true)
  eq('放行状态是 ok', r.ok, true)
}

/* ------------------------------------------------------------------ *
 * 5) 基础库不支持降边长：清晰度不降（旧实现此路径必然压到 35）
 * ------------------------------------------------------------------ */
{
  const sim = makeWx({ resizeSupported: false })
  const guard = loadGuard(sim.wx)
  sim.register('big.jpg', 4000, 3000, 6 * MB)
  const r = await guard.prepareUploadImage('big.jpg', { label: '藏品图' })
  eq('放行（工具缺失不阻塞业务）', r.ok, true)
  eq('★ 不支持降边长时不谎报 edgeReduced', r.info.edgeReduced, false)
  eq('★ 质量仍在地板之上（不因无法缩边就压糊）', r.info.quality >= 70, true)
  eq('★ 不会出现"压了 4 次、质量 35"的旧行为', r.info.quality >= 70 && r.info.compressedTimes <= 3, true)
}

/* ------------------------------------------------------------------ *
 * 6) 降级与批量
 * ------------------------------------------------------------------ */
{
  const sim = makeWx({ noImageInfo: true })
  const guard = loadGuard(sim.wx)
  sim.register('x.jpg', 800, 600, 200 * 1024)
  const r = await guard.prepareUploadImage('x.jpg', { label: '藏品图' })
  eq('读不到图片信息 → 降级放行（兼容旧基础库）', r.ok, true)

  const sim2 = makeWx()
  const guard2 = loadGuard(sim2.wx)
  sim2.register('a.jpg', 1200, 900, 1.1 * MB)
  sim2.register('b.jpg', 200, 150, 20 * 1024)
  sim2.register('c.jpg', 4000, 3000, 6 * MB)
  const batch = await guard2.prepareUploadImages(['a.jpg', 'b.jpg', 'c.jpg'], { label: '藏品图' })
  eq('批量：过小的被拒', batch.rejected.length, 1)
  eq('批量：其余仍可用（不因单张失败中断）', batch.accepted.length, 2)
  eq('批量：返回每张的压缩摘要（调用方可提示体积）', batch.infos.length, 2)
  eq('批量：大图同样真的降了边长', Math.max(batch.infos[1].outWidth, batch.infos[1].outHeight), 2400)
}

/* ------------------------------------------------------------------ *
 * 7) 极端体积才拒绝（且有可读原因）
 * ------------------------------------------------------------------ */
{
  const sim = makeWx({ resizeSupported: false })
  const guard = loadGuard(sim.wx)
  sim.register('huge.jpg', 20000, 15000, 80 * MB)
  const r = await guard.prepareUploadImage('huge.jpg', { label: '藏品图' })
  eq('超大且压不动 → 拒绝', r.ok, false)
  check('拒绝理由可读且给了硬上限', /硬上限/.test(r.reason || '') && /裁剪/.test(r.reason || ''), r.reason)
}

/* ------------------------------------------------------------------ *
 * 8) 调用点：守卫仍挂在藏品图选图路径上（组件被摘掉也算回归）
 * ------------------------------------------------------------------ */
{
  const manager = readFileSync(resolve(ROOT, 'miniprogram/subpackages/manager/manager/managerPageConfig.js'), 'utf8')
  check('★ 藏品图选图仍走 prepareUploadImages', /prepareUploadImages\(picked/.test(manager))
  check('拒绝项仍逐条告知原因（不静默丢弃）', /rejected\.length/.test(manager) && /未通过校验/.test(manager))
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, IMG_UPLOAD_INJECT: name },
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

console.log(`\n藏品图上传守卫断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 上传守卫通过（真降边长 / 只从原图压 / 质量地板 70 / 过小拒绝 / 工具缺失降级放行）')
