/**
 * 与 subpackages/feature/config/atlasCatalog.js 保持同步（云函数无法引用小程序根目录）。
 */
const RARITY = {
  common: { id: 'common', label: '普通', dots: 2, card: 'plain' },
  rare: { id: 'rare', label: '稀有', dots: 3, card: 'silver' },
  legendary: { id: 'legendary', label: '传奇', dots: 5, card: 'gold' }
}

const METHODS = {
  discover: { id: 'discover', label: '发现采集', logLabel: '在馆里被找到' },
  photo: { id: 'photo', label: '拍照采集', logLabel: '镜头记下' },
  behavior: { id: 'behavior', label: '行为采集', logLabel: '随收藏落入' },
  encounter: { id: 'encounter', label: '偶遇采集', logLabel: '碰巧遇见' }
}

const ATLAS_SERIES = [
  {
    id: 'frost',
    name: '霜降守望',
    speciesIds: ['017', '023', '018', '021'],
    blurb: '十月末到霜降前后，颜色会自己安静下来。'
  },
  {
    id: 'overwinter',
    name: '越冬者',
    speciesIds: ['001', '012', '028'],
    blurb: '翅面把一整季的光收进去，到来年还在。'
  },
  {
    id: 'mountain',
    name: '守山者',
    speciesIds: ['041', '031', '033', '015', '034', '036'],
    blurb: '石头、叶片与壳，都是山海留下的截面。'
  }
]

const ATLAS_SPOTS = [
  { id: 's1', speciesId: '001', storeId: 'store_shanhaizaowu', hint: '主店一层，蝴蝶昆虫柜深处' },
  { id: 's2', speciesId: '018', storeId: 'store_shanhaizaowu', hint: '主店走廊尽头' },
  { id: 's3', speciesId: '041', storeId: 'store_shanhaizaowu', hint: '矿石标本柜' },
  { id: 's4', speciesId: '031', storeId: 'store_xingchen', hint: '工坊角落的工作台' },
  { id: 's5', speciesId: '033', storeId: 'store_shanhaizaowu', hint: '海洋标本柜下层' }
]

function isFrostDescent(date) {
  const cst = toCst(date || new Date())
  return cst.getMonth() === 9 && (cst.getDate() === 23 || cst.getDate() === 24)
}

function toCst(date) {
  const d = date instanceof Date ? date : new Date(date)
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  return new Date(utc + 8 * 3600000)
}

