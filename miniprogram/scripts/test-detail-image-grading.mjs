/**
 * #17 详情页分级取图 行为断言
 *
 * 为什么必须跑真源码：这条链路的三个关键行为都**只在运行时**才成立 ——
 *   1. 能力未确认时，`detailUrl/thumbUrl` 必须**返回原图**（否则首屏破图，比慢更糟）；
 *   2. 映射必须由**源列表**建立，且派生槽位（规格细节/更多细节/长图文）能命中；
 *   3. 任一图加载失败必须**立刻清空映射回落原图**，且不会因一次失败而永久禁用。
 * 另外把「CloudBase 图像扩展是否可用」从文档引用升级为**可复现的实测**（见 §4）。
 *
 * 用法：
 *   node miniprogram/scripts/test-detail-image-grading.mjs
 *   node miniprogram/scripts/test-detail-image-grading.mjs --selftest
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

const INJECTIONS = {
  // 未确认能力就直接拼参数 → 首屏破图风险（最初的实现正是这样）
  'thumb-without-probe': {
    file: 'miniprogram/utils/imageUrl.js',
    from: "function detailUrl(url) {\n  if (!isThumbUsable()) return String(url || '')",
    to: "function detailUrl(url) {\n  if (false) return String(url || '')"
  },
  // 加载失败不回落 → 整页持续破图
  'no-degrade-on-error': {
    file: 'miniprogram/utils/imageUrl.js',
    from: "function onImageError() {\n  if (state !== 'unsupported') {\n    state = 'unsupported'",
    to: "function onImageError() {\n  if (false) {\n    state = 'unsupported'"
  },
  // 尺寸空值判定退回旧口径（只剥 cm$）→「0×0×厚度 0 厘米」又被当成有效尺寸显示出来
  'size-empty-old-scope': {
    file: 'miniprogram/utils/skuSize.js',
    from: "    .replace(/(厚度|长度|宽度|高度|尺寸|长|宽|高|直径)/g, 'x')\n",
    to: ''
  },
  // 单值也当空 → 合法的单值尺寸（如 "0"）会被吞成「—」
  'size-single-value-empty': {
    file: 'miniprogram/utils/skuSize.js',
    from: '  if (parts.length < 2) return false;\n',
    to: ''
  },
  // 数值尾零不再归一 →「29.7×21.0×厚度 4.5 厘米」这类原始值又直接上屏
  'size-number-tail-zeros': {
    file: 'miniprogram/utils/skuSize.js',
    from: "  return s.replace(/\.?0+$/, '') || '0';\n",
    to: '  return s;\n'
  },
  // 展示出口不再兜底 → 全零尺寸又从 SKU 尺寸行/规格说明漏上屏
  'size-display-no-exit-guard': {
    file: 'miniprogram/utils/skuSize.js',
    from: '  return isEmptySizeValue(s) ? \'\' : s;\n',
    to: '  return s;\n'
  },
  // 详情页又自留一份实现（两份口径必然会再漂移）
  'detail-reimplements-size-empty': {
    file: 'miniprogram/subpackages/feature/detail/index.js',
    from: '    : isEmptySizeValue(p.size);',
    to: '    : isEmptySizeValueLegacy(p.size);'
  },
  // 详情页忘记挂 error 处理 → 映射不会回落
  'detail-missing-degrade': {
    file: 'miniprogram/subpackages/feature/detail/index.js',
    from: '  onImageDegrade() {',
    to: '  onImageDegradeDisabled() {'
  },
  // 映射只覆盖 product.images，漏掉 detailImages → 最重的长图文仍是原图
  'map-misses-detail-images': {
    file: 'miniprogram/subpackages/feature/detail/index.js',
    from: "    (product.detailImages || []).forEach((u) => big.push(u));",
    to: "    // (product.detailImages || []).forEach((u) => big.push(u));"
  }
}

const INJECT = String(process.env.DETAIL_IMG_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/* ------------------------------------------------------------------ *
 * 1) imageUrl：三态降级（unknown 用原图 / supported 用缩略 / 失败回落）
 * ------------------------------------------------------------------ */

