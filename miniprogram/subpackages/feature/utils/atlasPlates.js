/**
 * 山海图鉴 · 刻版线描图版（2026-10-17 图鉴重设计）
 *
 * 为什么有它：图鉴目录没有任何实拍图（manageAtlas 不下发图片），旧卡面只有一行「SPECIMEN」字样 ——
 * 一本没有图的图鉴。这里给每一页配一张**博物志式刻版线描**（铜版画口吻：单色描线 + 少量排线），
 * 按物种形态分九种版：闪蝶（圆翅）/ 凤蝶（尾突）/ 蛱蝶（折角）/ 银杏 / 莲 / 鹦鹉螺 / 唐冠螺 / 水晶簇 / 萤石。
 *
 * 只给**已点亮**的页用（未点亮只露编号，不剧透形态）。微信 <image> 不渲染 .svg 文件，故用 data URI。
 * 物种 → 版式的映射只在本地（不改云端契约）；新物种没登记时按门类回落。
 */

const INK = '#5A4426'

const MIRROR = 'transform="matrix(-1 0 0 1 120 0)"'

/** 左半翅 + 同一组路径镜像出右半 —— 蝴蝶三版共用 */
function butterfly(left, extra) {
  return `<g>${left}</g><g ${MIRROR}>${left}</g>` +
    '<path d="M60 40 C58.5 50 58.5 72 60 86 C61.5 72 61.5 50 60 40 Z" fill="' + INK + '" stroke="none"/>' +
    '<path d="M59.4 41 C56 32 52 26 47 21 M60.6 41 C64 32 68 26 73 21"/>' +
    '<circle cx="47" cy="21" r="1.6" fill="' + INK + '"/><circle cx="73" cy="21" r="1.6" fill="' + INK + '"/>' +
    (extra || '')
}