const ATLAS_SPECIES = [
  {
    id: '001',
    no: '001',
    nameZh: '大蓝闪蝶',
    nameLatin: 'Morpho menelaus',
    category: '昆虫',
    rarity: 'common',
    origin: '中美洲至南美北部雨林',
    habit: '林冠中层滑翔，取食发酵果实与树液',
    collectHint: '拍照识别，或在主店蝴蝶昆虫柜深处被找到',
    seriesIds: ['overwinter'],
    aliases: ['大蓝闪蝶', '大蓝闪蝶', 'Morpho menelaus', 'Morpho', '闪蝶'],
    essay:
      '雨林中层的光，走过鳞片时会停一下。那不是染料能做出的蓝，是微观结构把白光拆开，再只把这一段送回来。换一个角度，它会自己暗下去。'
  },
  {
    id: '012',
    no: '012',
    nameZh: '金斑蝶',
    nameLatin: 'Danaus plexippus',
    category: '昆虫',
    rarity: 'common',
    origin: '美洲；迁徙种群随季节跨越大陆',
    habit: '以萝藦科为寄主，成虫作长距离迁徙',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['overwinter'],
    aliases: ['金斑蝶', '黑脉金斑蝶', 'Danaus plexippus', 'monarch'],
    essay:
      '橙色不是为了被注意，是为了在很长的路上还被认出来。翅脉把颜色分成一块一块，像迁徙时记下的站名。有些个体会飞过整个冬天还没到的地方。'
  },
  {
    id: '017',
    no: '017',
    nameZh: '雅灰蝶',
    nameLatin: 'Celastrina argiolus',
    category: '昆虫',
    rarity: 'common',
    origin: '古北界林缘与庭园',
    habit: '霜降之后更常停在枯叶与墙根，翅背拟态树皮',
    collectHint: '拍照识别；霜降前后在馆中更容易被看见',
    seriesIds: ['frost'],
    aliases: ['雅灰蝶', '霍氏灰蝶', 'Celastrina argiolus', '灰蝶'],
    essay:
      '霜降之后，安静的颜色会落在枯叶上。这种灰蝶翅膀背面像树皮，正面却是很浅的蓝。十月末的清晨，露水重的时候，能看见它在墙边收着翅膀。'
  },
  {
    id: '018',
    no: '018',
    nameZh: '枯叶蛱蝶',
    nameLatin: 'Kallima inachus',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚至南亚的阔叶林',
    habit: '停栖时翅背完全拟态枯叶，连叶脉与霉斑一并写下',
    collectHint: '在走廊尽头被找到，或拍照识别',
    seriesIds: ['frost'],
    aliases: ['枯叶蛱蝶', '枯叶蝶', 'Kallima inachus'],
    essay:
      '秋天把叶子的写法教给了翅背：主脉、虫蛀、一点干裂。合起来的时候，它不是蝴蝶，是地上那片还没被风翻走的叶子。只有掀开正面，橙色才肯出来。'
  },
  {
    id: '031',
    no: '031',
    nameZh: '银杏押花',
    nameLatin: 'Ginkgo biloba',
    category: '植物',
    rarity: 'common',
    origin: '中国；现作行道与庭园栽培',
    habit: '扇形叶，秋末转黄后最适合压制保存',
    collectHint: '工坊角落的工作台，或收藏对应押花藏品',
    seriesIds: ['mountain'],
    aliases: ['银杏押花', '银杏', '白果', 'Ginkgo biloba', '押花'],
    essay:
      '扇形的黄不是一下子来的，是叶绿素先退场。压进纸页之后，脉络还在原来的位置。这一页记下的不是一棵树，是它决定把夏天交出去的那个下午。'
  },
  {
    id: '033',
    no: '033',
    nameZh: '鹦鹉螺',
    nameLatin: 'Nautilus pompilius',
    category: '海洋',
    rarity: 'common',
    origin: '西太平洋至印度洋深浅交界',
    habit: '壳室充气调节浮力，夜间更贴近上层',
    collectHint: '海洋标本柜下层，或拍照识别壳体',
    seriesIds: ['mountain'],
    aliases: ['鹦鹉螺', 'Nautilus pompilius', 'Nautilus', '鹦鹉螺壳'],
    essay:
      '螺塔按等角螺线往外长，每一室都是上一室的回忆。切开以后，隔板像年轮。光从切面走进去，会在最老的那一室停住。'
  },
  {
    id: '041',
    no: '041',
    nameZh: '紫水晶',
    nameLatin: 'Amethyst',
    category: '矿石',
    rarity: 'common',
    origin: '巴西、乌拉圭等热液晶洞',
    habit: '石英族，紫色来自微量铁与辐照色心',
    collectHint: '矿石标本柜，或收藏对应矿物标本',
    seriesIds: ['mountain'],
    aliases: ['紫水晶', '紫晶', 'Amethyst', '紫水晶晶洞', '晶洞'],
    essay:
      '紫色停在晶体里，是铁和光后来才加上去的句子。晶洞内侧长满尖锥，像山把一口井翻过来。手电斜着照，尖端会先亮。'
  },
  {
    id: '023',
    no: '023',
    nameZh: '血漪蛱蝶',
    nameLatin: 'Cethosia biblis',
    category: '昆虫',
    rarity: 'rare',
    origin: '东南亚至中国南部林缘',
    habit: '翅表朱红由外缘向内晕开；霜降前后飞得更慢',
    collectHint: '霜降当日到店，才会被写进这一页',
    seriesIds: ['frost'],
    season: 'frost',
    aliases: ['血漪蛱蝶', '红锯蛱蝶', 'Cethosia biblis', '血斑蛱蝶'],
    essay:
      '十月的颜色，到它这里最深。红色不是夺目的那种，是从翅尖慢慢漫进去的。霜降前后，这种蝴蝶才安静下来，可以被慢慢看见。'
  },
  {
    id: '028',
    no: '028',
    nameZh: '绿鸟翼凤蝶',
    nameLatin: 'Ornithoptera priamus',
    category: '昆虫',
    rarity: 'rare',
    origin: '新几内亚至北澳雨林',
    habit: '雄蝶翅面金属绿，大型凤蝶，飞行缓慢',
    collectHint: '时令在馆时拍照或收藏对应藏品',
    seriesIds: ['overwinter'],
    aliases: ['绿鸟翼凤蝶', '鸟翼凤蝶', 'Ornithoptera priamus', '鸟翼蝶'],
    essay:
      '绿色在这么大的翅面上会显得很慢。不是草地的绿，是金属被雨打湿以后那种。它飞过林冠的时候，叶子会误认自己在动。'
  },
  {
    id: '004',
    no: '004',
    nameZh: '琉璃蛱蝶',
    nameLatin: 'Kaniska canace',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚林缘、庭园与河谷',
    habit: '冬型翅面偏蓝紫，夏型转褐；喜停在枯枝与石上',
    collectHint: '拍照识别；馆内蝴蝶昆虫柜亦可见',
    seriesIds: [],
    aliases: ['琉璃蛱蝶', '琉璃蛱蝶', 'Kaniska canace', 'Kaniska'],
    essay:
      '冬天把蓝色收短，夏天把褐色还回去。同一枚翅面，一年写两遍。停在枯枝上的时候，颜色几乎不说话。'
  },
  {
    id: '006',
    no: '006',
    nameZh: '柑橘凤蝶',
    nameLatin: 'Papilio xuthus',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚至西伯利亚南部',
    habit: '幼虫取食芸香科；成虫沿林缘与果园巡飞',
    collectHint: '拍照识别；庭园与馆门口都容易被看见',
    seriesIds: [],
    aliases: ['柑橘凤蝶', '柑橘凤蝶', 'Papilio xuthus'],
    essay:
      '黄与黑排成一行，像果园把季节画在翅膀上。它飞过的路不长，从树下到门前，被认出来的次数却很多。'
  },
  {
    id: '015',
    no: '015',
    nameZh: '萤石',
    nameLatin: 'Fluorite',
    category: '矿石',
    rarity: 'common',
    origin: '热液脉中；常见于湖南、江西等地',
    habit: '立方或八面体解理；部分晶体在紫外下发荧光',
    collectHint: '矿石标本柜中的晶体；或收藏对应矿物',
    seriesIds: ['mountain'],
    aliases: ['萤石', '萤石', 'Fluorite', '萤石晶体'],
    essay:
      '紫外灯一开，颜色才肯从格子里出来。关掉以后，晶体仍是晶体，只是把那句荧光收回去了。'
  },
  {
    id: '021',
    no: '021',
    nameZh: '大红蛱蝶',
    nameLatin: 'Vanessa indica',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚至喜马拉雅林缘',
    habit: '成虫春秋可见，喜访菊科与荨麻科附近',
    collectHint: '拍照识别；霜降前后在馆外也更容易遇见',
    seriesIds: ['frost'],
    aliases: ['大红蛱蝶', '大红蛱蝶', 'Vanessa indica'],
    essay:
      '砖红不是节日的红。翅缘有一圈碎白点，像秋天把路走完后留下的记号。它不急着停，也不急着被写成标本。'
  },
  {
    id: '034',
    no: '034',
    nameZh: '唐冠螺',
    nameLatin: 'Cassis cornuta',
    category: '海洋',
    rarity: 'common',
    origin: '印度洋至西太平洋暖水浅海',
    habit: '厚唇壳口，栖于砂质底，夜行觅食海胆',
    collectHint: '海洋标本柜；或拍照识别壳体',
    seriesIds: ['mountain'],
    aliases: ['唐冠螺', '唐冠螺', 'Cassis cornuta', '冠螺'],
    essay:
      '壳口那一圈厚唇，是沙底把时间攒下来的边。拿起来会沉。光从唇缘滑进去，停在最深的那一转。'
  },
  {
    id: '036',
    no: '036',
    nameZh: '莲花押花',
    nameLatin: 'Nelumbo nucifera',
    category: '植物',
    rarity: 'common',
    origin: '东亚浅水；花瓣适于压制保存',
    habit: '花瓣宽薄，失水后仍留脉纹',
    collectHint: '工坊押花台，或收藏对应押花页',
    seriesIds: ['mountain'],
    aliases: ['莲花押花', '荷花押花', 'Nelumbo nucifera', '莲瓣'],
    essay:
      '花瓣被压进纸页以后，粉才慢慢退成旧纸的颜色。脉络还在原处。这一页记下的不是盛开，是水把花交出去的那个早晨。'
  },
  {
    id: '009',
    no: '009',
    nameZh: '光明女神闪蝶',
    nameLatin: 'Morpho helena',
    category: '昆虫',
    rarity: 'legendary',
    origin: '南美热带雨林',
    habit: '结构色蓝随入射角改变；本店编码款对应证书编号',
    collectHint: '持有编码款藏品后写入；编号 001–004',
    seriesIds: [],
    numbered: { from: '001', to: '004' },
    aliases: ['光明女神闪蝶', 'Morpho helena', '海伦娜闪蝶', '编码闪蝶'],
    essay:
      '编号 001–004。这一批，到此为止。鳞片折射出的蓝色，需要光很慢地走过去才看得全。证书上的编号，和它一样，只有这些。'
  }
]