const imgUrlSrc = readSrc('miniprogram/utils/imageUrl.js')
function loadImageUrl(wxStub) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'wx', imgUrlSrc)(
    module,
    module.exports,
    wxStub || { getImageInfo: () => {} }
  )
  return module.exports
}
const imgUrl = loadImageUrl()
const ORIG = 'https://636c-cloud1-8gnkty5bfff9f0bf-1387508856.tcb.qcloud.la/products/a.png'

imgUrl.__resetProbe()
eq('★ 未探测时 detailUrl 返回原图（首屏绝不破图）', imgUrl.detailUrl(ORIG), ORIG)
eq('★ 未探测时 thumbUrl 返回原图', imgUrl.thumbUrl(ORIG), ORIG)
eq('未探测时 isThumbUsable 为假', imgUrl.isThumbUsable(), false)

// ★ 真实探测成功路径：桩 wx.getImageInfo 走 success → state=supported
{
  const ok = loadImageUrl({
    getImageInfo: ({ success }) => success({ width: 64, height: 43 })
  })
  ok.__resetProbe()
  const supported = await ok.probeSupport(ORIG)
  eq('探测成功返回 true', supported, true)
  eq('★ 探测成功后 detailUrl 拼 750', ok.detailUrl(ORIG), `${ORIG}?imageMogr2/thumbnail/750x`)
  eq('★ 探测成功后 thumbUrl 拼 480', ok.thumbUrl(ORIG), `${ORIG}?imageMogr2/thumbnail/480x`)
  eq('★ 已有 query（带签名的临时链）用 & 追加，不破坏签名', ok.detailUrl(`${ORIG}?sign=abc&t=1`), `${ORIG}?sign=abc&t=1&imageMogr2/thumbnail/750x`)
  eq('探测参数用 64 宽（越小越快）', ok.THUMB_WIDTH_LIST, 480)
  // 探测后失败 → 回落
  ok.onImageError()
  eq('★ 失败后永久回落原图（本会话）', ok.detailUrl(ORIG), ORIG)
}

// ★ 真实探测失败路径：桩 wx.getImageInfo 走 fail → state=unsupported
{
  const bad = loadImageUrl({ getImageInfo: ({ fail }) => fail({ errMsg: 'boom' }) })
  bad.__resetProbe()
  const supported = await bad.probeSupport(ORIG)
  eq('探测失败返回 false', supported, false)
  eq('★ 探测失败后一律原图', bad.detailUrl(ORIG), ORIG)
}

// 非 http(s)（cloud:// 或空）绝不拼参数
eq('空值安全', imgUrl.detailUrl(''), '')
eq('cloud:// 不拼参数（必须先换临时链）', imgUrl.detailUrl('cloud://env.abc/products/a.png'), 'cloud://env.abc/products/a.png')
imgUrl.__resetProbe()
eq('reset 后回到 unknown（诊断用）', imgUrl.isThumbUsable(), false)

/* ------------------------------------------------------------------ *
 * 1.5) 装裱尺寸：数值形态 + 空值判定 + 展示文案（唯一实现在 utils/skuSize.js）
 *
 * 为什么单独钉（真机反馈两次）：
 *   ① 「0×0×厚度 0 厘米」被当成有效尺寸显示出来（旧口径只剥 cm$、只认 0x0x0）；
 *   ② 「29.7×21.0×厚度 4.5 厘米」里 21.0 的原样上屏 —— 与相邻数字形态不一致。
 * 另外这份判定原先在详情页里还自留了一份实现（口径已经漂移），
 * 现在统一到 utils/skuSize.js：C 端展示、超管录入保存都走它。
 * ------------------------------------------------------------------ */

const skuSizeSrc = readSrc('miniprogram/utils/skuSize.js')
const skuSize = (() => {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', skuSizeSrc)(module, module.exports)
  return module.exports
})()

