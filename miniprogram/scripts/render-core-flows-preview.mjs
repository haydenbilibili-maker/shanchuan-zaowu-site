#!/usr/bin/env node
/**
 * 核心链路离线预览（礼赠 / 订单 / 详情 / AI 鉴定 / 钱包礼券）——开发工具，**不在 check:admin 里**（需要本机 Chrome）。
 *
 * 结构与样式从真源码现读（lib/wxml-preview.mjs）；`scroll-view` 按普通容器展开、其它自定义组件整棵跳过，
 * 钱包三块面板本身是组件，按「组件即页面」单独出图。数据是示例，只为看版式 / 层级 / 质感。
 * 证明不了真机 rpx 精度与原生组件行为（错题本 E8 / E26）。
 *
 * 用法：
 *   CHROME_PATH=… node miniprogram/scripts/render-core-flows-preview.mjs --out-dir <目录> [--rev <提交>] [--only detail,order-detail]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const outDir = resolve(argOf('--out-dir', join(tmpdir(), 'core-flows-preview')))
const rev = argOf('--rev', '')
const only = argOf('--only', '').split(',').filter(Boolean)
mkdirSync(outDir, { recursive: true })

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p))
if (!chrome) { console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）'); process.exit(1) }

function read(abs) {
  if (!rev) return readFileSync(abs, 'utf8')
  const r = spawnSync('git', ['show', `${rev}:${relative(ROOT, abs)}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error(`git show ${rev}:${relative(ROOT, abs)} 失败`)
  return r.stdout
}
function loadWxss(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return ''
  seen.add(file)
  return read(file).replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const p = rel.startsWith('/') ? join(MP, rel) : resolve(dirname(file), rel)
    return loadWxss(p, seen)
  })
}
/** <template name> 定义 + <template is data="{{item}}"> 调用 → 就地展开（只支持本仓在用的 data="{{item}}" 简写） */
function inlineTemplates(src) {
  const defs = {}
  src = src.replace(/<template\s+name="([^"]+)"\s*>([\s\S]*?)<\/template>/g, (_, name, body) => { defs[name] = body; return '' })
  return src.replace(/<template\b([^>]*?)\bis="([^"]+)"([^>]*?)\/>/g, (all, a, name, b) => {
    if (!defs[name]) return all
    const attrs = (a + b).replace(/\bdata="[^"]*"/, '').trim()
    return `<block ${attrs}>${defs[name]}</block>`
  })
}
/** WXSS 选择器 → 预览 HTML：裸 page / :host → body；标签选择器 view/text/image → div/span/img（渲染器的映射）。
 *  ⚠️ 不能写 \bpage —— `.page {` 的 page 前也是词边界，会把页面根类改坏（首版就这么错了）。 */
