#!/usr/bin/env node
/**
 * 藏品视频 / 实况（`products.media`）守卫 —— 2026-09-28 产品点名「超管-藏品库-商品图片上传支持 Live/视频」。
 *
 * 要守的不变量（全部来自这次改动的风险面）：
 *   A. 服务端：`media` 进白名单并被净化；`images` / `coverImage` 里的视频地址被剥掉
 *      （全站把 images[0] 当封面图 —— 列表/推荐/购物车/订单/分享卡；视频地址落进去 = 一片空白图）。
 *   B. 客户端与服务端常量同口径（类型枚举 / 条数 / 时长 / 体积上限）。
 *   C. 店长端编辑区：chooseMedia 选到的视频只进 tempProduct.media，**绝不**进 images；
 *      视频相关处理器不写 images；保存载荷只在「有视频 / 原本有被删光」时才送 media
 *      （否则没载入过 media 的入口一保存就把库里视频清空）。
 *   D. 详情页：无 media → 走原来那条 images 轮播（带 wx:if 旁路），原轮播里没有 <video>；
 *      有 media → 首位仍是封面图，视频/实况排在其后，图片位永远不是视频地址；imageTotal 无视频时仍是 images.length。
 *   E. 全仓只有登记过的文件读 `.media`（购物车/订单/分享/推荐等拿不到视频当封面）。
 *
 * 自检不写盘：注入在**内存副本**上做（共享工作区有并行流在改 managerPageConfig.js 等文件，
 * 写盘注入→还原会覆盖别人的在写内容，见 AGENTS.md 对 selftest 的警告）。
 *
 * 用法：
 *   node miniprogram/scripts/check-product-media.mjs
 *   node miniprogram/scripts/check-product-media.mjs --selftest
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MP = resolve(ROOT, 'miniprogram')

const F = {
  cloudIndex: 'miniprogram/cloudfunctions/manageProducts/index.js',
  cloudMedia: 'miniprogram/cloudfunctions/manageProducts/productMedia.js',
  clientMedia: 'miniprogram/subpackages/manager/utils/productMedia.js',
  editorJs: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
  editorWxml: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
  heroMedia: 'miniprogram/subpackages/feature/utils/heroMedia.js',
  detailJs: 'miniprogram/subpackages/feature/detail/index.js',
  detailWxml: 'miniprogram/subpackages/feature/detail/index.wxml'
}

/** 允许读 `.media` 的文件（新增读者必须在这里登记 —— 并确认它不会把视频当封面图） */
const MEDIA_READERS = new Set([
  F.cloudIndex,
  F.editorJs,
  F.editorWxml,
  F.detailJs
])

const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')

function loadModule(src) {
  const module = { exports: {} }
  // 被测模块都是零依赖纯函数；给个会报错的 require，防止悄悄依赖别的文件
  new Function('module', 'exports', 'require', src)(module, module.exports, (id) => {
    throw new Error(`被测模块不应 require(${id})`)
  })
  return module.exports
}

/** 取对象方法体：从 `  name(` 到下一个同缩进方法头（语法边界，不用固定长度切片 —— 错题本 E7） */
function methodBody(src, name) {
  const re = new RegExp(`\\n  (?:async )?${name}\\([^)]*\\)\\s*\\{`)
  const m = re.exec(src)
  if (!m) return null
  const start = m.index + 1
  const next = /\n  (?:async )?[A-Za-z_$][\w$]*\([^)]*\)\s*\{/g
  next.lastIndex = start + 3
  const n = next.exec(src)
  return src.slice(start, n ? n.index : src.length)
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'scripts' || name === 'docs') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(js|wxml)$/.test(name)) out.push(relative(ROOT, p))
  }
  return out
}

function loadSources() {
  const src = {}
  for (const [k, f] of Object.entries(F)) src[k] = read(f)
  return src
}