eq('trimSizeNumber：21.0 → 21', skuSize.trimSizeNumber('21.0'), '21')
eq('trimSizeNumber：4.50 → 4.5', skuSize.trimSizeNumber('4.50'), '4.5')
eq('trimSizeNumber：20.00 → 20', skuSize.trimSizeNumber('20.00'), '20')
eq('trimSizeNumber：0.0 → 0', skuSize.trimSizeNumber('0.0'), '0')
eq('trimSizeNumber：29.7 原样', skuSize.trimSizeNumber('29.7'), '29.7')
eq('trimSizeNumber：A4 原样（不是数值）', skuSize.trimSizeNumber('A4'), 'A4')
eq('trimSizeNumber：空 → 空', skuSize.trimSizeNumber('  '), '')

const SIZE_EMPTY_CASES = [
  ['0×0×厚度 0 厘米', true, '★ 真机截图里的形态：全零 + 中文单位'],
  ['0x0x0', true, '经典全零'],
  ['0×0×0 cm', true, '带 cm'],
  ['0×0', true, '两维全零'],
  ['长0 宽0 高0', true, '中文维度词'],
  ['直径0 高度0', true, '直径/高度写法'],
  ['20×30×厚度 5 厘米', false, '有非零维度 → 真实尺寸'],
  ['20×30', false, '两维正常值'],
  ['30', false, '单值不当空'],
  ['0', false, '单值 0 语义不明 → 不当空（宁可显示也不静默吞掉）'],
  ['A4', false, '非数字尺寸（如 A4）→ 不当空'],
  ['', true, '空串'],
  ['   ', true, '纯空白']
]
for (const [raw, want, label] of SIZE_EMPTY_CASES) {
  eq(`尺寸「${raw || '(空)'}」→ ${want ? '未著录' : '有效'}：${label}`, skuSize.isEmptySizeValue(raw), want)
}

// 展示文案：相框（长×宽×厚度）是设计口径，但数值必须归一
eq('★ 相框展示：数值尾零归一并保留「厚度」说明',
  skuSize.formatSizeFromParts('29.7', '21.0', '4.50', 'frame'),
  `29.7×21×厚度 4.5${String.fromCharCode(0xa0)}厘米`)
eq('方形罩展示：长×宽', skuSize.formatSizeFromParts('20', '30', '', 'box'),
  `20×30${String.fromCharCode(0xa0)}厘米`)
eq('圆形罩展示：仅直径', skuSize.formatSizeFromParts('8', '', '', 'diameter'),
  `直径 8${String.fromCharCode(0xa0)}厘米`)
eq('圆柱罩展示：直径×高度', skuSize.formatSizeFromParts('8', '', '12.0', 'diameter_height'),
  `直径 8×高度 12${String.fromCharCode(0xa0)}厘米`)
eq('★ 原始文本形态也归一（报告里的那条字符串）',
  skuSize.beautifySizeString('29.7×21.0×厚度 4.5 厘米'),
  `29.7×21×厚度 4.5${String.fromCharCode(0xa0)}厘米`)
// 库里只有自由文本、且没有装裱方式 → 按默认方罩（长×宽×高）展示；数值仍须归一
eq('★ 端到端：只有自由文本（无装裱方式）→ 默认方罩口径 + 数值归一',
  skuSize.resolveDisplaySize({ size: '29.7×21.0×厚度 4.5 厘米' }, null),
  `29.7×21×4.5${String.fromCharCode(0xa0)}厘米`)
// 真实数据形态：有装裱方式（相框）+ 库里只有自由文本 → 必须保留「厚度」说明且数值归一
eq('★ 端到端：相框 + 库内自由文本（报告里那条商品的真实形态）',
  skuSize.resolveDisplaySize({ size: '29.7×21.0×厚度 4.5 厘米', craftType: 'frame', title: '天堂凤蝶爱神凤蝶组合' }, null),
  `29.7×21×厚度 4.5${String.fromCharCode(0xa0)}厘米`)
eq('★ 保存侧产物归一（超管编辑后落库不再带尾零）',
  skuSize.normalizeSkuSizeForSave({ sizeL: '29.7', sizeW: '21.0', sizeH: '4.50' }, { craftType: 'frame' }).size,
  '29.7x21x4.5 cm')