function toHtmlCss(css) {
  const TAG = { view: 'div', text: 'span', image: 'img' }
  return css.replace(/(^|[\s,}>+~(])page(?=\s*[{,])/g, '$1body').replace(/:host(?=\s*[{,])/g, 'body')
    .replace(/(^|[\s,}>+~(])(view|text|image)(?=[\s,.:#\[{>+~)])/g, (_, a, t) => a + TAG[t])
}
const rpx2px = (t) => t.replace(/(-?\d*\.?\d+)rpx/g, '$1px').replace(/(?:env|constant)\(safe-area-inset-(?:bottom|top)\)/g, '0px')

const IMG = (n) => `file://${join(ROOT, 'public/images/price-list', n)}`
const P = ['blue-morpho-dome-single.jpg', 'blood-ripple-butterfly-dome.jpg', 'blue-morpho-wood-frame.jpg', 'dandelion-glass-dome.jpg', 'domestic-mixed-butterfly-frame-01.jpg', 'butterfly-plant-combo-frame-01.jpg'].map(IMG)

const product = {
  _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', latinName: 'Morpho helena', themeName: '晨雾', themeNote: '清晨薄雾里的一抹蓝',
  image: P[0], images: [P[0], P[2]], rootCategoryName: '昆虫', giftEligible: true, supportsCustom: true,
  taxonomy: { kingdom: '动物界', phylum: '节肢动物门', class: '昆虫纲', order: '鳞翅目', family: '蛱蝶科', genus: '闪蝶属' },
  skus: [{ id: 's1', specLabel: '玻璃罩 · 小号', stock: 6 }, { id: 's2', specLabel: '实木框', stock: 2 }]
}


const petSteps = [{ id: 1, label: '须知' }, { id: 2, label: '伙伴' }, { id: 3, label: '工艺' }, { id: 4, label: '交接' }, { id: 5, label: '确认' }]
const petBase = {
  loading: false, flagChecking: false, steps: petSteps, navPaddingRight: 100, headerHeight: 0,
  serviceNoticePlates: [{ id: 'n1', title: '先评估，再报价', body: '提交意向后由标本师评估遗体状况与工艺可行性，确认前不收费。' }, { id: 'n2', title: '尽快冷藏', body: '离世后请用毛巾包裹放入冷冻层，避免反复解冻。' }],
  crafts: [{ craftId: 'taxidermy', name: '仿生标本', desc: '还原生前姿态，适合猫犬等中小型伙伴', estimatedWeeks: '约 8–16 周' }, { craftId: 'skeletal', name: '骨骼标本', desc: '保留完整骨骼，木座陈列', estimatedWeeks: '约 6–10 周' }, { craftId: 'resin', name: '毛发树脂', desc: '少量毛发封存于树脂摆件', estimatedWeeks: '约 2–3 周' }],
  speciesOptions: [{ id: 'cat', label: '猫' }, { id: 'dog', label: '犬' }, { id: 'bird', label: '鸟' }, { id: 'small', label: '小型宠物' }], species: 'cat',
  weightRanges: [{ id: 'w1', label: '5kg 以下' }, { id: 'w2', label: '5–15kg' }, { id: 'w3', label: '15kg 以上' }], weightRange: 'w1',
  storageOptions: [{ id: 'frozen', label: '已冷冻' }, { id: 'fridge', label: '冷藏中' }, { id: 'none', label: '未处理' }], storage: 'frozen',
  photos: [P[4]], petName: '团子',
  artisans: [{ id: 'a1', name: '林一', bio: '十二年哺乳类标本经验', avatar: P[1], priceDelta: 0, extraDays: 0 }, { id: 'a2', name: '周舟', bio: '擅长鸟类与小型宠物', avatar: P[0], priceDelta: 800, extraDays: 7 }],
  craftId: 'taxidermy', artisanId: 'a1', artisanName: '林一',
  poseOptions: [{ id: 'sleep', label: '安睡' }, { id: 'sit', label: '端坐' }, { id: 'custom', label: '指定姿态' }], pose: 'sleep',
  intakeMethods: [{ id: 'store', label: '到店交接', desc: '工作室营业时间当面交接，标本师现场确认' }, { id: 'pickup', label: '上门接送', desc: '同城冷链上门', comingSoon: true, soonNote: '即将上线' }], intakeMethod: 'store', preferredDate: '2026-10-20',
  previewLines: [{ label: '伙伴', value: '团子 · 猫 · 5kg 以下' }, { label: '工艺', value: '仿生标本 · 安睡' }, { label: '标本师', value: '林一' }, { label: '交接', value: '到店 · 10.20' }],
  relationOptions: [{ id: 'owner', label: '主人' }, { id: 'family', label: '家人' }], relation: 'owner', contactName: '林', contactPhone: '13800000000'
}
const petMeta = (n) => ({ 1: { title: '开始之前', desc: '以下几件事，决定了这件记忆能否被好好留下。' }, 2: { title: '关于 TA', desc: '告诉标本师 TA 是谁、现在的状况。' }, 3: { title: '选择工艺', desc: '不同工艺的周期与呈现不同，可先选后改。' }, 5: { title: '确认意向', desc: '提交后专员会在 24 小时内联系你。' } })[n]

// 马上有 · 心愿签（2026-10-15 第 5 轮）：展品图用官网 IP 图代替云端实拍（离线可画）；文案来自 config/wallExhibit.js 真值
const WL_COVER = `file://${join(ROOT, 'public/images/what/ip/mashangyou.png')}`
const wlExhibit = { name: '马上有', nameEn: 'MA SHANG YOU', species: '黑马标本', storeLabel: '长春店', visitNote: '在店里看得见它，隔着展柜静静看', line: '对着黑马「马上有」，说一句想要的' }
const wlLabels = [
  [{ _id: 'a1', no: 'No.8F2A', text: '马上有好睡眠', timeText: '2 小时前', author: '蛋炒饭', fresh: true, isMine: true },
    { _id: 'a3', no: 'No.71C0', text: '马上有一份不用加班的工作，周末能去爬山', long: true, timeText: '昨天', author: '令狐冲大哥', echoCount: 3, voiceUrl: 'x', voiceText: '0:08' },
    { _id: 'a5', no: 'No.0B3E', text: '马上有钱', timeText: '3 天前', author: '山海造物', official: true, pinned: true }],
  [{ _id: 'a2', no: 'No.D41C', text: '马上有 Offer', timeText: '5 小时前', author: '小满', echoCount: 12 },
    { _id: 'a4', no: 'No.92AF', text: '马上有对象', timeText: '昨天', author: '阿青', voiceTag: '声音审核中', isMine: true },
    { _id: 'a6', no: 'No.5E07', text: '家里猫咪马上康复', timeText: '4 天前', author: '团子妈' }]
]
const wlBase = {
  statusBarHeight: 44, navBarHeight: 44, navTotal: 88, allowed: true, flagChecked: true, loading: false, exhibit: wlExhibit, cover: WL_COVER,
  peek: [wlLabels[0][0], wlLabels[1][0], wlLabels[0][1]], columns: wlLabels, viewMode: 'latest', capped: true, listLimit: 60,
  quota: { used: 1, left: 4, cap: 5, exhausted: false }, textMax: 30, inspiration: ['马上有风', '马上有暖', '马上有眠', '马上有劲'],
  voiceMax: 15, writer: '蛋炒饭', today: '2026.10.15'
}

// 2026-10-17 图鉴重设计：卷一 16 页（6 页已点亮）+ 图版详页；刻版线描取真源 atlasPlates.js
const atlasPlates = loadCjsModule(join(MP, 'subpackages/feature/utils/atlasPlates.js'))
const ATLAS_ROWS = [
  ['001', '大蓝闪蝶', 'Morpho menelaus', '昆虫', 'common', 1, 1], ['004', '琉璃蛱蝶', 'Kaniska canace', '昆虫', 'common', 1, 0],
  ['006', '柑橘凤蝶', 'Papilio xuthus', '昆虫', 'common', 0, 0], ['009', '光明女神闪蝶', 'Morpho helena', '昆虫', 'legendary', 1, 0],
  ['012', '金斑蝶', 'Danaus chrysippus', '昆虫', 'common', 0, 0], ['015', '萤石', 'Fluorite', '矿石', 'rare', 1, 0],
  ['017', '雅灰蝶', 'Jamides bochus', '昆虫', 'common', 0, 0], ['018', '枯叶蛱蝶', 'Kallima inachus', '昆虫', 'rare', 0, 1],
  ['021', '大红蛱蝶', 'Vanessa indica', '昆虫', 'common', 0, 0], ['023', '血漪蛱蝶', 'Cethosia biblis', '昆虫', 'common', 0, 0],
  ['028', '绿鸟翼凤蝶', 'Ornithoptera priamus', '昆虫', 'legendary', 0, 0], ['031', '银杏押花', 'Ginkgo biloba', '植物', 'common', 1, 1],
  ['033', '鹦鹉螺', 'Nautilus pompilius', '海洋', 'rare', 1, 1], ['034', '唐冠螺', 'Cassis cornuta', '海洋', 'rare', 0, 0],
  ['036', '莲花押花', 'Nelumbo nucifera', '植物', 'common', 0, 0], ['041', '紫水晶', 'Amethyst', '矿石', 'common', 0, 1]
]
const TONE = { 昆虫: 'insecta', 植物: 'plantae', 海洋: 'marine', 矿石: 'minerals' }
const atlasCards = ATLAS_ROWS.map(([no, zh, la, cat, rarity, lit, spot]) => {
  const c = { id: no, no, category: cat, categoryTone: TONE[cat], rarity, unlocked: !!lit, hasSpot: !!spot, nameZh: lit ? zh : '未记录', nameLatin: lit ? la : '' }
  c.plate = atlasPlates.plateOf(c)
  c.rareMark = lit ? ({ rare: '稀有', legendary: '传奇' })[rarity] || '' : ''
  return c
})
const atlasCats = [{ id: 'all', label: '全部', got: 6, total: 16 }].concat(['昆虫', '植物', '矿石', '海洋'].map((c) => {
  const x = atlasCards.filter((a) => a.category === c)
  return { id: c, label: c, got: x.filter((a) => a.unlocked).length, total: x.length }
}))
const atlasStats = { total: 16, unlocked: 6, percent: 38, series: [
  { id: 'frost', name: '霜降守望', got: 1, total: 4, complete: false, blurb: '十月末到霜降前后，颜色会自己安静下来。' },
  { id: 'overwinter', name: '越冬者', got: 1, total: 3, complete: false, blurb: '翅面把一整季的光收进去，到来年还在。' },
  { id: 'mountain', name: '守山者', got: 3, total: 6, complete: false, blurb: '石头、叶片与壳，都是山海留下的截面。' }
] }

function achievementsSceneData() {
  let cfg = null
  loadCjsModule(join(MP, 'subpackages/extra/user/achievements/index.js'), {
    globals: { getApp: () => ({ globalData: { openid: 'u1' } }), Page: (o) => { cfg = o }, wx: { vibrateShort() {}, showToast() {} }, getCurrentPages: () => [] },
    stubs: {
      '../../../../utils/easterEgg': { listCatalog: () => [], getProgress: () => ({ found: 0, total: 0 }), isDiscovered: () => false },
      '../../../../utils/badgeDisplay': { markAchievementsSeen() {} }
    }
  })
  const page = { ...cfg, data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } }
  const A = (id, type, name, desc, threshold, progress, points, unit) => ({ id, type, name, desc, threshold, progress, unlocked: progress >= threshold, unit: unit || '次', reward: points ? { points, type: 'points' } : { type: 'badge' } })
  const list = [
    A('explore_10', 'explore', '初探者', '浏览 10 个藏品', 10, 68, 10), A('explore_50', 'explore', '探索家', '浏览 50 个藏品', 50, 68, 50), A('explore_100', 'explore', '博物学家', '浏览 100 个藏品', 100, 68, 100),
    A('search_5', 'explore', '搜索新手', '搜索 5 次', 5, 3, 5), A('search_20', 'explore', '搜索达人', '搜索 20 次', 20, 3, 20),
    A('collect_5', 'collect', '收藏新手', '收藏 5 件', 5, 7, 15, '件'), A('collect_10', 'collect', '收藏家', '收藏 10 件', 10, 7, 30, '件'), A('collect_50', 'collect', '收藏大师', '收藏 50 件', 50, 7, 100, '件'),
    A('folder_3', 'collect', '整理达人', '建 3 个收藏夹', 3, 1, 20, '个'),
    A('atlas_first', 'collect', '第一页', '图鉴点亮第一页', 1, 1, 20, '页'), A('atlas_frost', 'collect', '霜降守望', '集齐霜降守望', 4, 1, 40, '页'), A('atlas_overwinter', 'collect', '越冬者', '集齐越冬者', 3, 1, 40, '页'), A('atlas_mountain', 'collect', '守山者', '集齐守山者', 6, 3, 40, '页'), A('atlas_volume', 'collect', '山海图鉴卷一', '卷一全部点亮', 16, 6, 100, '页'),
    A('share_1', 'social', '分享者', '分享 1 次', 1, 2), A('share_5', 'social', '分享达人', '分享 5 次', 5, 2), A('share_20', 'social', '分享大师', '分享 20 次', 20, 2),
    A('first_purchase', 'consumption', '首次购买', '完成第一笔订单', 1, 1, 50, '单'), A('spend_500', 'consumption', '消费新星', '累计消费 ¥500', 500, 860, 100, '元'), A('spend_2000', 'consumption', '消费达人', '累计消费 ¥2000', 2000, 860, 200, '元'), A('spend_10000', 'consumption', '消费大师', '累计消费 ¥10000', 10000, 860, 500, '元'),
    A('course_1', 'learning', '学习者', '完成 1 个课程', 1, 0, 20), A('course_5', 'learning', '学习达人', '完成 5 个课程', 5, 0, 50),
    A('certificate_1', 'learning', '证书持有者', '获得 1 个证书', 1, 2, 20, '份'), A('certificate_5', 'learning', '证书收藏家', '获得 5 个证书', 5, 2, 50, '份')
  ]
  const unlocked = list.filter((a) => a.unlocked).length
  page._applyAchievementData({ achievements: list, stats: { total: list.length, unlocked, locked: list.length - unlocked, totalRewards: 205 } })
  return Object.assign({}, page.data, {
    relicsName: '山海拾遗', relicsFound: 2, relicsTotal: 5, relicsUnlocked: false,
    relicsCatalog: [
      { id: 'r1', roman: 'I', discovered: true, plateTitle: '吉量', plateHint: '山海经 · 海内北经' },
      { id: 'r2', roman: 'II', discovered: true, plateTitle: '鹿蜀', plateHint: '山海经 · 南山经' },
      { id: 'r3', roman: 'III', discovered: false, plateTitle: '· · ·', plateHint: '待偶遇' },
      { id: 'r4', roman: 'IV', discovered: false, plateTitle: '· · ·', plateHint: '待偶遇' }
    ]
  })
}

const SCENES = [
  { name: 'wl-main', h: 2500, wxml: 'subpackages/feature/wish-labels/index', data: wlBase },
  { name: 'wl-compose', h: 1500, wxml: 'subpackages/feature/wish-labels/index', data: { ...wlBase, composeOpen: true, draft: '马上有好睡眠', draftCount: 6, posting: false, voicePath: '' } },
  { name: 'wl-card', h: 1500, wxml: 'subpackages/feature/wish-labels/index', data: { ...wlBase, card: { ...wlLabels[1][0], date: '2026.10.15', echoed: false } } },
  { name: 'wl-empty-mine', h: 1900, wxml: 'subpackages/feature/wish-labels/index', data: { ...wlBase, viewMode: 'mine', columns: [[], []], quota: { used: 5, left: 0, cap: 5, exhausted: true } } },
  {
    name: 'detail', h: 3000, wxml: 'subpackages/feature/detail/index', data: {
      product, commerceReady: true, displayPrice: '388', displayStock: 6, heroSlides: [{ key: 'h1', kind: 'image', src: P[0] }, { key: 'h2', kind: 'image', src: P[2] }], heroFit: 'aspectFill', heroSwiperH: 520,
      imageTotal: 2, activeTab: 'detail', statusBarHeight: 44, navBarHeight: 44, navOpacity: 0, craftTags: [{ key: 'dome', label: '玻璃罩' }, { key: 'hand', label: '手作' }],
      isShippingFree: true, shippingHint: '满 ¥199 包邮', archiveDisplay: { origin: '南美 · 秘鲁', size: '18 × 24 cm', framingMethod: '玻璃罩', framerName: '林一', date: '2026.09', craftProcess: '展翅 · 还软 · 定型 72 小时' },
      descriptionParagraphs: [{ segments: [{ text: '光明女神闪蝶被誉为世界上最美的蝴蝶之一，翅面在不同角度下呈现由蓝到紫的结构色。' }] }],
      selectedSkuSizeText: '玻璃罩 · 小号', buyCount: 1, hasSku: true, isOneOfAKind: false, specSummary: '2 种规格'
    }
  },
  {
    name: 'identify-result', h: 2400, wxml: 'subpackages/feature/identify/result/index', data: {
      loading: false, loadError: false, displayImage: P[0], confidenceLevel: 'high', recordId: 'r1', isOwner: true, showSpeciesArchive: true,
      speciesInfo: { is_specimen: true, species_name_zh: '光明女神闪蝶', species_name_latin: 'Morpho helena', confidence: 0.92, confidencePct: 92 },
      rootCategoryTag: { label: '昆虫', tone: 'insecta' },
      alternatives: [{ name_zh: '海伦闪蝶', name_latin: 'Morpho helenor', confidence: 0.18, confidencePct: '18%' }, { name_zh: '蓝闪蝶', name_latin: 'Morpho menelaus', confidence: 0.06, confidencePct: '6%' }],
      speciesProfile: { blocks: [{ title: '形态', text: '翅展 12–14 厘米，雄蝶翅面呈金属蓝色，边缘有白色斑带。' }, { title: '分布', text: '秘鲁亚马逊雨林海拔 400–1200 米的林冠层。' }], protectionTags: [{ label: '无保护等级', tone: 'muted' }], sourceLabel: 'AI 整理 · 仅供参考' },
      relatedProducts: [{ _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', price: 388, cover: P[0], latinName: 'Morpho helena' }, { _id: 'p2', title: '大蓝闪蝶 · 原木框', price: 520, cover: P[2] }]
    }
  },
  {
    name: 'species-card', h: 1400, wxml: 'subpackages/feature/components/SpeciesCard/index', data: {
      imageUrl: P[0], confidenceLevel: 'high', showConfidence: true, rootCategoryTag: { label: '昆虫', tone: 'insecta' }, showProtection: true,
      speciesInfo: { is_specimen: true, species_name_zh: '光明女神闪蝶', species_name_latin: 'Morpho helena', confidence: 0.92, family_zh: '蛱蝶科', order_zh: '鳞翅目' },
      aiContent: { description: '翅面在不同角度呈现由蓝到紫的结构色，是闪蝶属中最受藏家青睐的物种之一。' },
      protectionTags: [{ label: '无保护等级', tone: 'muted' }]
    }
  },
  {
    name: 'order-detail', h: 2200, wxml: 'subpackages/business/order-detail/index', data: {
      loading: false, loadError: false, isDecrypted: true, showOrderPrice: true, statusBarHeight: 44,
      order: {
        _id: 'o1', serialNo: 'SH20261012008', status: 'shipped', totalPrice: '1,260.00', originalPrice: '1,280.00', discountRate: 0.98, discountText: '9.8 折', discountAmount: '20.00',
        couponValue: 0, shippingFee: 0, shippingFeeLabel: '包邮', archiveDate: '2026.10.12',
        address: { name: '林', phone: '138****0012' }, addressLine: '上海市徐汇区漕溪北路 ** 号',
        logistics: { carrier: '顺丰速运', trackingNumber: 'SF1234567890123' },
        products: [{ _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', latin: 'Morpho helena', price: '1,280.00', count: 1, image: P[0] }]
      },
      hasTracking: true, stampText: '已启程', stampClass: 'shipped', footer: true
    }
  },
  {
    name: 'orders', h: 1500, wxml: 'subpackages/business/orders/index', data: {
      statusBarHeight: 44, currentTab: 0, loading: false,
      tabs: [{ key: 'all', label: '全部' }, { key: 'pending_pay', label: '待付款' }, { key: 'shipped', label: '待收货' }, { key: 'done', label: '已完成' }],
      orders: [
        { _id: 'o1', serialNo: 'SH20261012008', status: 'shipped', statusText: '已启程', totalPrice: '1,260.00', products: [{ title: '光明女神闪蝶 · 玻璃罩', image: P[0], count: 1 }], productCount: 1 },
        { _id: 'o2', serialNo: 'SH20260920017', status: 'done', statusText: '已签收', totalPrice: '376.00', products: [{ title: '绿带翠凤蝶', image: P[1], count: 2 }], productCount: 2 }
      ]
    }
  },
  {
    name: 'gift-compose', h: 2400, wxml: 'subpackages/feature/gift/compose/index', data: {
      loading: false, checking: false, loadError: false, allowed: true, count: 1, activeStep: 1, maxStep: 2, statusBarHeight: 44, navBarHeight: 44, navTotal: 88,
      product: { ...product, cover: P[0] }, skuLabel: '玻璃罩 · 小号', sceneLabel: '生日', activeScene: 'birthday',
      notePresets: [{ id: 'n1', label: '生日' }, { id: 'n2', label: '感谢' }, { id: 'n3', label: '纪念日' }], activeNotePresetId: 'n1',
      packagingItems: [{ id: 'k1', k: '礼盒', v: '黑胡桃木盒 · 烫金封签' }, { id: 'k2', k: '礼笺', v: '藏品纸 · 手写体' }],
      recipientName: '阿禾', cardBody: '愿你的每个清晨都像这只蝴蝶一样，有光。', cardSignature: '小林', noteMaxChars: 120, hidePrice: true, allowHidePriceToggle: true
    }
  },
  {
    name: 'gift-receive', h: 2200, wxml: 'subpackages/feature/gift/receive/index', data: {
      ready: true, expired: false, invalid: false, isSender: false, busy: false, product: { ...product }, recipientName: '阿禾', letterToShown: true, letterBodyShown: true, letterSigReady: true,
      cardSignature: '小林', revealed: true, ritePhase: 'done', isInvite: true, hasVoice: true, voiceDurationLabel: '0:12', hidePrice: true, specimenHint: '玻璃罩 · 小号'
    }
  },
  {
    name: 'gift-hub', h: 2300, wxml: 'subpackages/feature/gift/hub/index', data: {
      allowed: true, paneReady: true, activeScene: 'birthday', sceneGuide: '生日礼重在「被记得」：挑一件 TA 会每天看见的。', loadingProducts: false, productsError: '',
      scenes: ['乔迁', '新婚', '生日', '纪念日', '升学', '毕业', '新工作', '致谢'].map((label, i) => ({ key: i === 2 ? 'birthday' : 'k' + i, label })),
      products: [
        { _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', cover: P[0], priceLabel: '388', matchSource: 'scene', themeName: '晨雾', themeNote: '清晨薄雾里的一抹蓝' },
        { _id: 'p2', title: '血漪蛱蝶 · 穹顶', cover: P[1], priceLabel: '268', matchSource: 'scene' },
        { _id: 'p3', title: '大蓝闪蝶 · 原木框', cover: P[2], priceLabel: '520', matchSource: 'fallback' },
        { _id: 'p4', title: '蒲公英 · 玻璃罩', cover: P[3], priceLabel: '198', matchSource: 'scene', themeName: '风起', themeNote: '一吹就散的愿望' }
      ]
    }
  },
  { name: 'gift-hub-idle', h: 2000, wxml: 'subpackages/feature/gift/hub/index', base: 'gift-hub', data: { activeScene: '', sceneGuide: '', forWhom: '阿禾' } },
  {
    name: 'gift-success', h: 1900, wxml: 'subpackages/feature/gift/success/index', data: {
      ready: true, heroOverline: 'GIFT SEALED', heroTitle: '礼已备好', heroDesc: '礼笺已封好，交给 TA 后由 TA 亲手拆开、填写地址。', expireHint: '7 天内未拆封将自动退回',
      cardBody: '愿你的每个清晨都像这只蝴蝶一样，有光。', cardSignature: '小林', hasVoice: true, voiceDurationLabel: '0:12', shareCta: '把这份心意交给 TA', canShare: true,
      canProxyAddress: true, selfTreat: false, canNudge: false, voucherReady: true, verify: { receiverVerify: true, phoneTail: '0012', editable: true }, verifyLabel: '受礼人手机号已核验'
    }
  },
  {
    name: 'gift-mine', h: 2300, wxml: 'subpackages/feature/gift/my-gifts/index', data: (() => {
      const rail = (labels, cur) => ({ steps: labels.map((label, i) => ({ label, state: i < cur ? 'done' : i === cur ? 'current' : 'todo' })) })
      const L = ['付款', '启封', '填址', '启程', '送达']
      const items = [
        { orderId: 'g1', flowTab: 'sent', roleLabel: '送出', productImage: P[0], productTitle: '光明女神闪蝶 · 玻璃罩', recipientName: '阿禾', progressLabel: '等 TA 启封', signalClass: 'lamp-brass', todo: true, expireHint: '6 天后退回',
          receiverVerify: true, verifyPhoneTail: '0012', verifyEditable: true, cardSnippet: '愿你的每个清晨都像这只蝴蝶一样，有光。', showRail: true, progressSteps: rail(L, 1), paidText: '10.15 付款', totalPrice: '388.00',
          primaryAction: { key: 'share', label: '再交给 TA 一次' }, secondaryAction: { key: 'detail', label: '礼赠进度' }, hasVoice: true },
        { orderId: 'g2', flowTab: 'sent', roleLabel: '送出', productImage: P[3], productTitle: '蒲公英 · 玻璃罩', recipientName: '小满', progressLabel: '已启程', signalClass: 'lamp-ok', claimMode: 'link', claimerLabel: '已由 小满 收下',
          showRail: true, progressSteps: rail(L, 3), paidText: '10.08 付款', totalPrice: '198.00', primaryAction: { key: 'detail', label: '礼赠进度' } }
      ]
      return { allowed: true, paneReady: true, hubTab: 'flow', flowTab: 'sent', activeSegment: 'all', heroSummary: '记下往来、对象与日子——像一本博物柜里的人情账本。', headSignalClass: 'lamp-brass',
        counts: { sent: 5, received: 2 }, contactsCount: 3, upcomingHotCount: 1, flowBadge: 1,
        segments: [{ key: 'all', label: '全部', count: 5 }, { key: 'awaiting_open', label: '待启封', count: 1 }, { key: 'awaiting_address', label: '待填址' }, { key: 'fulfillment', label: '履约中', count: 1 }, { key: 'done', label: '已完成', count: 3 }],
        list: items, activeList: items, foldedList: [], foldedCount: 0, loading: false, skelRows: [1, 2, 3] }
    })()
  },
  {
    name: 'profile', h: 4300, wxml: 'subpackages/extra/user/profile/index', data: (() => {
      const interestOpts = [['INSECTA', '蝴蝶昆虫', '#52B788'], ['ANIMALIA', '动物世界', '#8B6F47'], ['PLANTAE', '植物果实', '#6DA34D'], ['MARINE', '海洋标本', '#5B8FB9'], ['MINERALS', '矿石馆', '#7B68AE'], ['FRAMING', '装裱艺术', '#C4A76C'], ['CUSTOM', '标本定制', '#C4A76C'], ['COURSE', '自然课程', '#A09A90'], ['COLLECTING', '收藏鉴赏', '#8B6F47']]
      const picked = { INSECTA: 1, MARINE: 1 }
      const nextSteps = [
        { key: 'phone', gain: 25, label: '绑定手机号', desc: '下单、预约与门店通知的前提' },
        { key: 'birthday', gain: 15, label: '填写生日', desc: '生日当天自动发礼券与祝福' },
        { key: 'mbti', gain: 8, label: '填写 MBTI', desc: '可选，默认仅自己可见' }
      ]
      return {
        loading: false, loadError: false, headerBlockPx: 120, footerPadPx: 140, navPaddingRight: 100, profileScore: 52,
        avatarRingStyle: 'background: conic-gradient(from -90deg, #C4A76C 52%, rgba(196,167,108,0.12) 0);', avatarUrl: P[1], nickName: '林间拾蝶', memberNo: 'SH0003921',
        rewardHint: '填写生日后，生日当天可领取生日礼券与祝福。兴趣偏好可帮助馆藏推荐。',
        nextSteps, nextStepsTotal: 4, nextStepsMore: 1, nextStepsDone: false,
        phoneBound: false, phoneAgreed: false, phoneMasked: '',
        gender: 'female', genderOptions: [{ key: 'male', label: '男' }, { key: 'female', label: '女' }, { key: 'other', label: '其他' }, { key: 'prefer_not', label: '不愿透露' }],
        birthday: '', interests: ['INSECTA', 'MARINE'],
        interestChips: interestOpts.map(([key, label, color]) => ({ key, label, selected: !!picked[key], activeStyle: picked[key] ? `color:${color};border-color:${color};background-color:${color}22;font-weight:600;` : '' })),
        sensitiveBlurPref: 'veil', sensitiveOptions: [{ key: 'clear', label: '可以直接展示', hint: '封面直接呈现，不再默认轻掩' }, { key: 'veil', label: '默认轻掩，由我点按启视', hint: '蛇类、两栖等封面先轻掩' }],
        mbti: '', mbtiOptions: ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'],
        zodiac: 'pisces', zodiacOptions: ['摩羯座', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座'].map((label, i) => ({ key: i === 2 ? 'pisces' : 'z' + i, label })),
        bio: '在林子里捡到的，都想好好收着。', bioLength: 15, privacy: { showMbti: false, showZodiac: true, showBirthday: false },
        isDirty: true, saving: false, footerPrimaryText: '保存资料'
      }
    })()
  },
  // 2026-10-17 页面评估用：「我的」/ 消息 / 成就（只为看全貌，数据取典型态）
  {
    name: 'user-home', h: 3000, wxml: 'pages/user/index', data: {
      statusBarHeight: 44, navTop: 88, isLocalLoggedOut: false, showOnboardingBanner: false, showGiftRepairBanner: false, showProfileHint: false,
      showStoredValue: true, showGift: true, showStore: true, showAchievements: true, showAtlas: true, showAiIdentify: true, showUserCommunity: true, showMyDataModule: true,
      certificateCount: 2, profileScore: 52, couponBadgeText: '2', giftTodoCount: 1, messageBadgeText: '3', achievementBadgeText: '新', atlasStats: { total: 12, lit: 3 },
      orderBadges: { pay: 1, shipped: 1 }, workbenchTiles: [], cardPending: false, cardGuest: false, bookingCount: 1,
      myData: { collections: 6, courses: 2, days: 38 }
    }
  },
  {
    name: 'messages', h: 2000, wxml: 'subpackages/extra/user/messages/index', data: {
      loading: false, loadError: false, hasMore: false, unreadCount: 2, activeCategory: 'all', activeQueue: 'customer', workflowMode: false, isStaff: false, showQueueTabs: false, headerHeight: 210,
      filterTabs: [{ id: 'all', label: '全部' }, { id: 'order', label: '订单' }, { id: 'gift', label: '礼赠' }, { id: 'system', label: '馆方' }],
      messages: [
        { _id: 'm1', dayLabel: '今天', kind: 'receipt', typeName: '发货通知', readLampClass: 'lamp-brass', statusLabel: '待签收', statusLampClass: 'lamp-brass', title: '你的藏品已启程', preview: '光明女神闪蝶 · 玻璃罩 已由顺丰发出，预计 2 天送达。', formattedTime: '10:24', isUnread: true, kindLabel: '订单', kindLampClass: 'lamp-brass', senderName: '山海造物', hasProductCards: true, productThumbs: [P[0]], productSummary: '1 件藏品' },
        { _id: 'm2', dayLabel: '昨天', kind: 'notice', typeName: '礼赠进度', readLampClass: 'lamp-brass', statusLabel: '已拆封', statusLampClass: 'lamp-forest', title: '阿禾拆开了你的礼笺', preview: '「谢谢你，我很喜欢。」', formattedTime: '昨天', isUnread: true, kindLabel: '礼赠', kindLampClass: 'lamp-forest', senderName: '礼赠' },
        { _id: 'm3', dayLabel: '10 月 12 日', kind: 'campaign', typeName: '馆方来信', readLampClass: 'lamp-brass hollow', statusLabel: '已读', statusLampClass: 'lamp-muted', title: '十月新到：南美闪蝶专题', preview: '本周馆藏上新 12 件，含 3 件孤品。', formattedTime: '10.12', isUnread: false, kindLabel: '馆方', kindLampClass: 'lamp-muted', senderName: '山海造物', isPaper: true }
      ]
    }
  },
  // 2026-10-17 成就重设计：场景数据由**真页面** _applyAchievementData 现算（成长线 / 下一枚 / 刻度不手抄）
  { name: 'achievements', h: 3400, wxml: 'subpackages/extra/user/achievements/index', data: achievementsSceneData() },
  { name: 'gift-mine-people', h: 1700, wxml: 'subpackages/feature/gift/my-gifts/index', base: 'gift-mine', data: { hubTab: 'people', contactsLoading: false,
      contacts: [{ id: 'c1', name: '阿禾', nameInitial: '禾', relationLabel: '挚友', note: '喜欢蓝色的东西', giftCountLabel: '送过 2 次 · 最近 10.15', sceneKey: 'birthday' },
        { id: 'c2', name: '林老师', nameInitial: '林', relationLabel: '师长', giftCountLabel: '还没送过' }] } },
  { name: 'gift-mine-dates', h: 1900, wxml: 'subpackages/feature/gift/my-gifts/index', base: 'gift-mine', data: { hubTab: 'dates', datesLoading: false, datesHeadSignalClass: 'lamp-warn',
      hotSpotlight: { untilText: '还有 3 天', title: '阿禾的生日', contactName: '阿禾', typeLabel: '生日', signalClass: 'lamp-warn', sceneKey: 'birthday' },
      upcomingDates: [{ id: 'd1', title: '阿禾的生日', month: 10, day: 20, untilText: '3 天后', urgency: 'hot', typeLabel: '生日', contactName: '阿禾', signalClass: 'lamp-warn' },
        { id: 'd2', title: '结婚纪念日', month: 11, day: 8, untilText: '22 天后', urgency: 'near', typeLabel: '纪念日', signalClass: 'lamp-brass' }],
      dates: [{ id: 'd1' }] } },
  { name: 'gift-compose-2', h: 2200, wxml: 'subpackages/feature/gift/compose/index', base: 'gift-compose', data: { activeStep: 2, maxStep: 2, cardFocused: false, signed: true, sigJustSigned: false } },
  { name: 'order-pending', h: 2300, wxml: 'subpackages/business/order-detail/index', base: 'order-detail', data: { order: { _id: 'o2', serialNo: 'SH20261015003', status: 'pending_pay', totalPrice: '468.00', originalPrice: '468.00', discountRate: 1, couponValue: 20, shippingFee: 18, shippingFeeDisplay: '18.00', address: { name: '林', phone: '138****0012' }, addressLine: '上海市徐汇区漕溪北路 ** 号', products: [{ _id: 'p3', title: '蓝闪蝶 · A1 博物级', latin: 'Morpho menelaus', price: '468.00', count: 1, image: P[2] }] }, stampText: '待付款', stampClass: 'warn', payBtnLabel: '付款入藏', hasTracking: false } },
  { name: 'gift-receive-done', h: 1700, wxml: 'subpackages/feature/gift/receive/index', base: 'gift-receive', data: { accepted: true, addressDone: true, phoneMasked: '138****0012', addressMaskedLine: '上海市徐汇区 ***' } },
  { name: 'gift-receive-box', h: 1500, wxml: 'subpackages/feature/gift/receive/index', base: 'gift-receive', data: { revealed: false, ritePhase: 'idle', letterToShown: false, letterBodyShown: false } },
  { name: 'pet-1', h: 2000, wxml: 'subpackages/feature/custom/pet/index', data: { ...petBase, currentStep: 1, currentStepMeta: petMeta(1) } },
  { name: 'pet-2', h: 2200, wxml: 'subpackages/feature/custom/pet/index', data: { ...petBase, currentStep: 2, currentStepMeta: petMeta(2) } },
  { name: 'pet-3', h: 2400, wxml: 'subpackages/feature/custom/pet/index', data: { ...petBase, currentStep: 3, currentStepMeta: petMeta(3) } },
  { name: 'pet-5', h: 2000, wxml: 'subpackages/feature/custom/pet/index', data: { ...petBase, currentStep: 5, currentStepMeta: petMeta(5) } },
  {
    name: 'pet-status', h: 1700, wxml: 'subpackages/feature/custom/pet/status/index', data: {
      loading: false, loadError: false, orderId: 'po1', order: { orderNo: 'PM20261012003', status: 'quoted' }, statusLabel: '待确认报价', canConfirmQuote: true,
      quoteLines: [{ label: '仿生标本 · 安睡', value: '¥ 3,800.00' }, { label: '指定标本师', value: '标准' }, { label: '预计周期', value: '8 周' }],
      summaryLines: [{ label: '伙伴', value: '团子 · 猫' }, { label: '交接', value: '到店' }],
      history: [{ time: '10.12 14:20', note: '标本师林一完成评估，已报价' }, { time: '10.12 11:30', note: '标本师已接单评估' }, { time: '10.12 09:05', note: '用户提交意向' }]
    }
  },
  {
    name: 'pet-list', h: 1300, wxml: 'subpackages/feature/custom/pet/list/index', data: {
      loading: false, canApply: true,
      orders: [{ _id: 'po1', status: 'quoted', petTitle: '团子', statusLabel: '待确认报价', orderNo: 'PM20261012003', craftName: '仿生标本', formatTime: '10.12', quoteText: '报价 ¥3,800' }, { _id: 'po2', status: 'in_production', petTitle: '豆豆', statusLabel: '制作中', orderNo: 'PM20260901011', craftName: '骨骼标本', formatTime: '09.01' }]
    }
  },
  {
    name: 'wallet-coupons', h: 1700, wxml: 'subpackages/business/components/WalletPanelCoupons/index', data: {
      loading: false, usableCouponCount: 3, expiringCount: 1, lockedCount: 1, closedCount: 2, passState: 'idle', memberNo: '0137',
      coupons: [
        { _id: 'c1', title: '新会员礼券', faceLabel: '¥20', value: 20, minSpend: 0, canUse: true, canUseOnline: true, channelLabel: '线上 · 门店通用', expiryHint: '10.31 前有效', sourceLabel: '新会员礼包', useLabel: '去使用' },
        { _id: 'c2', title: '满减礼券', faceLabel: '¥50', value: 50, minSpend: 599, canUse: true, canUseOnline: true, channelLabel: '线上可用', expiryHint: '3 天后到期', expiringSoon: true, sourceLabel: '生日礼', useLabel: '去使用' },
        { _id: 'c3', title: '门店体验券', faceLabel: '8 折', minSpend: 0, canUse: true, canUseStore: true, channelLabel: '门店核销', expiryHint: '11.15 前有效', sourceLabel: '活动赠送', useLabel: '出示核销' }
      ]
    }
  },
  {
    name: 'wallet-balance', h: 1700, wxml: 'subpackages/business/components/WalletPanelWallet/index', data: {
      accountReady: true, account: { availableYuan: '1,280.00', memberNo: '0137' }, allowed: true, rechargeMode: true, needLogin: false, checking: false, iosBlocked: false, flashSuccess: false, ledgerLoading: false, ledgerEmpty: false, allowCustom: true, recharge: { minCustomYuan: 100, maxCustomYuan: 20000 }, paySummaryLabel: '实付 ¥1000 · 到账 ¥1080', selectedBenefitHint: '升至「藏家」，享 9.5 折', ledgerCap: '近 30 天',
      packages: [{ id: 'k1', label: '¥500', displayPayYuan: '500', pointsLine: '+500 积分', discountLine: '到账 ¥530' }, { id: 'k2', label: '¥1000', displayPayYuan: '1000', levelBadge: '升级', levelName: '藏家', pointsLine: '+1000 积分', discountLine: '到账 ¥1080' }, { id: 'k3', label: '¥2000', displayPayYuan: '2000', levelName: '馆员', pointsLine: '+2000 积分', discountLine: '到账 ¥2200' }],
      selectedPackageId: 'k2', rechargeMode: 'package', canPay: true, payBtnLabel: '充值 ¥1000',
      ledgerTimeline: [{ week: '本周', rows: [{ typeLabel: '消费', subtitle: '光明女神闪蝶 · 玻璃罩', amountSign: '-', amountYuan: '388.00', clockText: '10.12 14:20', toneClass: 'minus', balanceAfterYuan: '1,280.00' }, { typeLabel: '充值', subtitle: '储值 ¥1000 送 ¥80', amountSign: '+', amountYuan: '1,080.00', clockText: '10.10 09:12', toneClass: 'plus', isCredit: true, balanceAfterYuan: '1,668.00' }] }]
    }
  },
  {
    name: 'wallet-points', h: 1600, wxml: 'subpackages/business/components/WalletPanelPoints/index', data: {
      loading: false, points: 2680, pointsYuan: '26.80', curTab: 0,
      rewards: [{ _id: 'r1', title: '黄铜书签', cost: 800, image: P[3] }, { _id: 'r2', title: '标本小卡', cost: 300, image: P[4] }]
    }
  },
  {
    name: 'atlas', h: 3200, wxml: 'subpackages/feature/collection/index', data: {
      loading: false, loadError: false, offline: false, cards: atlasCards, filtered: atlasCards, stats: atlasStats,
      ticks: atlasCards.map((c) => ({ no: c.no, lit: c.unlocked })), categories: atlasCats, filter: 'all', seriesFilter: '', seriesBlurb: '',
      nextHint: '还差 10 页，其中 3 页藏在馆内印记里。', showAiIdentify: true, filterEmpty: false, catalogEmpty: false,
      recentNotes: [{ id: 'n1', speciesId: '033', title: '鹦鹉螺 · 镜头记下', metaText: '10.16 21:04 · 拍照采集' }, { id: 'n2', speciesId: '031', title: '银杏押花 · 在馆里被找到', metaText: '10.12 15:20 · 主店走廊尽头' }],
      unlockSheet: { show: false }, skelPlates: []
    }
  },
  {
    name: 'atlas-detail', h: 2600, wxml: 'subpackages/feature/collection/detail/index', data: {
      loading: false, loadError: false, locked: false, justUnlocked: false, methodText: '镜头记下 · 2026.10.16', seriesText: '守山者',
      card: Object.assign({}, atlasCards[12], { essay: '壳里一格一格的房间，是它一生搬过的家。最外面那一间住着现在，里面的门都关上了，只留一根细管把它们连起来。' }),
      facts: [{ k: '产地', v: '西太平洋与印度洋的珊瑚礁外坡' }, { k: '习性', v: '白天沉在深处，夜里随水温上浮觅食' }, { k: '柜位', v: '海洋标本柜下层' }, { k: '印记码', v: 'SH-S5' }],
      relatedProducts: [{ _id: 'p1', title: '鹦鹉螺剖面标本', latinName: 'Nautilus pompilius', image: '', priceText: '680' }],
      logs: [{ id: 'l1', methodLabel: '拍照采集', timeText: '2026.10.16 21:04', place: '' }], hasLogs: true
    }
  },
  {
    name: 'atlas-locked', h: 1800, wxml: 'subpackages/feature/collection/detail/index', data: {
      loading: false, loadError: false, locked: true, card: atlasCards[2], facts: [], relatedProducts: [], logs: []
    }
  },
  // 2026-10-17 标本养护「养护手册」：品类卡的刻版线描取真源 carePlateOf
  {
    name: 'care-hub', h: 3000, wxml: 'subpackages/feature/care/index', data: {
      loading: false, pageReady: false, expandedTip: 'light', seasonEyebrow: 'AUTUMN · 10 月',
      seasonalTip: { key: 'autumn', title: '秋季提醒', desc: '秋燥与早晚温差加大，留意框体背板与玻璃面的细小起雾。' },
      specimenTotal: 4,
      recentSpecimens: [
        { key: 's1', title: '光明女神闪蝶 · A1 博物级', image: '', categoryLabel: '蝴蝶昆虫', receiveTimeText: '2026.10.12', careSummary: '避光、干爽，框面朝外平稳悬挂；季节交替时检查背板。' },
        { key: 's2', title: '鹦鹉螺剖面标本', image: '', categoryLabel: '海洋标本', receiveTimeText: '2026.09.28', careSummary: '远离水汽，软毛刷单向除尘，不用湿布擦拭。' }
      ],
      categoryCards: [['INSECTA', '蝴蝶昆虫', '框画与展柜昆虫标本'], ['ANIMALIA', '动物世界', '剥制、骨骼与皮张藏品'], ['PLANTAE', '植物果实', '押花、干制与植物标本'], ['MARINE', '海洋标本', '海洋干制与浸液标本'], ['MINERALS', '矿石馆', '矿物与晶洞陈列'], ['GENERAL', '通用安放', '摆放、避光与运输'], ['FRAMING', '装裱养护', '木框、金属框与定制装裱']]
        .map(([category, label, desc], i) => ({ category, label, desc, overline: category, wide: i === 6, plate: atlasPlates.carePlateOf(category) })),
      generalTips: [{ key: 'light', title: '避光安放', desc: '远离南向窗台与射灯长时间直射' }, { key: 'humidity', title: '干爽环境', desc: '室内相对湿度建议 45–60%，避免浴室与厨房旁' }, { key: 'touch', title: '少触碰', desc: '观赏时轻拿框架，避免手指直接按压藏品表面' }, { key: 'move', title: '搬运原则', desc: '原包装+缓冲材，框面或玻璃面向上平放' }]
    }
  },
  {
    name: 'care-guide', h: 2600, wxml: 'subpackages/feature/care/guide/index', data: {
      loading: false, loadError: false, hasGuide: true, pageReady: false, categoryPlate: atlasPlates.carePlateOf('INSECTA'),
      categoryOverline: 'INSECTA', categoryHeading: '昆虫标本养护', categoryLead: '框画与展柜', categoryLabel: '蝴蝶昆虫',
      contextOverline: 'YOUR SPECIMEN', contextLabelText: '这件藏品', contextTitle: '光明女神闪蝶 · A1 博物级', framingName: '胡桃木浅框', isCustom: false, orderId: 'o1',
      guide: { summary: '避光、干爽、少碰。鳞片怕光怕潮，框体怕温差。', disclaimer: '以下为一般性安放建议，不构成保存保证，请以随件说明或专员指引为准。' },
      activeSection: 'environment', collapsedSections: { cleaning: true },
      contentSections: [
        { key: 'environment', indexLabel: '01', overline: 'ENVIRONMENT', title: '适宜环境', body: '鳞翅目标本对光与湿度敏感。长时间日照会让结构色褪淡，高湿会让翅面起霉。', tips: ['避开南向窗台与射灯直射', '相对湿度 45–60%'] },
        { key: 'placement', indexLabel: '02', overline: 'PLACEMENT', title: '日常摆放', body: '框画宜挂在视线高度、少人流碰撞处。', tips: ['不与花瓶、饮料同层'] },
        { key: 'cleaning', indexLabel: '03', overline: 'CLEANING', title: '清洁与除尘', body: '', tips: [] }
      ],
      warningSection: { overline: 'CAUTION', title: '异常信号', body: '出现以下情况请联系专员，不要自行拆框。', tips: ['玻璃内侧起雾或水珠', '翅面出现白色絮状物'] },
      framingTips: ['木框避免贴近暖气'], 
    }
  },
  // 2026-10-17 收藏与候补「藏品清单」 / 荣誉档案（证书缩样）
  { name: 'wishlist', h: 1800, wxml: 'subpackages/extra/user/wishlist/index', data: { loading: false, tab: 'wishlist', favoriteCount: 12, wishlistCount: 2,
      list: [{ _id: 'w1', productId: 'p1', title: '光明女神闪蝶 · A1 博物级', latinName: 'Morpho helena', price: 1280, image: P[0], soldOut: true, hasDeposit: true, savedText: '10.12 记下' },
        { _id: 'w2', productId: 'p2', title: '鹦鹉螺剖面标本', latinName: 'Nautilus pompilius', price: 680, image: P[1], soldOut: true, hasDeposit: false, savedText: '9.28 记下' }] } },
  { name: 'certificates', h: 2000, wxml: 'subpackages/extra/user/certificates/index', data: { loading: false, loadError: false, holderCount: 3, givenCount: 1, filter: 'all',
      certificates: [{ _id: 'c0' }],
      visible: [
        { _id: 'c1', displayTitle: '光明女神闪蝶', displayImage: P[0], dateStr: '2026.10.12', kind: 'holder', kindLabel: '' },
        { _id: 'c2', displayTitle: '自然小匣', displayImage: P[1], dateStr: '2026.09.22', kind: 'gift_voucher', kindLabel: '赠予凭证' },
        { _id: 'c3', displayTitle: '银杏押花框', displayImage: P[2], dateStr: '2026.09.03', kind: 'gift_holder', kindLabel: '受赠' },
        { _id: 'c4', displayTitle: '紫水晶晶簇', displayImage: P[3] || P[0], dateStr: '2026.08.18', kind: 'holder', kindLabel: '' }
      ] } },
  // 2026-10-17 预约「入馆券」（wxml-preview 已支持表达式内的 <，预约页第一次能离线出图）
  { name: 'booking', h: 2600, wxml: 'subpackages/business/booking/index', data: {
      ticketYear: 2026, ticketInfo: { dateStr: '10月 18', timeStr: '14:00', typeStr: '入店参观' }, bookCount: 2, contactName: '林间拾蝶', contactPhone: '',
      currentTab: 0, storeLocked: false, storeName: '山海造物 · 主店', storeLocationLabel: '上海 · 徐汇', storeVisitTips: ['到店请出示入馆券', '馆内请勿触摸未开放标本'], storePickerOpen: false, storeList: [], storeId: 's1',
      isCustomBooking: false, customPlanLines: [], isPetIntakeBooking: false, petPlanLines: [], showCalendar: false, selectedCalendarDate: '', unavailableDates: [], fullDates: [],
      weekDays: [['周六', 18], ['周日', 19], ['周一', 20], ['周二', 21], ['周三', 22], ['周四', 23]].map(([week, day]) => ({ week, day })), selectedDateIndex: 0,
      timeSlots: [{ time: '10:00', status: 'open' }, { time: '11:00', status: 'open' }, { time: '14:00', status: 'open' }, { time: '15:00', status: 'full' }, { time: '16:00', status: 'open' }, { time: '17:00', status: 'open' }], selectedTimeIndex: 2,
      courses: [], activities: [], selectedActivityId: '', bookingHistoryTab: 0, upcomingBookings: [], historyBookings: [], loadingBookings: false,
      showMintModal: false, mintAnimation: false, mintFinished: false, newTicketCode: '', regDialogShow: false } },
  { name: 'booking-back', h: 900, wxml: 'subpackages/business/booking/index', base: 'booking', data: { isFlipped: true } },
  { name: 'booking-mine', h: 1800, wxml: 'subpackages/business/booking/index', base: 'booking', data: { currentTab: 3, bookingHistoryTab: 0,
      upcomingBookings: [{ _id: 'b1', type: 'visit', title: '入店参观 · 山海造物主店', _id_short: 'A7F3', month: '10月', day: '18', time: '14:00', people: 2 },
        { _id: 'b2', type: 'handcraft_course', title: '蝴蝶标本手作课', _id_short: 'C2K9', month: '10月', day: '26', time: '14:00 - 16:00', people: 1 }] } },
  // 2026-10-17 门店「到店指南」（到店链路 B8 第二页）
  { name: 'store', h: 3600, wxml: 'subpackages/business/store/index', data: {
      loading: false, scrollTop: 76, enterReady: true, storePickerOpen: false, lbsSheetOpen: false, lbsSuggestStore: null, bookingClosedToday: false, closedReasonLabel: '',
      introExpanded: false, tipsExpanded: true, walkingGuideOpen: true, checkedInToday: false, checkInLoading: false, checkInDockVisible: true,
      brandWebsite: 'shanchuanzaowu.com', featuresLine: '入店参观 · 馆藏零售 · 品牌体验', hasActivities: true, hasExperienceProducts: true, experienceLoading: false,
      stores: [{ storeId: 's1', name: '山川造物', locationLabel: '这有山 · 山腰' }, { storeId: 's2', name: '星宸标本', locationLabel: '这有山 · 楼下' }],
      store: { storeId: 's1', name: '山川造物', nameEn: 'SHANCHUAN CREATIONS', roleLabel: '品牌主店', locationLabel: '这有山 · 山腰', mallName: '这有山', floor: '山坡 X-06-1',
        address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1', phone: '18519110274', hoursText: '10:00 – 22:00', coverImage: P[2], heroTagline: '像走进一间暖光藏品馆',
        intro: '主店位于这有山山腰，陈列昆虫、矿物、植物与海洋标本，可现场选购与预约参观。', openStatus: { label: '营业中', statusClass: 'open' },
        visitTips: ['从商场主入口进入，沿山坡动线至 X-06-1', '建议错峰参观，周末下午客流较多', '展柜内藏品请勿触摸，如需协助可联系店员'],
        zones: [{ zoneId: 'z1', title: '蝴蝶昆虫柜', overline: 'INSECTA', color: '#C4A76C', desc: '闪蝶、鸟翼蝶与组合框画，每件配有物种信息。', coverImage: P[0] },
          { zoneId: 'z2', title: '矿石标本柜', overline: 'MINERALS', color: '#C4A76C', desc: '晶洞与矿石，呈现大地的色彩与几何。', coverImage: P[3] },
          { zoneId: 'z3', title: '植物果实柜', overline: 'PLANTAE', color: '#C4A76C', desc: '押花、果实与种子，记录叶片与花的细微结构。', coverImage: P[5] }],
        services: [{ id: 'sv1', label: '预约参观', tab: 0 }, { id: 'sv2', label: '手作课程', tab: 1 }, { id: 'sv3', label: '到店自提' }],
        walkingGuide: { headline: '前往工坊 · 步行约 5 分钟', peerName: '星宸标本', peerLocation: '这有山 · 楼下',
          steps: ['从主店出发，沿商场山坡动线至下行扶梯', '乘扶梯至楼下层，沿标识前往工坊', '工坊承接定制确认、装裱咨询与手作课程'], tip: '建议先逛主店选品，再到工坊确认定制方案' } },
      experienceProducts: [{ _id: 'e1', title: '光明女神闪蝶', latinName: 'Morpho helena', priceText: '1280', image: P[0] }, { _id: 'e2', title: '血漪蝶穹顶', latinName: 'Cethosia biblis', priceText: '680', image: P[1] }, { _id: 'e3', title: '蒲公英玻璃罩', latinName: '', priceText: '268', image: P[3] }],
      storeActivities: [{ _id: 'a1', type: 'handcraft_course', title: '蝴蝶标本手作课', date: '10月26日', time: '14:00' }, { _id: 'a2', type: 'special_activity', title: '秋夜观虫 · 灯诱讲座', date: '11月02日', time: '19:00' }] } },
  // 2026-10-17 入馆券 / 门店自取凭证（到店链路最后两页）
  { name: 'ticket', h: 1700, wxml: 'subpackages/business/ticket/index', data: { loadError: false, bookingShortId: 'A7F3K2', showRescheduleModal: false, weekDays: [], timeSlots: [],
      booking: { _id: 'b1', status: 'confirmed', title: '入店参观 · 山川造物主店', date: '2026-10-18', time: '14:00', people: 2 } } },
  { name: 'ticket-used', h: 1500, wxml: 'subpackages/business/ticket/index', base: 'ticket', data: { booking: { _id: 'b1', status: 'used', title: '蝴蝶标本手作课', date: '2026-10-12', time: '14:00', people: 1 } } },
  { name: 'pickup', h: 2200, wxml: 'subpackages/business/pickup-pass/index', data: { loading: false, statusUnknown: false, orderNo: 'SH20261017A01', codeText: '', qrFailed: false, error: '', showRefundEntry: true, claimedAtText: '',
      storeName: '山川造物 · 主店', storeInfo: { canNavigate: true, floor: '这有山 · 山坡 X-06-1', hours: '10:00 – 22:00', address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1' },
      pass: { statusLabel: '备妥待取', statusTone: 'ready', headline: '藏品已备妥，可到店领取', hint: '请在 7 日内到店，向专员出示二维码或自取码。', codeText: '4826 1937',
        steps: [{ label: '支付完成', state: 'done' }, { label: '备妥待取', state: 'done' }, { label: '到店领取', state: 'current' }] } } },
  { name: 'pickup-done', h: 1700, wxml: 'subpackages/business/pickup-pass/index', base: 'pickup', data: { showRefundEntry: false, claimedAtText: '10月17日 15:20',
      pass: { statusLabel: '已自提', statusTone: 'done', headline: '本次自取已完成', hint: '', codeText: '4826 1937',
        steps: [{ label: '支付完成', state: 'done' }, { label: '备妥待取', state: 'done' }, { label: '到店领取', state: 'done' }] } } }
]

async function shoot(s) {
  const missing = new Set()
  let wxml = inlineTemplates(read(join(MP, s.wxml + '.wxml')))
    .replace(/<wxs[^>]*\/>/g, '').replace(/<wxs\b[^>]*>[\s\S]*?<\/wxs>/g, '')
    .replace(/<checkbox-group\b/g, '<view').replace(/<\/checkbox-group>/g, '</view>').replace(/<checkbox\b[^>]*?\/>/g, '<view class="__cb"></view>').replace(/<checkbox\b([^>]*)>[\s\S]*?<\/checkbox>/g, '<view class="__cb"></view>')
    .replace(/<picker\b[^>]*>/g, '<view>').replace(/<\/picker>/g, '</view>')
    .replace(/<scroll-view\b/g, '<view').replace(/<\/scroll-view>/g, '</view>')
    .replace(/<sensitive-blur-gate\b[^>]*>/g, '<view>').replace(/<\/sensitive-blur-gate>/g, '</view>')
    .replace(/<swiper-item\b/g, '<view').replace(/<\/swiper-item>/g, '</view>').replace(/<swiper(?=[\s>])/g, '<view').replace(/<\/swiper>/g, '</view>')
  const body = renderWxml(wxml, { latin: { display: (x) => x || '' }, ...s.data }, { lenient: true, onMissing: (k) => missing.add(k) })
  const css = rpx2px(loadWxss(join(MP, 'app.wxss')) + '\n' + loadWxss(join(MP, s.wxml + '.wxss')))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", "Noto Sans SC", sans-serif; }
img { object-fit: cover; } img:not([src]), img[src=""] { visibility: hidden; }
/* app.wxss 的 view, text, image 的 border-box 选不到渲染后的 div/span/img —— 补上，否则 width:100% + padding 会假溢出 */
div, span, img { box-sizing: border-box; }
</style><style>${toHtmlCss(css)}</style><style>
*, *::before, *::after { animation-play-state: paused !important; animation-delay: -10s !important; }
[class*="mask"][class*="ui-pop"] { display: none !important; }
.main-scroll { position: static !important; height: auto !important; top: auto !important; overflow: visible !important; }
.sticky-header { position: relative !important; }
.footer-bar { position: relative !important; }
.__cb { display: inline-block; width: 28px; height: 28px; border: 1px solid #c4a76c; border-radius: 4px; vertical-align: middle; }
</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `core-${s.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${s.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'core-flows-'))
  // headless 截图会少画窗口底部约 90px：窗口多给 120px，截完再裁
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=750,${s.h + 120}`, `--screenshot=${out}`, `file://${htmlPath}`], { stdio: 'ignore' })
  const deadline = Date.now() + 120000
  let last = -1
  while (Date.now() < deadline) {
    const size = existsSync(out) ? statSync(out).size : 0
    if (size > 1000 && size === last) break
    last = size
    await new Promise((r) => setTimeout(r, 400))
  }
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
  console.log(`✓ ${s.name} → ${out}（缺字段 ${missing.size}）`)
}

for (const s of SCENES) if (s.base) s.data = { ...SCENES.find((x) => x.name === s.base).data, ...s.data }
for (const s of SCENES) {
  if (only.length && !only.includes(s.name)) continue
  try { await shoot(s) } catch (e) { console.log(`✗ ${s.name}：${e.message.split('\n')[0]}（订单列表等页另有 render-bflow-preview）`) }
}
