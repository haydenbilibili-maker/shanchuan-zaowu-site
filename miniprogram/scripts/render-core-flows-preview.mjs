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
  // 2026-10-18 仪式感：鉴定结果「打字机」打到一半（中文名已晕开、学名敲到一半 + 黄铜光标、置信度尚未填）
  { name: 'species-card-typing', h: 1100, wxml: 'subpackages/feature/components/SpeciesCard/index', base: 'species-card', data: {
      typewriter: true, inkIn: true, latinShown: 'Morpho hel', latinTyping: true, confReady: false, confPct: 92, confTone: 'high', confidenceDesc: '较高 · 可作为参考' },
    css: '.latin-caret { animation: none !important; }' },
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
  // 2026-10-18 仪式感（产品负责人点名）：收下 → 礼笺「已收」朱印
  { name: 'gift-receive-accepted', h: 1300, wxml: 'subpackages/feature/gift/receive/index', base: 'gift-receive', data: { accepted: true, acceptStampLive: true, addressDone: false, holderCard: true } },
  // 支付成功「已入藏」标本签（背后页只给最少数据，深遮罩盖住）
  { name: 'order-paid-rite', h: 1300, wxml: 'subpackages/business/confirm-order/index', data: {
      items: [{ productId: 'p1', title: '光明女神闪蝶 · 原色标本框', image: '' }, { productId: 'p2', title: '蓝闪蝶', image: '' }],
      paidRite: { show: true, title: '光明女神闪蝶 · 原色标本框', more: 1, tail: 'K7Q2M9', pickup: false } },
    css: '.ui-pop-mask.ui-pop-mask.is-center { display: flex !important; }' },
  // 送礼人回执：对方已留址 → 状态印换朱印「已收」+ 回执落款
  { name: 'gift-sender-receipt', h: 1250, wxml: 'subpackages/feature/gift/receive/index', base: 'gift-receive', data: {
      isSender: true, senderPhase: 'address_done', senderOverline: 'RECEIPT', senderTitle: '对方已留下去处', senderDesc: '这份山海即将启程。可在订单中查看履约与物流进度。',
      senderCanShare: false, senderCanNudge: false, senderReceipt: true, senderReceiptLive: true, recipientName: '阿禾' } },
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
      loading: false, usableCouponCount: 3, expiringCount: 1, expiringDays: 7, lockedCount: 1, closedCount: 2, passState: 'idle', memberNo: '0137', closedExpanded: false, lockedCoupons: [{ _id: 'c9', title: '满减礼券', faceLabel: '¥30', value: 30, minSpend: 299, canUse: false, status: 'locked', channelLabel: '线上可用', expiryHint: '11.30 前有效', sourceLabel: '积分兑换' }], closedCoupons: [],
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
      selectedPackageId: 'k2', rechargeMode: 'package', canPay: true, payBtnLabel: '充值 ¥1000', walletPlateFooter: 'SHANHAI · MEMBER WALLET', walletRechargeLead: '选一档储值，到账即可在线上与门店消费', walletRechargeHint: '储值余额不可提现，可用于线上与门店消费', walletSecurityNote: '余额变动会推送提醒；如非本人操作请联系专员', customAmount: '', customHint: '', ledgerHasMore: false,
      ledgerTimeline: [{ week: '本周', rows: [{ typeLabel: '消费', subtitle: '光明女神闪蝶 · 玻璃罩', amountSign: '-', amountYuan: '388.00', clockText: '10.12 14:20', toneClass: 'minus', balanceAfterYuan: '1,280.00' }, { typeLabel: '充值', subtitle: '储值 ¥1000 送 ¥80', amountSign: '+', amountYuan: '1,080.00', clockText: '10.10 09:12', toneClass: 'plus', isCredit: true, balanceAfterYuan: '1,668.00' }] }]
    }
  },
  {
    name: 'wallet-points', h: 1600, wxml: 'subpackages/business/components/WalletPanelPoints/index', data: {
      loading: false, points: 2680, pointsYuan: '26.80', curTab: 0, pointsReady: true, pointsText: '2,680', levelName: '藏家', onlineSpendTotal: '3,260', storeSpendTotal: '1,180', platformSpendTotal: 0, storePointsTotal: 1180, myRewards: [],
      rewards: [{ _id: 'r1', title: '黄铜书签', description: '蚀刻闪蝶纹样', cost: 800, stock: 12, type: 'physical', image: P[3] }, { _id: 'r2', title: '¥30 礼券', description: '全场满 199 可用', cost: 3000, stock: 99, type: 'coupon', image: P[4] }]
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
  // 2026-10-18 打印弹层防遮挡：按矮屏（iPhone SE 级）出图，按钮须完整落在出纸下方
  { name: 'booking-mint', h: 1180, wxml: 'subpackages/business/booking/index', base: 'booking', data: { showMintModal: true, mintAnimation: true, mintFinished: true, newTicketCode: 'A7F3K2' },
    css: '.ui-pop-mask.mint-modal.is-open { display: flex !important; } .mint-modal, .mint-modal * { transition: none !important; }' },
  // 2026-10-18 店员工作台（逐个工作台优化）
  { name: 'staff-hub', h: 2300, wxml: 'subpackages/extra/staff/index', data: {
      ready: true, roleText: '店员', staffName: '阿桃', storeNames: ['山海造物 · 主店'], storeIndex: 0, storeName: '山海造物 · 主店', showScanCta: true, hasScenes: true,
      groups: [
        { key: 'onsite', title: '现场服务', en: 'ON-SITE', items: [
          { key: 'verify', title: '核销验票', desc: '会员码 · 预约票 · 门店礼券 · 礼赠自提', en: 'TICKET', icon: '/assets/icons/qrcode.png', badge: 3 },
          { key: 'grant', title: '消费赠分', desc: '扫会员码录入消费并赠分', en: 'GRANT', icon: '/assets/icons/coin_gold.png' },
          { key: 'visit', title: '到店签到', desc: '查看今日到店人数', en: 'VISIT', icon: '/assets/icons/checkin.png' },
          { key: 'records', title: '赠分流水', desc: '本人或本店今日赠分记录', en: 'LEDGER', icon: '/assets/icons/list.png' }] },
        { key: 'shift', title: '班次日常', en: 'SHIFT', items: [
          { key: 'attendance', title: '考勤打卡', desc: '上下班打卡，记录门店与时间', en: 'ATTENDANCE', icon: '/subpackages/manager/assets/icons/clock.png' },
          { key: 'leave', title: '请假申请', desc: '事假病假年假调休，提交后待审批', en: 'LEAVE', icon: '/assets/icons/list.png' },
          { key: 'todos', title: '早晚门店清单', desc: '开闭店陈列、收银与安防核对', en: 'CHECKLIST', icon: '/assets/icons/done.png', badge: 2 }] },
        { key: 'hr', title: '人事与薪酬', en: 'PAYROLL', items: [
          { key: 'payslip', title: '工资条明细', desc: '应发实发 · 所属门店销售分成 1%', en: 'PAYSLIP', icon: '/assets/icons/wallet_gold.png' },
          { key: 'reimburse', title: '报销申请', desc: '提交费用报销并跟踪审核', en: 'EXPENSE', icon: '/assets/icons/pay.png' }] }
      ] } },
  // 2026-10-18 权限配置「编辑权限」弹窗（真机反馈滑不动 + 右缘被裁）：正文改 scroll-view，按 iPhone 级高度出图
  { name: 'staff-perm-modal', h: 1500, wxml: 'subpackages/extra/staff-permissions/index', data: {
      ready: true, tipText: '', loading: false, listError: false, staffList: [{ _id: 's1', name: '藏家', roleText: '店长', status: 'active', openidTail: 'Qu71iyll', showStoreScope: true, storeIds: [], dailyGrantCap: 0 }],
      showStaffModal: true, staffLookingUp: false, staffMatchHint: '', staffCandidates: [], staffMemberNoInput: '',
      staffMatched: { openid: 'oa22', nickName: '藏家', openidTail: 'Qu71iyll' },
      staffForm: { phone: '', openid: 'oa22s5Z2JcC1FGKRfYB0Qu71iyll', openidTail: 'Qu71iyll', name: '藏家', staffNo: '' },
      staffRoleLabels: ['店员', '店长', '超管', '标本师', '主播', '股东'], staffRoleValues: ['staff', 'manager', 'super', 'artisan', 'host', 'holder'], staffRoleSelected: { manager: true },
      featureGroups: [{ roleKey: 'manager', title: '店长工作台', en: 'MANAGER', items: [{ key: 'a', label: '订单', checked: true }, { key: 'b', label: '账本', checked: true }, { key: 'c', label: '审批', checked: false }] }],
      showStoreScope: true, showShareholderConfig: false, staffStoreChecks: [{ key: 'all', name: '全部门店', selected: true, isAll: true }, { key: 's1', name: '山海造物 · 主店', storeId: 's1' }],
      formTip: '', staffSaving: false },
    css: '.ui-pop-mask.is-center { display: flex !important; }' },
  // 2026-10-18 股东配置（超管二级页，逐页视觉对齐）：列表 + 编辑抽屉两张图
  { name: 'shareholder-config', h: 2000, wxml: 'subpackages/extra/shareholder-config/index', data: {
      ready: true, obsPending: false, tipText: '', loading: false, listError: false, filterLabels: ['全部门店', '山川造物', '星宸标本'], filterIndex: 0, showForm: false, disablePendingId: '', enablePendingId: '',
      list: [
        { _id: 'h1', name: '林岚', status: 'active', statusLabel: '生效', staffNo: 'SH-01', storeName: '山川造物 · 主店', openidTail: 'Qu71iyll', ownershipRatioText: '30%', beforeText: '50%', afterText: '35%', capitalText: '¥300,000', effectiveDate: '2025-03-01' },
        { _id: 'h2', name: '周砚', status: 'disabled', statusLabel: '已停用', staffNo: '', storeName: '星宸标本 · 工坊', openidTail: 'Zx90abQe', ownershipRatioText: '12%', beforeText: '20%', afterText: '20%', capitalText: '¥120,000', effectiveDate: '2024-11-15' }
      ] } },
  { name: 'shareholder-config-form', h: 1700, wxml: 'subpackages/extra/shareholder-config/index', base: 'shareholder-config', data: {
      showForm: true, editingId: '', lookingUp: false, matchHint: '', candidates: [], saving: false, formTip: '',
      matched: { openid: 'oa22', nickName: '林岚', openidTail: 'Qu71iyll' },
      form: { phone: '13800001234', openid: 'oa22', openidTail: 'Qu71iyll', name: '林岚', staffNo: 'SH-01', ownershipRatio: '30', capitalContribution: '300000', dividendRatioBeforePayback: '50', dividendRatioAfterPayback: '35', effectiveDate: '2025-03-01' },
      storeChecks: [{ key: 's1', storeId: 's1', name: '山川造物 · 主店', selected: true }, { key: 's2', storeId: 's2', name: '星宸标本 · 工坊', selected: false }] },
    css: '.ui-pop-mask.ui-pop-mask { display: block !important; }' },
  // 2026-10-18 审批中心（视觉对齐 + 驳回面板：常用原因快选 + 补充说明 + 预览）
  { name: 'approvals', h: 1900, wxml: 'subpackages/extra/approvals/index', data: {
      ready: true, scopeHint: '超管 · 全部门店', hubFlow: false, viewMode: 'inbox', overdueCount: 1, slaHours: 24, tipText: '', canDecideTabs: true,
      overviewExpanded: false, overviewReady: true, overviewSummary: '待我审 3 · 超时 1', overviewLoading: false,
      auditHub: [{ key: 'list', label: '审批' }, { key: 'flow', label: '积分流水' }, { key: 'claim', label: '小票认领' }], hubMode: 'list',
      pendingBadge: 3, statusOptions: ['全部'], statusIndex: 0, typeOptions: ['全部类型', '小票认领', '门店赠分'], typeIndex: 0, total: 3,
      expandedId: '', deciding: false, decidingId: '', decidingAction: '', approvePendingId: '', ignorePendingId: '', loading: false, listError: false, hasMore: false,
      list: [
        { _id: 'a1', status: 'pending', statusText: '待审核', overdue: true, title: '小票认领 · 林间拾蝶 ¥286', actionType: 'points_receipt_claim', actionLabel: '小票认领', overdueText: '已超时 30h', summary: '小票号 0921-0087 · 申请 +286 分', showAttachmentBlock: true, hasAttachments: false, metaLine: '店员 阿桃 · 10-17 08:12', canDecide: true, canIgnore: true, requireRejectReason: false, detailLines: [] },
        { _id: 'a2', status: 'pending', statusText: '待审核', overdue: false, title: '订单退款 · SO20261016-031', actionType: 'order_refund', actionLabel: '订单退款', overdueText: '剩余 18h', summary: '退款 ¥1,280 · 顾客称运输破损', showAttachmentBlock: false, metaLine: '店长 林岚 · 10-18 09:40', canDecide: true, canIgnore: false, requireRejectReason: true, detailLines: [] }
      ],
      rejectSheet: { show: false, reasons: [], picked: [] } } },
  // 小惊喜：本次进页后把待审清空 → 「审毕」朱印 + 本轮件数
  { name: 'approvals-cleared', h: 1100, wxml: 'subpackages/extra/approvals/index', base: 'approvals', data: {
      list: [], total: 0, pendingBadge: 0, overdueCount: 0, sessionDecided: 4, emptyTitle: '待审已清空', emptyHint: '新的申请会出现在这里' } },
  { name: 'approvals-reject', h: 1500, wxml: 'subpackages/extra/approvals/index', base: 'approvals', data: {
      rejectSheet: { show: true, id: 'a2', title: '订单退款 · SO20261016-031', typeLabel: '订单退款', requireReason: true,
        reasons: [{ label: '不符合退款条件', on: false }, { label: '请先与顾客沟通', on: true }, { label: '退款金额有误', on: true }, { label: '信息不全，请补充后重新提交', on: false }],
        picked: ['请先与顾客沟通', '退款金额有误'], note: '破损照片未上传', preview: '请先与顾客沟通；退款金额有误；破损照片未上传', tip: '' } },
    css: '.ui-pop-mask.ui-pop-mask.is-center { display: flex !important; }' },
  // 2026-10-18 仪式感：考勤打孔卡 / 门店清单开馆·闭馆
  { name: 'staff-attendance', h: 1250, wxml: 'subpackages/extra/staff/attendance/index', data: {
      ready: true, storeNames: ['山海造物 · 主店'], storeIndex: 0, storeName: '山海造物 · 主店', todayStatus: 'in', todayStatusLabel: '已上班，待下班', todayStatusHint: '上班 10-18 09:12 · 准时',
      lastClock: '上班打卡成功 · 准时', canClockIn: false, canClockOut: true, onLeave: false, leaveHint: '', loading: false, clocking: false, justPunched: 'in',
      today: [{ _id: 't1', typeLabel: '上班', statusLabel: '准时', timeText: '10-18 09:12' }], recent: [{ _id: 'r1', storeName: '山海造物 · 主店', typeLabel: '下班', timeText: '10-17 21:05', statusLabel: '准时' }],
      weekSummary: '本周出勤 5 天 · 迟到早退 1 次',
      week: [['一', 12, 'ok', 'ok'], ['二', 13, 'ok', 'warn'], ['三', 14, '', ''], ['四', 15, 'ok', 'ok'], ['五', 16, 'warn', 'ok'], ['六', 17, 'ok', 'ok'], ['日', 18, 'ok', '']].map(([dow, day, i, o], k) => ({ key: 'd' + k, dow, day, in: i, out: o, isToday: k === 6, isFuture: false })) } },
  { name: 'todos-open', h: 900, wxml: 'subpackages/extra/staff/store-todos/index', data: {
      ready: true, storeNames: ['山海造物 · 主店'], storeIndex: 0, storeName: '山海造物 · 主店', shift: 'morning', dateKey: '2026-10-18', saving: false, lastSave: '',
      progress: { done: 3, total: 3 }, shiftStatus: 'done', shiftStatusLabel: '本班次已全部完成', ceremony: 'open', ceremonyLive: true, ceremonyTime: '09:26',
      items: [{ id: 'a', label: '展柜灯与温湿度', checked: true, checkedAtText: '10-18 09:20' }, { id: 'b', label: '收银备用金核对', checked: true, checkedAtText: '10-18 09:24' }, { id: 'c', label: '门口陈列与地面', checked: true, checkedAtText: '10-18 09:26' }] },
    css: '.ceremony.is-live .cer-door { animation: none !important; opacity: 1; } .cer-door.left { transform: translateX(-58%) !important; } .cer-door.right { transform: translateX(58%) !important; }' },
  { name: 'todos-close', h: 600, wxml: 'subpackages/extra/staff/store-todos/index', base: 'todos-open', data: { shift: 'evening', ceremony: 'close', ceremonyTime: '21:08' },
    css: '.ceremony.is-live .cer-lamp { animation: none !important; background: #C9A55E; box-shadow: 0 0 0 2rpx rgba(196,167,108,.5), 0 0 30px 8px rgba(242,213,142,.28); }' },
  // 2026-10-18 阅读仪式：标题下预计时长、顶部进度线（读到 62%）、正文末尾「读毕」（mp-html 正文在预览里会被跳过）
  { name: 'article-read', h: 1250, wxml: 'subpackages/feature/articles/detail/index', data: {
      loadError: false, articleId: 'a1', fallbackCover: P[0], categoryIcon: '', iconView: '', iconLike: '', iconCollect: '', iconShare: '', isLiked: false, isCollected: false, savingCard: false,
      article: { title: '闪蝶的蓝从哪里来', author: '山海编辑部', category: 'knowledge', coverImage: P[0], createTime: 0, images: [], tags: ['结构色', '闪蝶'], brief: '那抹蓝不是颜料，是光在鳞片里走了一段路。', stats: { views: 1280, likes: 96 } },
      readMinutes: 6, readProgress: 0.62, readDone: true, readSpent: 5, relatedArticles: [] } },
  // 反馈回执单（提交成功后 1.8s 内）
  { name: 'feedback-receipt', h: 1100, wxml: 'subpackages/extra/user/feedback/index', data: {
      categories: [{ id: 'product', label: '藏品建议' }], activeCategory: 'product', messageText: '', ticketImages: [], maxTicketImages: 3, contactPhone: '', submitting: false,
      receipt: { show: true, no: 'FB-7Q2K9X', label: '藏品建议' } },
    css: '.ui-pop-mask.ui-pop-mask.is-center { display: flex !important; }' },
  // 2026-10-19 证书加载：打印机出纸（定格在纸已吐出的一帧）
  { name: 'cert-printing', h: 1100, wxml: 'subpackages/business/certificate/index', data: { isMinting: true, statusBarHeight: 44, missingId: false, certState: '' },
    // 加载层是 absolute + 100% 高，靠真机视口撑开；离线预览改为正常流排布（预览专用）
    css: '.minting-layer { position: relative !important; height: auto !important; padding: 160px 0 !important; } .cp-paper, .cp-progress-bar, .cp-slot { animation: none !important; } .cp-progress-bar { transform: translateX(60%); }' },
  // 2026-10-18 方向池 ★★：礼笺封缄 / 工作台问候 / 档案 +N% / 入展展签 / 陪伴天数
  { name: 'gift-seal', h: 2200, wxml: 'subpackages/feature/gift/compose/index', base: 'gift-compose-2', data: { letterSealed: true },
    css: '.card-seal { animation: none !important; }' },
  { name: 'staff-greet', h: 900, wxml: 'subpackages/extra/staff/index', base: 'staff-hub', data: { greetWord: '下午好' } },
  { name: 'profile-bump', h: 1100, wxml: 'subpackages/extra/user/profile/index', base: 'profile', data: { scoreBump: '+15%' },
    css: '.pf-score-bump, .pf-score-val.is-bump { animation: none !important; opacity: 1 !important; }' },
  { name: 'publish-exhibit', h: 1100, wxml: 'subpackages/feature/community/publish/index', data: {
      type: 'note', images: [], title: '', content: '', tagsStr: '', categories: [], canSubmit: true, submitting: true,
      exhibitTag: { show: true, title: '雨后林下的一只锹甲', date: '2026.10.18' } },
    css: '.ui-pop-mask.ui-pop-mask.is-center { display: flex !important; } .exhibit-tag, .ex-seal { animation: none !important; }' },
  { name: 'care-days', h: 900, wxml: 'subpackages/feature/care/my/index', data: { loading: false, loadError: false,
      specimens: [
        { key: 'k1', title: '光明女神闪蝶 · 玻璃罩', image: P[0], categoryLabel: '蝶类', categoryOverline: 'LEPIDOPTERA', receiveTimeText: '2026.07.11', companionDays: 100, careSummary: '避光、防潮，每季检查一次干燥剂' },
        { key: 'k2', title: '银杏押花框', image: P[2], categoryLabel: '植物', categoryOverline: 'PLANTAE', receiveTimeText: '2026.10.03', companionDays: 16, careSummary: '远离直射光' }] } },
  // 2026-10-18 产品点名：详情页「实拍影像」区块（视频号跳转卡片 + B站 / 抖音复制链接卡；channel-video 内嵌在预览里不渲染）
  { name: 'detail-films', h: 3000, wxml: 'subpackages/feature/detail/index', base: 'detail', data: {
      heroVideoCount: 1, filmLead: true,
      externalVideos: [
        { key: 'ev0', platform: 'channels', label: '视频号', title: '光明女神闪蝶 · 展翅实拍', feedId: 'f0', finderUserName: 'sphShanhai', embed: true, lead: true, sameSubject: true },
        { key: 'evA', platform: 'channels', label: '视频号', title: '玻璃罩装裱过程', feedId: 'f1', finderUserName: 'sphOther', embed: false },
        { key: 'ev1', platform: 'bilibili', label: '哔哩哔哩', title: '玻璃罩里的蓝 · 360° 环拍', url: 'https://b23.tv/x', bvid: 'BV1xx411c7mD', embed: false },
        ] },
    css: '.film-channel { background: linear-gradient(160deg, #2a2620, #12100d); }' },
  // 2026-10-18 方向池 ★★★：拆信 / 火漆 / 续播 / 标本旅程 + 入藏卡（🔒 点名）/ 请假天数 / 报销核准
  { name: 'messages-env', h: 1300, wxml: 'subpackages/extra/user/messages/index', base: 'messages', data: {
      messages: [
        { _id: 'm1', dayLabel: '今天', kind: 'receipt', typeName: '发货通知', statusLabel: '待签收', title: '你的藏品已启程', preview: '光明女神闪蝶 · 玻璃罩 已由顺丰发出。', formattedTime: '10:24', isUnread: true, kindLabel: '订单', senderName: '山海造物', isPaper: true },
        { _id: 'm3', dayLabel: '10 月 12 日', kind: 'campaign', typeName: '馆方来信', statusLabel: '已读', title: '十月新到：南美闪蝶专题', preview: '本周馆藏上新 12 件。', formattedTime: '10.12', isUnread: false, kindLabel: '馆方', senderName: '山海造物', isPaper: true }] } },
  { name: 'letter-sealed', h: 1000, wxml: 'subpackages/extra/user/messages/detail/index', data: {
      entered: true, unsealing: 'sealed', scrollStyle: '', digestView: null,
      selectedMessage: { _id: 'm1', kind: 'receipt', stampCn: '回执', stampEn: 'RECEIPT', kindLabel: '订单', statusLabel: '待签收', senderName: '山海造物', title: '你的藏品已启程', formattedTime: '10:24', typeName: '发货通知', bodyBlocks: [], summaries: [] } },
    // 详情页根节点 height:100% 靠真机视口撑开，离线预览没有视口高度 → 放开裁切（预览专用，真机不受影响）
    css: 'page, .page-msg.detail-root { height: auto !important; overflow: visible !important; } .paper-mode.letter-page.standalone { position: relative !important; overflow: visible !important; } .standalone .letter-scroll { height: auto !important; }' },
  { name: 'cert-sealed', h: 900, wxml: 'subpackages/extra/user/certificates/index', base: 'certificates', data: {
      visible: [
        { _id: 'c1', displayTitle: '光明女神闪蝶', displayImage: P[0], dateStr: '2026.10.18', kind: 'holder', kindLabel: '', sealed: true },
        { _id: 'c3', displayTitle: '银杏押花框', displayImage: P[2], dateStr: '2026.09.03', kind: 'gift_holder', kindLabel: '受赠' }] } },
  { name: 'videos-resume', h: 1000, wxml: 'subpackages/content/videos/index', data: {
      categories: [{ name: '全部', value: 'all' }, { name: '制作过程', value: 'craft' }], activeCategory: 'all', loading: false, noMore: false, fallbackCover: P[0],
      videos: [
        { _id: 'v1', title: '一只闪蝶的展翅', coverImage: P[0], typeLabel: '制作过程', duration: '08:12', playCount: 320, stats: { likes: 41 }, resumeLabel: '看到 02:14', resumePct: 27 },
        { _id: 'v2', title: '玻璃罩里的光', coverImage: P[1], typeLabel: '标本展示', duration: '03:40', playCount: 118, stats: { likes: 12 }, resumeLabel: '', resumePct: 0 }] } },
  { name: 'order-journey', h: 1500, wxml: 'subpackages/business/order-detail/index', base: 'order-detail', data: {
      journey: [
        { key: 'order', cn: '入册', en: 'LOGGED', sub: '订单建档', time: '10.12 20:41', state: 'done' },
        { key: 'ship', cn: '启程', en: 'DEPARTED', sub: '交 顺丰速运 承运', time: '10.13 09:05', state: 'done' },
        { key: 'transit', cn: '在途', en: 'IN TRANSIT', sub: '途经站点以承运商轨迹为准', time: '', state: 'now' },
        { key: 'arrive', cn: '抵达', en: 'ARRIVED', sub: '待你签收', time: '', state: 'todo' }] },
    css: '.sj-step.is-now .sj-dot { animation: none !important; }' },
  { name: 'order-archive-card', h: 1500, wxml: 'subpackages/business/order-detail/index', base: 'order-journey', data: {
      journey: [
        { key: 'order', cn: '入册', en: 'LOGGED', sub: '订单建档', time: '10.12 20:41', state: 'done' },
        { key: 'ship', cn: '启程', en: 'DEPARTED', sub: '交 顺丰速运 承运', time: '10.13 09:05', state: 'done' },
        { key: 'transit', cn: '在途', en: 'IN TRANSIT', sub: '一路平安', time: '', state: 'done' },
        { key: 'arrive', cn: '抵达', en: 'ARRIVED', sub: '已签收入藏', time: '10.15 14:20', state: 'done' }],
      archiveCard: { show: true, title: '光明女神闪蝶 · 玻璃罩', date: '2026.10.15', points: 126 } },
    css: '.ui-pop-mask.ui-pop-mask.is-center { display: flex !important; }' },
  { name: 'leave-span', h: 1300, wxml: 'subpackages/extra/staff/leave/index', data: {
      ready: true, storeNames: ['山海造物主店'], storeIndex: 0, storeName: '山海造物主店', leaveTypeLabels: ['事假'], leaveTypeIndex: 0,
      form: { startDate: '2026-10-16', startTime: '09:00', endDate: '2026-10-18', endTime: '13:00', reason: '' }, list: [],
      span: { days: 2.5, label: '共 2.5 天', rangeText: '10.16 – 10.18 · 跨 3 个日历日', more: 0,
        cells: [{ key: 'a', dow: '五', day: 16, fill: 'full', weekend: false }, { key: 'b', dow: '六', day: 17, fill: 'full', weekend: true }, { key: 'c', dow: '日', day: 18, fill: 'half', weekend: true }] } } },
  { name: 'reimb-ledger', h: 1500, wxml: 'subpackages/extra/staff/reimbursements/index', data: {
      ready: true, storeNames: ['山海造物主店'], storeIndex: 0, storeName: '山海造物主店', categories: ['物料'], categoryIndex: 0, form: { amount: '', remark: '' }, images: [],
      summary: { month: 10, count: 3, approvedText: '1,200.50', pendingText: '80.00', hasPending: true },
      list: [
        { _id: 'r1', category: '物料', amountText: '1,200.50', status: 'approved', statusLabel: '已通过', timeText: '10.03 14:20', remark: '展柜射灯', stamped: true },
        { _id: 'r2', category: '交通', amountText: '80.00', status: 'pending', statusLabel: '待审核', timeText: '10.09 18:02', remark: '取件打车' },
        { _id: 'r3', category: '其他', amountText: '36.00', status: 'rejected', statusLabel: '已驳回', timeText: '10.10 11:30', reviewNote: '请附小票' }] } },
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
        steps: [{ label: '支付完成', state: 'done' }, { label: '备妥待取', state: 'done' }, { label: '到店领取', state: 'done' }] } } },
  // 柜台当场核销：「已自提」印落下途中（定格在放大回落的一帧）
  { name: 'pickup-claim-live', h: 1100, wxml: 'subpackages/business/pickup-pass/index', base: 'pickup-done', data: { claimLive: true },
    css: '.pass-qr-frame.is-live .pass-qr-stamp { animation: none !important; transform: translate(-50%, -50%) rotate(-14deg) scale(1.3) !important; opacity: 0.7; }' },
  // 2026-10-17 标本定制「定制工坊」（第 1 / 2 / 5 步）
  { name: 'custom', h: 2200, wxml: 'subpackages/feature/custom/index', data: { loading: false, navPaddingRight: 32, headerHeight: 150, estimatedDays: 7, currentStep: 1,
      steps: [['藏品'], ['装裱'], ['包装'], ['赠礼'], ['确认']].map(([label], i) => ({ id: i + 1, label })),
      currentStepMeta: { title: '选藏品', desc: '从馆藏中挑选可定制藏品，每件配有物种信息' },
      drafts: [{ _id: 'd1', title: '送给阿遥的生日框', specimenTitle: '光明女神闪蝶' }], searchKeyword: '', activeCategory: '',
      categoryPills: [{ id: '', label: '全部' }, { id: 'butterfly', label: '蝴蝶' }, { id: 'beetle', label: '甲虫' }, { id: 'plant', label: '植物' }],
      products: [1, 2, 3, 4], selectedProduct: { _id: 'p1', title: '光明女神闪蝶', latinName: 'Morpho helena', images: [P[0]] },
      filteredProducts: [{ _id: 'p1', title: '光明女神闪蝶', latinName: 'Morpho helena', price: 680, images: [P[0]] }, { _id: 'p2', title: '血漪蝶', latinName: 'Cethosia biblis', price: 420, images: [P[1]] },
        { _id: 'p3', title: '蓝闪蝶木框', latinName: 'Morpho peleides', price: 560, images: [P[2]] }, { _id: 'p4', title: '蝶植组合框', latinName: '', price: 880, images: [P[5]] }],
      selectedFrameName: '胡桃木 · 浅框', totalPreview: 868, dimensionOptions: [{ name: '规格', values: [{ value: '20×25' }, { value: '30×40' }, { value: '40×50', disabled: true }] }], selectedSpecs: { 规格: '20×25' },
      frames: [{ id: 'f1', name: '胡桃木 · 浅框', desc: '温润木纹，适合单只标本', priceDelta: 0 }, { id: 'f2', name: '黄铜 · 博物框', desc: '金属细边，博物馆陈列感', priceDelta: 188 }], selectedFrameId: 'f1',
      framers: [{ id: 'm1', name: '门店标本师', type: 'store', priceDelta: 0, extraDays: 0 }, { id: 'm2', name: '林师傅', type: 'partner', bio: '十二年鳞翅目装裱', priceDelta: 120, extraDays: 3 }], selectedFramerId: 'm1',
      previewLines: [{ label: '藏品', value: '光明女神闪蝶' }, { label: '学名', value: 'Morpho helena', latin: true }, { label: '框型', value: '胡桃木 · 浅框' }, { label: '规格', value: '20×25' }, { label: '包装', value: '礼盒包装' }, { label: '祝福卡', value: '生日快乐，愿你一直闪闪发光' }],
      unitPrice: 680, customExtraPrice: 188, displayEstimatedDays: 7 } },
  { name: 'custom-2', h: 2000, wxml: 'subpackages/feature/custom/index', base: 'custom', data: { currentStep: 2, currentStepMeta: { title: '选装裱', desc: '框型、规格与标本师，决定装裱气质与交期' } } },
  { name: 'custom-5', h: 2400, wxml: 'subpackages/feature/custom/index', base: 'custom', data: { currentStep: 5, currentStepMeta: { title: '定制预览', desc: '核对方案与预估价格，满意后下单制作' } } },
  // 2026-10-17 联系专员「专员服务台」
  { name: 'support', h: 3000, wxml: 'subpackages/extra/user/support/index', data: { loading: false, navPaddingRight: 32, headerHeight: 64, scrollTop: 64,
      contextCard: { visible: false }, contextSummary: '', hasConsultContext: false, sessionFrom: '', showMessageCard: false,
      config: { hours: '每日 10:00 – 22:00', responseHint: '工作时间内约 10 分钟回复；夜间留言次日处理', phone: '185 1911 0274', address: '吉林省长春市朝阳区红旗街 959 号这有山商场山坡 X-06-1', communityQr: '' },
      topics: [{ id: 'order', label: '订单与物流', desc: '发货、签收、改地址' }, { id: 'aftersale', label: '售后与退换', desc: '破损、退款、换货' }, { id: 'custom', label: '定制咨询', desc: '框型、交期、报价' }, { id: 'care', label: '标本养护', desc: '防潮、清洁、摆放' }], activeTopic: 'custom',
      messageText: '', contactPhone: '', ticketImages: [], maxTicketImages: 3, ticketImgFailed: 0, ticketImgBusy: false, submitting: false,
      faqs: [{ q: '标本可以退换吗？', a: '未拆封且签收 7 日内可申请；定制藏品按确认方案制作，不接受退款。' }, { q: '多久可以发货？', a: '现货 48 小时内发出；定制按方案页交期。' }, { q: '门店可以自取吗？', a: '下单时选择门店自取，备妥后凭自取码到店领取。' }], expandedFaq: 0, showCommunity: false } },
  // 2026-10-18 搜索「检索台」（空闲 / 结果）
  { name: 'search', h: 1500, wxml: 'subpackages/feature/search/index', data: { headerHeight: 64, keyword: '', inputFocused: false, isSearching: false, showAiIdentify: true, scopeCategoryName: '', showSpecimenArchive: true,
      hotKeys: ['闪蝶', '鹦鹉螺', '紫水晶', '蝴蝶标本框', '押花', '甲虫'], loadingHotKeys: false, historyList: [{ keyword: '光明女神闪蝶' }, { keyword: 'Morpho' }, { keyword: '玻璃罩' }],
      showSuggestions: false, suggestions: [], filterTabs: [], displayList: [], relatedList: [], relatedTerms: [] } },
  { name: 'search-result', h: 1900, wxml: 'subpackages/feature/search/index', base: 'search', data: { keyword: '闪蝶', isSearching: true, loading: false, loadError: false, resultMode: 'all', resultTotal: 3,
      filterTabs: [{ id: 'all', label: '全部', count: 3 }, { id: 'product', label: '藏品', count: 2 }, { id: 'archive', label: '档案', count: 1 }, { id: 'activity', label: '活动', count: 0 }],
      displayList: [{ resultKey: 'a', _id: 'p1', type: 'product', title: '光明女神闪蝶 · A1 博物级', subTitle: 'Morpho helena', image: P[0], tag: '藏品', priceText: '1,280', matchStrong: true, displayTags: ['闪蝶', '南美'], craftTags: [{ key: 'k1', label: '玻璃罩' }] },
        { resultKey: 'b', _id: 'p2', type: 'product', title: '蓝闪蝶木框', subTitle: 'Morpho peleides', image: P[2], tag: '藏品', priceText: '560', displayTags: ['闪蝶'] },
        { resultKey: 'c', _id: 'w1', type: 'wiki', title: '闪蝶科 · 结构色', subTitle: 'Morphinae', image: P[4], tag: '档案' }],
      resultList: [1, 2, 3], relatedLoading: false, relatedList: [{ resultKey: 'r1', _id: 'p5', type: 'product', title: '血漪蝶穹顶', subTitle: 'Cethosia biblis', image: P[1], priceText: '680' }] } },
  // 2026-10-18 主播工作台（员工端，点名重构）
  { name: 'live-studio', h: 3400, wxml: 'subpackages/extra/live/studio/index', data: { ready: true, greeting: '晚上好，阿遥', isPreview: false, modeLabel: '主播', showOnAir: true,
      roleHint: '开播、挂品与讲解在本台；全店配置走超管工作台。', tipText: '', flowHot1: false, flowHot2: false, flowHot3: true, liveDashLoading: false, loadError: '',
      nextStepTitle: '正在直播：留意讲解中藏品', nextStepBody: '已挂 3 件，当前讲解「光明女神闪蝶」。下播前记得结束本场，场次数据才会归档。', nextStepCta: '去开播控制台',
      adminHint: '', otherLiveHint: '',
      statusCard: { statusTone: 'live', statusLabel: '直播中', statusLightClass: 'live blink', title: '秋夜观蝶 · 闪蝶专场', viewerCount: 128, likeCount: 2316, messageCount: 87, shelfCount: 3, peakViewers: 164, joinCount: 412, reminderCount: 58, startLabel: '19:30' },
      configured: true, enabled: true, configLightClass: 'on', enabledLightClass: 'on', canYouxin: true, canAttendance: true, canPayslip: true,
      mineSessionId: 's1', shelfPreview: [{ _id: 'x1', title: '光明女神闪蝶 · A1', priceLabel: '¥1,280', spotlight: true, canMoveUp: false, canMoveDown: true }, { _id: 'x2', title: '蓝闪蝶木框', priceLabel: '¥560', canMoveUp: true, canMoveDown: true, warnText: '库存仅 1 件' }],
      talkSegments: [{ key: 'k0', heading: '开场', body: '欢迎来到山海造物的秋夜观蝶专场……' }, { key: 'k1', heading: '01 · 光明女神闪蝶', body: '结构色不是颜料，是翅鳞的纳米结构在反射光。', spotlight: true }],
      noticeSessionId: 's1', noticeDraft: '今晚 21:00 前下单送标本小卡',
      recentSessions: [{ _id: 's0', title: '鞘翅目夜话', hostName: '阿遥', timeHint: '10.12 · 1 小时 20 分', statusText: '已结束', chipClass: 'chip-ended', status: 'ended', summary: '峰值 96 · 成交 4 单' }],
      primaryCtaLabel: '去开播控制台', creating: false, canEndSession: true, ending: false } },
  // 2026-10-18 标本师工作台（员工端，点名重构）
  { name: 'artisan', h: 2900, wxml: 'subpackages/extra/artisan/index', data: { ready: true, artisanDisplayName: '林师傅', canProducts: true, canWorks: true, canConcept: true, canPetOrders: true, canProfile: true, canAttendance: true, canPayslip: true,
      statsLoading: false, workPendingShelf: 2, jobPendingMake: 3, jobPendingShip: 0, jobInProgress: 1, depositTodo: 1, todoTotal: 7,
      todoLamps: { pending: 'warn', make: 'warn', ship: 'lamp-muted', framing: 'lamp-info', deposit: 'warn', display: 'lamp-forest' }, petOrderLamp: 'warn', petOrderTodo: 1,
      depositPreview: [{ _id: 'd1', title: '蝶翅画 · 秋林', previewMeta: '待确认收款', depositAmount: 300, productId: 'p1' }],
      jobPreview: [{ _id: 'j1', specimenTitle: '光明女神闪蝶 · 胡桃木浅框', orderNo: 'CU20261016008', productionLabel: '待制作', productionStatus: 'pending_make' }],
      workTotal: 46, workOnShelf: 38, commissionLoaded: true, commissionNet: '1,860' } },
  // 2026-10-18 标本师子页（员工端，点名）
  { name: 'artisan-commission', h: 1300, wxml: 'subpackages/extra/artisan/commission/index', data: { ready: true, loading: false, enabled: true, ratePercent: 12, ruleText: '关联藏品售出后按 12% 计入，退款自动冲正',
      summary: { netAmount: '1,860.00', earnAmount: '2,016.00', reverseAmount: '156.00', salesAmount: '16,800.00' },
      list: [{ _id: 'l1', type: 'earn', typeLabel: '入账', amountAbs: '153.60', productTitle: '蝶翅画 · 秋林', salesAmount: '1,280', ratePercent: 12, orderNo: 'SH20261016021', createTimeText: '10.16 20:14' },
        { _id: 'l2', type: 'reverse', typeLabel: '冲正', amountAbs: '67.20', productTitle: '蝶翅书签 · 晨雾', salesAmount: '560', ratePercent: 12, orderNo: 'SH20261012007', createTimeText: '10.12 11:02' }] } },
  { name: 'artisan-pet', h: 1300, wxml: 'subpackages/extra/artisan/pet/index', data: { ready: true, loading: false, pendingCount: 1,
      list: [{ _id: 'p1', orderNo: 'PM20261017003', accepted: false, petTitle: '团子 · 英短', craftName: '仿生标本', intakeText: '10.20 到店交接', contactText: '林女士 · 138****2201', contactPhone: '13800002201' },
        { _id: 'p2', orderNo: 'PM20261002011', accepted: true, statusLabel: '制作中', petTitle: '豆豆 · 柯基', craftName: '骨骼标本', quoteText: '¥3,800', acceptedAt: '10.03 09:20' }] } },
  { name: 'artisan-works', h: 1500, wxml: 'subpackages/extra/artisan/works/index', data: { ready: true, pageMode: 'works', pageTitle: '作品库', pageSub: '封面、状态与上下架；申请上架后由店长审核', selectMode: false, loading: false, loadError: false, hasProfile: true, canProfile: true,
      shelfFilter: 'all', filterCounts: { all: 46, on: 38, pending: 2, rejected: 1, off: 5 }, listAll: [1],
      list: [{ _id: 'w1', title: '光明女神闪蝶 · A1', latinName: 'Morpho helena', coverImage: P[0], shelfKey: 'on', shelfLabel: '已上架', priceText: '1,280' }, { _id: 'w2', title: '蝶翅画 · 秋林', latinName: '', coverImage: P[4], shelfKey: 'pending', shelfLabel: '待确认', priceText: '980' }, { _id: 'w3', title: '血漪蝶穹顶', latinName: 'Cethosia biblis', coverImage: P[1], shelfKey: 'rejected', shelfLabel: '已驳回', priceText: '680' }] } },
  { name: 'artisan-concept', h: 2400, wxml: 'subpackages/extra/artisan/concept/index', data: { ready: true, generating: false, progressPct: 0, statusText: '', lastError: '', notesOpen: false, notes: '', historyOpen: false, history: [], batchResults: [],
      productTypes: [{ id: 't1', name: '蝶翅画', priceRange: '¥680–2,800' }, { id: 't2', name: '玻璃罩', priceRange: '¥268–1,280' }, { id: 't3', name: '木框标本', priceRange: '¥380–1,600' }], typeScrollInto: '',
      categoryOptions: [{ label: '鳞翅目' }], categoryIndex: 0, audienceOptions: [{ label: '礼赠' }], audienceIndex: 0, channelOptions: [{ label: '门店' }], channelIndex: 0, innovationOptions: [{ label: '中' }], innovationIndex: 0, examples: ['秋林', '晨雾', '星河'],
      concept: { name: '蝶翅画 · 秋林晚照', position: '礼赠主力款', price: '¥1,280', margin: '毛利约 58%', filterTags: ['礼赠', '鳞翅目', '暖色'], sellingPoints: ['真蝶翅拼贴，每幅纹样唯一', '胡桃木浅框，适合书房与玄关'], targetAudience: '30–45 岁礼赠客群', strategy: '秋季主推，门店陈列在入口第二柜', materials: ['蝶翅 · 枯叶蛱蝶', '胡桃木框'], hasRisks: true, risks: ['蝶翅来源需随附检疫证明'], hasNextActions: true, nextActions: ['打样 2 幅给店长确认'], hasChannels: true, channels: ['门店', '小程序'] } } },
  // 2026-10-18 采购商工作台（员工 / 合作方端，点名）
  { name: 'supplier-desk', h: 1700, wxml: 'subpackages/extra/supplier/index', data: { ready: true, staffName: '长白山店 · 王店长', isPreview: false, modeLabel: '采购商', demoOn: false, roleHint: '向总部采购价目内藏品；下单后在「我的采购单」支付与跟进。', features: null, cartCount: 2,
      buyerModules: [{ key: 'catalog', title: '价目选购', desc: '按总部价目挑选，可加入采购车', icon: '/assets/icons/tab-collection.png' }, { key: 'buyer-cart', title: '采购车', desc: '确认数量与收货信息后下单', icon: '/assets/icons/cart.png', badge: 2 }, { key: 'buyer-orders', title: '我的采购单', desc: '待支付 1 · 已发货 3', icon: '/assets/icons/order.png' }],
      showSupplierSection: true, supplierOpen: true, visibleSupplierModules: [{ key: 'orders', title: '供货需求', desc: '总部发给供货方的需求单', icon: '/assets/icons/order.png' }, { key: 'ship', title: '发货登记', desc: '填写物流单号', icon: '/assets/icons/gift.png' }], isBuyer: true } },
  // 2026-10-18 采购商子页（价目选购 / 采购车 / 我的采购单）
  { name: 'buyer-catalog', h: 1500, wxml: 'subpackages/extra/supplier/catalog/index', data: { ready: true, loading: false, loadError: false, isPreview: false, cartCount: 3, flash: '已加入采购车 · 光明女神闪蝶 × 2', flashKind: 'ok', staffName: '王店长',
      items: [{ name: '光明女神闪蝶 · A1 博物级', priceText: '¥680', packText: '1 只 / 盒', meta: '起订 2 · 现货', thumbUrl: P[0], orderable: true, qty: 2, inCart: 2, addLabel: '已在采购车' },
        { name: '蓝闪蝶木框', priceText: '¥320', packText: '1 框 / 箱', meta: '起订 1 · 7 天发货', thumbUrl: P[2], orderable: true, qty: 1, inCart: 0, addLabel: '加入采购车' },
        { name: '蝶植组合框', priceText: '¥460', packText: '1 框 / 箱', meta: '本季未开放订货', thumbUrl: P[5], orderable: false, qty: 1, inCart: 0, addLabel: '暂不可订' }] } },
  { name: 'buyer-cart', h: 1900, wxml: 'subpackages/extra/supplier/buyer-cart/index', data: { ready: true, isPreview: false, banner: '', bannerKind: '', itemCount: 3, totalText: '¥1,680', company: '长白山店', contactName: '王店长', contactPhone: '138 0000 2201', shipToAddress: '吉林省白山市长白山景区游客中心 B 座 12 号', note: '',
      items: [{ skuId: 'a', name: '光明女神闪蝶 · A1 博物级', packText: '1 只 / 盒', unitText: '¥680 / 盒', quantity: 2, lineTotalText: '¥1,360', thumbUrl: P[0] }, { skuId: 'b', name: '蓝闪蝶木框', packText: '1 框 / 箱', unitText: '¥320 / 箱', quantity: 1, lineTotalText: '¥320', thumbUrl: P[2] }] } },
  { name: 'buyer-orders', h: 1900, wxml: 'subpackages/extra/supplier/buyer-orders/index', data: { ready: true, loadError: false, isPreview: false, unpaidCount: 1, cartCount: 0, banner: '', bannerKind: '',
      filters: [{ key: 'all', label: '全部', on: true }, { key: 'unpaid', label: '待支付' }, { key: 'shipping', label: '已发货' }, { key: 'done', label: '已完成' }],
      list: [{ id: 'o1', orderNo: 'PO20261018002', payTone: 'warn', paymentText: '待支付', itemsBrief: '光明女神闪蝶 × 2 · 蓝闪蝶木框 × 1', fulfillText: '待支付后备货', nextStep: '下一步：完成微信支付，总部当日备货', amountText: '¥1,680', timeText: '10.18 10:24', canPay: true, canAct: true },
        { id: 'o2', orderNo: 'PO20261009011', payTone: 'ok', paymentText: '已支付', itemsBrief: '血漪蝶穹顶 × 4', fulfillText: '已发货 · 顺丰 SF1234567890', nextStep: '', amountText: '¥2,720', timeText: '10.09 16:02', canPay: false, canAct: true }] } },
  // 2026-10-18 股东观测台（只读看板，点名「逐个工作台优化」）
  { name: 'shareholder', h: 2100, wxml: 'subpackages/extra/shareholder/index', data: { ready: true, entered: true, staffName: '李董', loading: false, legendOpen: true, numPulse: false,
      profile: { storeName: '山川造物 · 主店', ownershipRatio: 20, dividendRatioBeforePayback: 30, dividendRatioAfterPayback: 20, capitalContributionFmt: '400,000', effectiveDate: '2026-03-01' },
      rangeTabs: [{ key: 'month', label: '按月' }, { key: 'quarter', label: '本季' }, { key: 'year', label: '本年' }, { key: 'all', label: '累计' }], rangeKey: 'month', rangeType: 'month', rangeLabel: '10 月',
      monthKey: '2026-10', monthCurrent: '2026-10', monthPrev: '2026-09', monthLabel: '2026-10', monthMax: '2026-10',
      verdict: { className: 'blink', tone: 'up', title: '经营向好 · 回本提速', label: '正常', insight: '本月营收环比 +18%，毛利率回到 52%；按当前节奏预计 2027 年 3 月个人回本。', updatedAt: '10.18 09:20' },
      signalBoard: { summary: { ok: 3, warn: 1, danger: 0 }, rulesNote: '阈值按近 3 月均值 ±15% 判定', items: [
        { id: 's1', name: '营收', value: '¥186,400', tone: 'up', status: 'ok', lampClass: 'blink', statusLabel: '向好', target: 'revenue' },
        { id: 's2', name: '毛利率', value: '52%', tone: 'up', status: 'ok', lampClass: 'blink', statusLabel: '正常', target: 'profit' },
        { id: 's3', name: '商场扣点', value: '¥9,320', tone: 'flat', status: 'warn', lampClass: 'warn', statusLabel: '需关注', reason: '已过保底线 82%', target: 'mall' },
        { id: 's4', name: '回本进度', value: '41%', tone: 'up', status: 'ok', lampClass: 'blink', statusLabel: '正常', target: 'equity' }] },
      equity: { statusTone: 'brass', statusLabel: '回本前', personalDividendFmt: '163,200', personalRoiPct: 41, personalRoiBar: 'width:41%', poolRoiPct: 38, poolRoiBar: 'width:38%' } } },
  // 2026-10-18 投资观测台（只读看板，「逐个工作台优化」）
  { name: 'investor', h: 2000, wxml: 'subpackages/extra/investor/index', data: { ready: true, entered: true, staffName: '周总', loading: false, legendOpen: false, numPulse: false, canFinance: true, canAnalytics: true,
      rangeTabs: [{ key: 'today', label: '今日' }, { key: 'month', label: '按月' }, { key: 'quarter', label: '本季' }, { key: 'all', label: '累计' }], rangeKey: 'month', rangeType: 'month', rangeLabel: '10 月',
      monthKey: '2026-10', monthCurrent: '2026-10', monthPrev: '2026-09', monthLabel: '2026-10', monthMax: '2026-10',
      verdict: { className: 'blink', tone: 'up', title: '营收稳步上行', label: '正常', insight: '两店合计 GMV 环比 +12%，线上占比升至 34%；退款率 1.8% 在阈值内。', updatedAt: '10.18 09:20' },
      signalBoard: { summary: { ok: 4, warn: 1, danger: 0 }, rulesNote: '阈值按近 3 月均值 ±15% 判定', items: [
        { id: 'i1', name: 'GMV', value: '¥312,800', tone: 'up', status: 'ok', lampClass: 'blink', statusLabel: '向好' },
        { id: 'i2', name: '客单价', value: '¥486', tone: 'flat', status: 'ok', lampClass: 'blink', statusLabel: '正常' },
        { id: 'i3', name: '退款率', value: '1.8%', tone: 'flat', status: 'ok', lampClass: 'blink', statusLabel: '正常' },
        { id: 'i4', name: '新客', value: '214', tone: 'down', status: 'warn', lampClass: 'warn', statusLabel: '需关注', reason: '环比 -16%' }] },
      headline: { grandFmt: '312,800', gmvPaidFmt: '206,400', offlineFmt: '106,400', netOnlineFmt: '201,300', refundFmt: '5,100', paidOrders: 644, aovFmt: '486', newUsers: 214 },
      ledgerByStore: [{ storeId: 's1', name: '山川造物 · 主店', pct: 68, barStyle: 'width:68%', valFmt: '¥212,700' }, { storeId: 's2', name: '星宸标本 · 工坊', pct: 32, barStyle: 'width:32%', valFmt: '¥100,100' }] } }
]

async function shoot(s) {
  const missing = new Set()
  let wxml = inlineTemplates(read(join(MP, s.wxml + '.wxml')))
    .replace(/<wxs[^>]*\/>/g, '').replace(/<wxs\b[^>]*>[\s\S]*?<\/wxs>/g, '')
    .replace(/<checkbox-group\b/g, '<view').replace(/<\/checkbox-group>/g, '</view>').replace(/<checkbox\b[^>]*?\/>/g, '<view class="__cb"></view>').replace(/<checkbox\b([^>]*)>[\s\S]*?<\/checkbox>/g, '<view class="__cb"></view>')
    // picker → view 时保留条件链（picker 上的 wx:if 丢了，后面的 wx:else 会悬空）
    .replace(/<picker\b([^>]*)>/g, (_, attrs) => `<view${(attrs.match(/\swx:(?:if|elif)="[^"]*"|\swx:else\b/) || [''])[0]}>`).replace(/<\/picker>/g, '</view>')
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
${s.css ? '/* 场景专属：如需出图某个弹层 */\n' + s.css : ''}
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