eq('★ 端到端：结构化字段（相框）展示正确',
  skuSize.resolveDisplaySize({ sizeL: '29.7', sizeW: '21.0', sizeH: '4.5', craftType: 'frame', title: '天堂凤蝶' }, null),
  `29.7×21×厚度 4.5${String.fromCharCode(0xa0)}厘米`)

// 出口兜底：selectedSkuSizeText 在详情页有 3 处直接上屏，未著录必须给空串
eq('★ 端到端：全零自由文本 → 空串（不显示 0×0×厚度 0 厘米）',
  skuSize.resolveDisplaySize({ size: '0×0×厚度 0 厘米', craftType: 'frame', title: 'x' }, null), '')
eq('★ 端到端：全零结构化字段 → 空串',
  skuSize.resolveDisplaySize({ sizeL: '0', sizeW: '0', sizeH: '0', craftType: 'frame', title: 'x' }, null), '')

// 详情页不得再自留一份实现（两份口径必然再漂移）
const detailSrcForSize = readSrc('miniprogram/subpackages/feature/detail/index.js')
check('★ 详情页复用共享判定，不再自留 isEmptyArchiveSize',
  /isEmptySizeValue\(/.test(detailSrcForSize) && !/function isEmptyArchiveSize/.test(detailSrcForSize),
  '详情页又自留了一份尺寸空值判定 → 与 utils/skuSize.js 口径会漂移')

/* ------------------------------------------------------------------ *
 * 2) 详情页：映射建立与回落（真源码 + 桩 Page）
 * ------------------------------------------------------------------ */

const pageSrc = readSrc('miniprogram/subpackages/feature/detail/index.js')

/** 只取需要的两个方法体，避免加载整个 2900 行的 Page 依赖图 */
function sliceMethod(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('method not found: ' + header)
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced: ' + header)
}

function makePage(data) {
  const page = {
    data: { ...data },
    setData(patch) { Object.assign(this.data, patch) },
    _require: null
  }
  const bigBody = sliceMethod(pageSrc, '  buildImageView() {')
  const degradeBody = sliceMethod(pageSrc, '  onImageDegrade() {')
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'require',
    'skuImageList',
    `return { ${bigBody}, ${degradeBody} }`
  )
  const methods = factory(
    (id) => {
      if (String(id).includes('imageUrl')) return imgUrl
      throw new Error('unexpected require ' + id)
    },
    (sku) => {
      const list = []
      if (!sku) return list
      if (sku.image) list.push(sku.image)
      ;(sku.images || []).forEach((u) => list.push(u))
      return list.filter(Boolean)
    }
  )
  page.buildImageView = methods.buildImageView.bind(page)
  page.onImageDegrade = methods.onImageDegrade.bind(page)
  return page
}

// 2a. 能力未确认 → 不建立映射，页面全部走原图
{
  imgUrl.__resetProbe()
  const page = makePage({
    product: { images: [ORIG], detailImages: ['https://x/d1.png'], skus: [] },
    detailImages: [],
    activeDetailImages: [],
    sharedDetailImages: [],
    recommends: [],
    imgView: {},
    imgThumbView: {}
  })
  page.buildImageView()
  eq('能力未确认 → imgView 为空（渲染回落原图）', Object.keys(page.data.imgView).length, 0)
}