function inspect(src, extraFiles) {
  const errs = []
  const t = (cond, msg) => { if (!cond) errs.push(msg) }

  // ---------- A. 服务端 ----------
  const allowed = /const ALLOWED_FIELDS = \[(.*?)\n\]/s.exec(src.cloudIndex)
  t(allowed && /'media'/.test(allowed[1]), 'A1 manageProducts 的 ALLOWED_FIELDS 缺 media（保存会被静默丢弃）')
  t(/data\.media = sanitizeProductMedia\(data\.media\)/.test(src.cloudIndex), 'A2 prepareProductData 未净化 media')
  t(/data\.images = stripVideoUrls\(data\.images\)/.test(src.cloudIndex), 'A3 prepareProductData 未剥掉 images 里的视频地址')
  t(/isVideoUrl\(data\.coverImage\)/.test(src.cloudIndex), 'A4 coverImage 未拦视频地址')

  let cloud = null
  try { cloud = loadModule(src.cloudMedia) } catch (e) { errs.push(`A5 服务端 productMedia.js 加载失败：${e.message}`) }
  if (cloud) {
    const imgs = cloud.stripVideoUrls(['cloud://e/products/a.png', 'cloud://e/products/v.mp4', 'https://x/y.MOV?sign=1', 'https://x/p.jpg'])
    t(JSON.stringify(imgs) === JSON.stringify(['cloud://e/products/a.png', 'https://x/p.jpg']), 'A6 stripVideoUrls 没把 .mp4/.MOV 从图片数组里剥掉')
    const ok = { type: 'video', url: 'cloud://e/products/video_0.mp4', poster: 'cloud://e/products/poster_0.png', duration: 12.3, width: 720, height: 1280, size: 1000 }
    const out = cloud.sanitizeProductMedia([
      ok,
      { ...ok, url: 'cloud://e/products/pic.png' },            // 图片冒充视频
      { ...ok, type: 'image', url: 'cloud://e/products/b.mp4' }, // 非法类型
      { ...ok, url: 'wxfile://tmp/c.mp4' },                      // 本地临时路径（没上传）
      { ...ok, url: 'cloud://e/products/d.mp4', duration: 95 },  // 超时长
      { ...ok, url: 'cloud://e/products/e.mp4', size: 60 * 1024 * 1024 }, // 超体积
      { ...ok, type: 'live', url: 'cloud://e/products/f.mp4', poster: 'cloud://e/products/f.mp4' }
    ])
    t(out.length === 2, `A7 sanitizeProductMedia 应只留 2 条合法项，实得 ${out.length}`)
    t(out[1] && out[1].type === 'live' && out[1].poster === '', 'A8 poster 是视频地址时必须置空（封面帧只能是图片）')
    const many = cloud.sanitizeProductMedia([1, 2, 3, 4, 5].map((i) => ({ ...ok, url: `cloud://e/v${i}.mp4` })))
    t(many.length === cloud.MAX_MEDIA, 'A9 超过 MAX_MEDIA 未截断')
    t(Array.isArray(cloud.sanitizeProductMedia(undefined)) && !cloud.sanitizeProductMedia('x').length, 'A10 非数组输入应得空数组')
  }

  // ---------- B. 常量同口径 ----------
  let client = null
  try { client = loadModule(src.clientMedia) } catch (e) { errs.push(`B1 店长端 productMedia.js 加载失败：${e.message}`) }
  if (cloud && client) {
    for (const k of ['MAX_MEDIA', 'MAX_VIDEO_SECONDS', 'MAX_VIDEO_BYTES']) {
      t(cloud[k] === client[k], `B2 常量 ${k} 两端不一致（云 ${cloud[k]} / 端 ${client[k]}）`)
    }
    t(JSON.stringify(cloud.MEDIA_TYPES) === JSON.stringify(client.MEDIA_TYPES), 'B3 MEDIA_TYPES 两端不一致')
    const payload = client.toPayloadMedia([{ type: 'live', url: 'cloud://e/v.mp4', poster: '', duration: 3, durationText: '0:03' }])
    t(payload[0] && !('durationText' in payload[0]), 'B4 保存载荷带了编辑区专用键 durationText')
  }

  // ---------- C. 店长端编辑区 ----------
  const choose = methodBody(src.editorJs, 'chooseProductImages')
  t(!!choose, 'C0 找不到 chooseProductImages（锚点失效 —— 判据坏了，不是通过）')
  if (choose) {
    t(/wx\.chooseMedia\(/.test(choose), 'C1 chooseProductImages 未用 chooseMedia（无法选视频）')
    t(/fileType === 'video'/.test(choose) && /files\.filter\(isVideo\)/.test(choose) && /appendProductVideos\(videoFiles\)/.test(choose), 'C2 选到的视频未分流到 appendProductVideos')
    t(/\.filter\(\(f\) => f && !isVideo\(f\)\)/.test(choose), 'C3 进 images 的候选没有排除视频（视频会被当成轮播图/封面）')
  }
  for (const name of ['appendProductVideos', 'removeProductMedia', 'moveProductMedia', 'toggleProductMediaLive', 'uploadProductVideo']) {
    const body = methodBody(src.editorJs, name)
    t(!!body, `C4 找不到 ${name}`)
    if (body) t(!/tempProduct\.images/.test(body), `C5 ${name} 写了 tempProduct.images（视频不得进图片数组）`)
  }
  const cover = methodBody(src.editorJs, 'setProductCoverImage')
  t(cover && !/media/.test(cover), 'C6 设封面逻辑不得碰 media（视频不能被设为列表封面）')
  const submit = methodBody(src.editorJs, 'submitProduct')
  t(!!submit, 'C7 找不到 submitProduct')
  if (submit) {
    t(/\.\.\.\(media\.length \|\| p\.mediaOrigCount \? \{ media:/.test(submit), 'C8 保存载荷无条件送 media（未载入过 media 的入口保存会清空库里视频）')
    t(/media\.push\(await this\.uploadProductVideo\(m, i\)\)/.test(submit), 'C9 视频上传结果未进 media')
    t(!/images\.push\([^)]*uploadProductVideo/.test(submit), 'C10 视频上传结果被推进了 images')
  }
  t(/wx:for="\{\{tempProduct\.media\}\}"/.test(src.editorWxml), 'C11 编辑区未渲染视频条目')
  const mediaBlock = /<view class="detail-img-item product-gallery-item product-media-item"[\s\S]*?\n          <\/view>/.exec(src.editorWxml)
  t(mediaBlock && !/setProductCoverImage/.test(mediaBlock[0]), 'C12 视频条目上出现了「设封面」按钮')

  // ---------- D. 详情页 ----------
  let hero = null
  try { hero = loadModule(src.heroMedia) } catch (e) { errs.push(`D0 heroMedia.js 加载失败：${e.message}`) }
  if (hero) {
    const imgs = ['https://x/a.png', 'https://x/b.png']
    t(hero.buildHeroSlides(imgs, undefined).length === 0, 'D1 无 media 时应返回 []（走原轮播）')
    t(hero.buildHeroSlides(imgs, []).length === 0, 'D2 media 为空数组时应返回 []')
    t(hero.buildHeroSlides(imgs, [{ type: 'image', url: 'https://x/c.png' }]).length === 0, 'D3 非视频类型不应触发旁路')
    const slides = hero.buildHeroSlides(imgs, [{ type: 'video', url: 'cloud://e/v.mp4' }, { type: 'live', url: 'cloud://e/l.mp4', poster: 'cloud://e/l.png' }])
    t(slides.length === 4, `D4 2 图 + 2 视频应得 4 张幻灯，实得 ${slides.length}`)
    t(slides[0] && slides[0].kind === 'image' && slides[0].src === imgs[0], 'D5 首位必须仍是封面图（首屏/分享/敏感遮罩不变）')
    t(slides.filter((s) => s.kind === 'image').every((s) => !/\.(mp4|mov|m4v)/i.test(s.src)), 'D6 图片位出现了视频地址')
    t(slides.filter((s) => s.kind !== 'image').every((s) => s.vid && s.url), 'D7 视频位缺 vid/url')
    t(new Set(slides.map((s) => s.key)).size === slides.length, 'D8 幻灯 key 不唯一')
  }
  const heroWrap = /<view class="hero-wrapper">([\s\S]*?)<\/sensitive-blur-gate>/.exec(src.detailWxml)
  t(!!heroWrap, 'D9 找不到详情页 hero 区（锚点失效）')
  if (heroWrap) {
    const block = heroWrap[1]
    const orig = /<swiper wx:if="\{\{!heroSlides\.length\}\}"[\s\S]*?<\/swiper>/.exec(block)
    t(!!orig, 'D10 原 images 轮播没有 !heroSlides.length 旁路条件（无视频时行为可能改变）')
    if (orig) {
      t(!/<video/.test(orig[0]), 'D11 原 images 轮播里出现了 <video>')
      t(/wx:for="\{\{product\.images\}\}"/.test(orig[0]), 'D12 原轮播不再遍历 product.images')
    }
    const alt = /<swiper wx:else[\s\S]*?<\/swiper>/.exec(block)
    t(alt && /<video/.test(alt[0]) && /muted="\{\{true\}\}"/.test(alt[0]) && /autoplay="\{\{false\}\}"/.test(alt[0]), 'D13 视频旁路缺失或不是「静音 + 不自动播放」')
    t((block.match(/<video/g) || []).length === ((alt && alt[0].match(/<video/g)) || []).length, 'D14 旁路之外出现了 <video>')
  }
  t(/const heroSlides = buildHeroSlides\(images, data\.media\);/.test(src.detailJs), 'D15 详情页未用 buildHeroSlides 构造幻灯')
  t(/imageTotal: heroSlides\.length \|\| images\.length,/.test(src.detailJs), 'D16 imageTotal 在无视频时不再等于 images.length')
  const hide = methodBody(src.detailJs, 'onHeroMediaChange')
  t(hide && /pauseHeroVideos\(\)/.test(hide), 'D17 切换幻灯时未暂停视频')
  const onHide = methodBody(src.detailJs, 'onHide')
  t(onHide && /pauseHeroVideos\(\)/.test(onHide), 'D18 离开页面时未暂停视频')

  // ---------- E. `.media` 读者登记 ----------
  const files = extraFiles || {}
  const unregistered = []
  for (const f of walk(MP, [])) {
    if (MEDIA_READERS.has(f)) continue
    const text = Object.prototype.hasOwnProperty.call(files, f) ? files[f] : readFileSync(resolve(ROOT, f), 'utf8')
    if (/\.media\b/.test(text)) unregistered.push(f)
  }
  for (const [f, text] of Object.entries(files)) {
    if (!MEDIA_READERS.has(f) && !unregistered.includes(f) && /\.media\b/.test(text)) unregistered.push(f)
  }
  t(!unregistered.length, `E1 未登记的 .media 读者（确认不会把视频当封面后登记到 MEDIA_READERS）：${unregistered.join(', ')}`)

  return errs
}

function main() {
  const errs = inspect(loadSources())
  if (errs.length) {
    errs.forEach((e) => console.error(`✗ ${e}`))
    console.error(`\n✗ 藏品视频/实况守卫失败 ${errs.length} 项`)
    process.exit(1)
  }
  console.log('✓ 藏品视频/实况：images 只放图片、封面不取视频、无视频时详情页走原轮播、.media 读者已登记')
}

function selftest() {
  const base = loadSources()
  let ok = 0
  let bad = 0
  const t = (name, cond) => {
    if (cond) { ok += 1; console.log(`✓ ${name}`) } else { bad += 1; console.error(`✗ ${name}`) }
  }
  const baseErrs = inspect(base)
  t(`基线：当前仓库通过${baseErrs.length ? `（${baseErrs.join('；')}）` : ''}`, baseErrs.length === 0)

  const cases = [
    ['白名单漏 media', 'cloudIndex', "  'media'\n]", '\n]', 'A1'],
    ['images 不再剥视频', 'cloudIndex', 'data.images = stripVideoUrls(data.images)', 'data.images = data.images', 'A3'],
    ['isVideoUrl 失效', 'cloudMedia', 'return VIDEO_EXT_RE.test(String(url || \'\').trim())', 'return false', 'A6'],
    ['两端上限漂移', 'clientMedia', 'const MAX_MEDIA = 3;', 'const MAX_MEDIA = 5;', 'B2'],
    ['视频混进 images 候选', 'editorJs', '.filter((f) => f && !isVideo(f))', '.filter((f) => f)', 'C3'],
    ['视频处理器写 images', 'editorJs', "this.setData({ 'tempProduct.media': media.slice(0, pm.MAX_MEDIA) });", "this.setData({ 'tempProduct.images': media.slice(0, pm.MAX_MEDIA) });", 'C5'],
    ['载荷无条件送 media', 'editorJs', '...(media.length || p.mediaOrigCount ? { media: ', '...(true ? { media: ', 'C8'],
    ['原轮播去掉旁路条件', 'detailWxml', '<swiper wx:if="{{!heroSlides.length}}" class="hero-swiper"', '<swiper class="hero-swiper"', 'D10'],
    ['原轮播塞进 video', 'detailWxml', '<block wx:for="{{product.images}}" wx:key="*this">\n          <swiper-item>', '<block wx:for="{{product.images}}" wx:key="*this">\n          <swiper-item><video src="{{item}}"></video>', 'D11'],
    ['无视频也走旁路', 'heroMedia', 'if (!vids.length) return [];', '', 'D1'],
    ['视频抢了封面位', 'heroMedia', 'const slides = imgs.slice(0, 1).map((src) => ({ kind: \'image\', src }));', 'const slides = [];', 'D5'],
    ['imageTotal 只看幻灯', 'detailJs', 'imageTotal: heroSlides.length || images.length,', 'imageTotal: heroSlides.length,', 'D16'],
    ['离页不暂停', 'detailJs', "    if ((this.data.heroSlides || []).length) this.pauseHeroVideos();\n", '', 'D18']
  ]
  for (const [name, key, from, to, code] of cases) {
    const hit = base[key].includes(from)
    t(`注入锚点命中：${name}`, hit)
    if (!hit) continue
    const errs = inspect({ ...base, [key]: base[key].replace(from, to) })
    t(`★ 被检出：${name}（${code}）`, errs.some((e) => e.startsWith(code)))
  }
  const fake = { 'miniprogram/pages/cart/__fake__.js': 'const cover = item.media[0].url' }
  t('★ 被检出：购物车读 .media 当封面（E1）', inspect(base, fake).some((e) => e.startsWith('E1')))

  if (bad) {
    console.error(`\n✗ 自检失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ 自检通过：${ok} 项（注入均在内存副本上进行，不写盘）`)
}

if (process.argv.includes('--selftest')) selftest()
else main()