function getSpeciesById(id) {
  return ATLAS_SPECIES.find((s) => s.id === String(id)) || null
}

function getSpotById(id) {
  return ATLAS_SPOTS.find((s) => s.id === String(id)) || null
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·．.]/g, '')
}

function matchSpeciesByNames(names) {
  const list = (Array.isArray(names) ? names : [names])
    .map(normalizeName)
    .filter(Boolean)
  if (!list.length) return null
  let best = null
  let bestScore = 0
  ATLAS_SPECIES.forEach((sp) => {
    const aliases = (sp.aliases || []).map(normalizeName)
    list.forEach((n) => {
      aliases.forEach((a) => {
        if (!n || !a) return
        let score = 0
        if (n === a) score = 3
        else if (n.indexOf(a) !== -1 || a.indexOf(n) !== -1) score = 2
        if (score > bestScore) {
          bestScore = score
          best = sp
        }
      })
    })
  })
  return bestScore >= 2 ? best : null
}

function parseSpotCode(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  let m = s.match(/ATLAS[:/_-]?([a-z0-9]+)/i)
  if (m) return m[1].toLowerCase()
  m = s.match(/[?&]spot=([a-z0-9]+)/i)
  if (m) return m[1].toLowerCase()
  m = s.match(/^a[_-]?([a-z0-9]+)$/i)
  if (m) return m[1].toLowerCase()
  if (/^s[1-9]\d*$/i.test(s)) return s.toLowerCase()
  return ''
}