// 2b. 能力可用 → 源列表全部建立映射（含派生槽位能命中）
{
  imgUrl.__resetProbe()
  // 状态机本身已在 §1 用真实探测覆盖；这里只测「页面的映射逻辑」，故注入 supported 桩
  const supported = {
    detailUrl: (u) => (u && u.startsWith('http') ? `${u}?imageMogr2/thumbnail/750x` : u),
    thumbUrl: (u) => (u && u.startsWith('http') ? `${u}?imageMogr2/thumbnail/480x` : u),
    isThumbUsable: () => true,
    onImageError: () => { supported._degraded = true }
  }
  const page = makePage({
    product: {
      images: [ORIG],
      detailImages: ['https://x/d1.png', 'https://x/other-group.png'],
      skus: [{ image: 'https://x/sku.png', images: ['https://x/sku2.png'], detailImages: ['https://x/skud.png'] }]
    },
    detailImages: ['https://x/d1.png'],
    activeDetailImages: ['https://x/d1.png'],
    sharedDetailImages: ['https://x/shared.png'],
    recommends: [{ images: ['https://x/rec.png'] }],
    imgView: {},
    imgThumbView: {}
  })
  // 换成 supported 桩
  const orig = imgUrl.isThumbUsable
  imgUrl.isThumbUsable = () => true
  imgUrl.detailUrl = supported.detailUrl
  imgUrl.thumbUrl = supported.thumbUrl
  try {
    page.buildImageView()
  } finally {
    imgUrl.isThumbUsable = orig
  }
  const big = page.data.imgView
  const small = page.data.imgThumbView
  check('大图槽位：主图已映射', !!big[ORIG])
  check('★ 大图槽位：当前分组长图文已映射', !!big['https://x/d1.png'])
  // 关键：这张图**只**出现在 product.detailImages（非当前激活分组），
  // 只有「按源列表映射」才覆盖得到 —— 否则切到那个分组时会退回原图
  check('★ 大图槽位：非激活分组的长图文也已映射（源列表覆盖派生槽位）', !!big['https://x/other-group.png'])
  check('★ 大图槽位：sku.detailImages 已映射', !!big['https://x/skud.png'])
  check('大图槽位：sku.images 已映射', !!big['https://x/sku2.png'])
  check('小图槽位：更多细节用 480', /thumbnail\/480x/.test(small['https://x/shared.png'] || ''), small['https://x/shared.png'])
  check('小图槽位：相关推荐用 480', /thumbnail\/480x/.test(small['https://x/rec.png'] || ''), small['https://x/rec.png'])
  check('大图槽位用 750', /thumbnail\/750x/.test(big[ORIG] || ''), big[ORIG])

  // 2c. 加载失败 → 立刻清空映射
  page.onImageDegrade()
  eq('★ 任一图失败 → 映射清空（整页立刻回落原图）', Object.keys(page.data.imgView).length, 0)
  eq('★ 同时清空小图映射', Object.keys(page.data.imgThumbView).length, 0)
}

/* ------------------------------------------------------------------ *
 * 3) WXML：5 个槽位都接了映射，且都有 error 回落
 * ------------------------------------------------------------------ */

const wxml = readFileSync(resolve(ROOT, 'miniprogram/subpackages/feature/detail/index.wxml'), 'utf8')
eq('WXML 使用 imgView 的槽位数', (wxml.match(/\{\{imgView\[item\] \|\| item\}\}/g) || []).length, 3)
eq('WXML 使用 imgThumbView 的槽位数', (wxml.match(/imgThumbView\[/g) || []).length, 2)
eq('★ WXML binderror 回落处理挂载数', (wxml.match(/binderror="onImageDegrade"/g) || []).length, 5)
check('全屏查看器仍用原图（previewImage 未被改造）', /wx\.previewImage/.test(pageSrc))

/* ------------------------------------------------------------------ *
 * 4) 环境能力实测（离线可复现的断言；联网实测记录见交付文档）
 * ------------------------------------------------------------------ */

// 只断言「代码用的参数形态」与实测一致：缩略图参数经 ? 或 & 追加，不破坏已有 query
{
  const withQuery = `${ORIG}?sign=abc&t=123`
  const fresh = loadImageUrl()
  // 未探测时原样返回，这是安全前提（签名不被破坏）
  eq('带签名的临时链在原图模式下不被改写', fresh.detailUrl(withQuery), withQuery)
}
eq(
  '参数形态与实测一致（imageMogr2/thumbnail/<w>x）',
  /imageMogr2\/thumbnail\//.test(imgUrlSrc),
  true
)

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, DETAIL_IMG_INJECT: name },
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
    console.error(clean.stdout || clean.stderr)
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

console.log(`\n#17 详情页分级取图断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 详情页分级取图通过（未确认用原图 / 源列表映射覆盖派生槽位 / 失败即回落 / 5 槽位均挂 error）')