const SHAPES = {
  // 闪蝶 / 斑蝶 / 灰蝶：圆阔前翅 + 圆后翅，翅脉放射
  morpho: butterfly(
    '<path d="M58 46 C44 30 20 25 12 36 C6 46 22 60 58 58 Z"/>' +
    '<path d="M58 61 C38 62 20 72 25 88 C30 100 50 92 58 72 Z"/>' +
    '<path d="M57 50 L20 36 M57 54 L16 47 M56 57 L26 56 M57 65 L28 80 M57 68 L40 90" stroke-width="0.8"/>' +
    '<path d="M16 41 L22 39 M15 45 L21 43 M17 49 L23 47" stroke-width="0.7"/>'
  ),
  // 凤蝶：尖前翅 + 带尾突的后翅，外缘一列斑点
  swallowtail: butterfly(
    '<path d="M58 47 C46 32 24 20 9 23 C12 40 30 55 58 58 Z"/>' +
    '<path d="M58 61 C42 62 30 71 31 82 C32 90 38 92 40 106 C45 97 45 91 49 87 C55 81 58 72 58 64 Z"/>' +
    '<path d="M57 51 L16 27 M57 54 L20 38 M56 57 L30 50 M57 66 L36 82" stroke-width="0.8"/>' +
    '<circle cx="35" cy="84" r="1.6"/><circle cx="42" cy="88" r="1.4"/><circle cx="49" cy="83" r="1.2"/>'
  ),
  // 蛱蝶：前翅镰形折角 + 后翅波状外缘（枯叶蛱蝶的叶形也在这一版）
  nymphalid: butterfly(
    '<path d="M58 47 L42 29 L15 27 L19 37 L11 44 L30 57 L58 58 Z"/>' +
    '<path d="M58 61 L36 62 L23 73 L28 79 L25 87 L35 91 L44 86 L50 89 L58 72 Z"/>' +
    '<path d="M57 52 L18 33 M57 55 L22 45 M57 66 L32 81 M57 69 L44 85" stroke-width="0.8"/>' +
    '<path d="M24 50 L29 46 M28 53 L33 49 M32 56 L37 52" stroke-width="0.7"/>'
  ),
  // 银杏：扇叶 + 中缺 + 放射叶脉 + 叶柄
  ginkgo:
    '<path d="M60 70 C40 67 22 53 20 33 C33 24 50 23 56 30 L60 44 L64 30 C70 23 87 24 100 33 C98 53 80 67 60 70 Z"/>' +
    '<path d="M60 70 L60 104"/>' +
    '<path d="M60 70 L26 36 M60 70 L34 30 M60 70 L46 27 M60 70 L56 32 M60 70 L64 32 M60 70 L74 27 M60 70 L86 30 M60 70 L94 36 M60 70 L30 46 M60 70 L90 46" stroke-width="0.7"/>',
  // 莲：中瓣 + 两层侧瓣 + 托
  lotus:
    '<path d="M60 26 C51 42 51 64 60 80 C69 64 69 42 60 26 Z"/>' +
    '<path d="M60 80 C45 74 35 58 36 40 C47 46 56 60 60 80 Z"/>' +
    '<path d="M60 80 C75 74 85 58 84 40 C73 46 64 60 60 80 Z"/>' +
    '<path d="M60 82 C42 82 25 72 18 58 C33 58 48 66 60 82 Z"/>' +
    '<path d="M60 82 C78 82 95 72 102 58 C87 58 72 66 60 82 Z"/>' +
    '<path d="M38 88 Q60 96 82 88 M60 88 L60 104"/>' +
    '<path d="M60 34 L60 74 M44 52 L54 70 M76 52 L66 70" stroke-width="0.7"/>',
  // 鹦鹉螺：对数螺线外壳 + 隔壁（几何由螺线方程生成）
  nautilus:
    '<path d="M68.6 61.9 L68.4 62.4 L68.3 62.9 L68.0 63.4 L67.7 63.8 L67.4 64.3 L67.0 64.7 L66.6 65.1 L66.1 65.4 L65.6 65.7 L65.0 65.9 L64.4 66.1 L63.8 66.2 L63.2 66.3 L62.5 66.3 L61.9 66.2 L61.2 66.1 L60.5 65.9 L59.9 65.6 L59.3 65.3 L58.6 64.9 L58.1 64.4 L57.5 63.9 L57.1 63.3 L56.6 62.6 L56.3 61.9 L55.9 61.1 L55.7 60.3 L55.6 59.5 L55.5 58.6 L55.5 57.8 L55.6 56.9 L55.8 56.0 L56.1 55.1 L56.5 54.2 L57.0 53.4 L57.6 52.6 L58.2 51.8 L59.0 51.1 L59.8 50.5 L60.7 49.9 L61.7 49.4 L62.8 49.0 L63.9 48.8 L65.0 48.6 L66.2 48.5 L67.4 48.6 L68.6 48.8 L69.8 49.1 L71.0 49.5 L72.1 50.1 L73.3 50.8 L74.3 51.6 L75.3 52.5 L76.3 53.6 L77.1 54.7 L77.8 56.0 L78.4 57.3 L78.9 58.8 L79.2 60.3 L79.4 61.8 L79.4 63.4 L79.3 65.0 L79.0 66.7 L78.6 68.3 L77.9 69.9 L77.1 71.4 L76.1 72.9 L75.0 74.3 L73.7 75.7 L72.2 76.9 L70.6 77.9 L68.9 78.9 L67.0 79.6 L65.1 80.2 L63.1 80.6 L60.9 80.8 L58.8 80.8 L56.6 80.6 L54.4 80.1 L52.2 79.4 L50.1 78.5 L48.0 77.3 L46.0 75.9 L44.1 74.3 L42.4 72.5 L40.8 70.5 L39.4 68.3 L38.2 65.9 L37.3 63.4 L36.6 60.7 L36.1 57.9 L35.9 55.0 L36.0 52.1 L36.5 49.1 L37.2 46.2 L38.2 43.3 L39.5 40.4 L41.2 37.6 L43.1 35.0 L45.4 32.5 L47.9 30.2 L50.7 28.2 L53.8 26.4 L57.0 24.9 L60.5 23.7 L64.2 22.8 L68.0 22.3 L71.8 22.2 L75.8 22.4 L79.8 23.1 L83.8 24.2 L87.7 25.7 L91.5 27.6 L95.2 30.0 L98.7 32.7 L102.0 35.9 L104.9 39.4 L107.6 43.3 L109.9 47.5 L111.9 52.0 L113.3 56.7 L114.4 61.7 L114.9 66.8"/><path d="M115.0 68.1 Q100.0 28.6 79.4 62.4"/><path d="M111.4 50.7 Q90.2 54.9 78.4 57.2 M96.0 30.6 Q81.7 43.7 73.7 51.1 M74.7 22.3 Q70.0 39.1 67.3 48.6 M54.5 26.0 Q58.7 41.2 61.1 49.7 M40.7 38.4 Q51.1 48.0 56.9 53.4 M35.9 54.3 Q48.5 56.9 55.5 58.3 M39.8 68.9 Q50.6 64.9 56.7 62.7 M49.6 78.2 Q56.0 70.1 59.6 65.5" stroke-width="0.8"/>',
  // 唐冠螺：螺塔 + 体螺层 + 螺口
  conch:
    '<path d="M60 16 L44 44 C34 62 38 88 60 104 C82 88 86 62 76 44 Z"/>' +
    '<path d="M51 31 Q60 36 69 31 M46 41 Q60 48 74 41 M41 53 Q60 62 80 53" stroke-width="0.9"/>' +
    '<path d="M64 60 C78 66 80 88 62 101" />' +
    '<path d="M44 70 L50 72 M43 78 L49 80 M45 86 L51 87" stroke-width="0.7"/>',
  // 水晶簇：三根六方柱 + 锥面 + 母岩
  quartz:
    '<path d="M50 34 L60 18 L70 34 L70 92 L50 92 Z"/><path d="M50 34 L60 40 L70 34 M60 40 L60 92"/>' +
    '<path d="M26 58 L33 44 L44 50 L50 88 L36 92 Z"/><path d="M26 58 L37 56 L44 50 M37 56 L42 90"/>' +
    '<path d="M94 58 L87 44 L76 50 L70 88 L84 92 Z"/><path d="M94 58 L83 56 L76 50 M83 56 L78 90"/>' +
    '<path d="M16 96 Q60 84 104 96"/>' +
    '<path d="M63 46 L67 44 M63 54 L67 52 M63 62 L67 60 M63 70 L67 68" stroke-width="0.7"/>',
  // 萤石：八面体 + 一面排线
  fluorite:
    '<path d="M60 16 L96 60 L60 104 L24 60 Z"/><path d="M24 60 L60 72 L96 60 M60 16 L60 104"/>' +
    '<path d="M66 30 L66 68 M72 38 L72 66 M78 45 L78 64 M84 52 L84 62" stroke-width="0.7"/>'
}