function seriesNamesOf(sp) {
  const ids = sp.seriesIds || []
  return ATLAS_SERIES.filter((s) => ids.indexOf(s.id) !== -1).map((s) => s.name)
}

/** 某物种对应的馆内导览印记（可多点） */
function spotsOfSpecies(speciesId) {
  const sid = String(speciesId || '')
  return ATLAS_SPOTS.filter((s) => s.speciesId === sid).map((s) => ({
    id: s.id,
    code: `ATLAS:${s.id}`,
    hint: s.hint || '',
    storeId: s.storeId || ''
  }))
}

const CATEGORY_TONE = {
  昆虫: 'insecta',
  植物: 'plantae',
  矿石: 'minerals',
  海洋: 'marine'
}

function publicSpecies(sp, unlocked) {
  if (!sp) return null
  const rarity = RARITY[sp.rarity] || RARITY.common
  const spots = spotsOfSpecies(sp.id)
  const base = {
    id: sp.id,
    no: sp.no,
    category: sp.category,
    categoryTone: CATEGORY_TONE[sp.category] || '',
    rarity: sp.rarity,
    rarityLabel: rarity.label,
    rarityDots: rarity.dots,
    card: rarity.card,
    seriesIds: sp.seriesIds || [],
    seriesNames: seriesNamesOf(sp),
    unlocked: !!unlocked,
    hasSpot: spots.length > 0
  }
  if (!unlocked) {
    return Object.assign(base, {
      nameZh: '未记录',
      nameLatin: '',
      collectHint: '它在馆里，等被看见。'
    })
  }
  return Object.assign(base, {
    nameZh: sp.nameZh,
    nameLatin: sp.nameLatin,
    origin: sp.origin || '',
    habit: sp.habit || '',
    collectHint: sp.collectHint || '',
    essay: sp.essay || '',
    numbered: sp.numbered || null,
    spots,
    spotHint: spots
      .map((s) => s.hint)
      .filter(Boolean)
      .join(' · '),
    imprintCodes: spots.map((s) => s.code),
    imprintCode: spots[0] ? spots[0].code : ''
  })
}

module.exports = {
  RARITY,
  METHODS,
  ATLAS_SERIES,
  ATLAS_SPOTS,
  ATLAS_SPECIES,
  CATEGORY_TONE,
  getSpeciesById,
  getSpotById,
  spotsOfSpecies,
  matchSpeciesByNames,
  parseSpotCode,
  publicSpecies,
  isFrostDescent,
  toCst
}