/** 物种编号 → 版式（只登记形态；名称 / 学名仍以图鉴目录为准） */
const SHAPE_BY_SPECIES = {
  '001': 'morpho', '009': 'morpho', '012': 'morpho', '017': 'morpho',
  '006': 'swallowtail', '028': 'swallowtail',
  '004': 'nymphalid', '018': 'nymphalid', '021': 'nymphalid', '023': 'nymphalid',
  '031': 'ginkgo', '036': 'lotus',
  '033': 'nautilus', '034': 'conch',
  '041': 'quartz', '015': 'fluorite'
}

/** 新物种未登记时按门类回落 */
const SHAPE_BY_TONE = { insecta: 'morpho', plantae: 'ginkgo', marine: 'nautilus', minerals: 'quartz' }

const cache = {}

function plateUri(shape) {
  const key = SHAPES[shape] ? shape : 'morpho'
  if (cache[key]) return cache[key]
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" stroke="' + INK +
    '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + SHAPES[key] + '</svg>'
  cache[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return cache[key]
}

/** 卡片 → 刻版图（未点亮不给图：只露编号，不剧透形态） */
function plateOf(card) {
  if (!card || !card.unlocked) return ''
  const shape = SHAPE_BY_SPECIES[card.id] || SHAPE_BY_TONE[card.categoryTone] || 'morpho'
  return plateUri(shape)
}

module.exports = { plateOf, plateUri, SHAPES, SHAPE_BY_SPECIES }
