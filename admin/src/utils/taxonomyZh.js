/**
 * 科学分类拉丁名 → 中文（展示/落库归一）
 * 已是中文则原样返回；无映射时保留原文，避免误译。
 */

const LATIN_TO_ZH = {
  // 界
  animalia: '动物界',
  plantae: '植物界',
  fungi: '真菌界',
  protista: '原生生物界',
  monera: '原核生物界',
  chromista: '色素界',
  mineral: '矿物',
  minerals: '矿物',
  fossil: '古生物',

  // 门
  arthropoda: '节肢动物门',
  mollusca: '软体动物门',
  chordata: '脊索动物门',
  cnidaria: '刺胞动物门',
  echinodermata: '棘皮动物门',
  annelida: '环节动物门',
  nematoda: '线虫动物门',
  platyhelminthes: '扁形动物门',
  porifera: '多孔动物门',
  bryophyta: '苔藓植物门',
  pteridophyta: '蕨类植物门',
  magnoliophyta: '被子植物门',
  anthophyta: '被子植物门',
  pinophyta: '松柏门',
  coniferophyta: '松柏门',
  carbonates: '碳酸盐类',
  silicates: '硅酸盐类',

  // 纲
  insecta: '昆虫纲',
  arachnida: '蛛形纲',
  malacostraca: '甲壳纲',
  crustacea: '甲壳纲',
  gastropoda: '腹足纲',
  bivalvia: '双壳纲',
  cephalopoda: '头足纲',
  anthozoa: '珊瑚纲',
  actinopterygii: '辐鳍鱼纲',
  chondrichthyes: '软骨鱼纲',
  mammalia: '哺乳纲',
  aves: '鸟纲',
  reptilia: '爬行纲',
  amphibia: '两栖纲',
  magnoliopsida: '被子植物纲',
  liliopsida: '单子叶植物纲',
  polypodiopsida: '真蕨纲',
  quartz: '石英族',

  // 目（昆虫及相关）
  lepidoptera: '鳞翅目',
  coleoptera: '鞘翅目',
  mantodea: '螳螂目',
  hemiptera: '半翅目',
  hymenoptera: '膜翅目',
  diptera: '双翅目',
  odonata: '蜻蜓目',
  orthoptera: '直翅目',
  phasmatodea: '竹节虫目',
  neuroptera: '脉翅目',
  blattodea: '蜚蠊目',
  dermaptera: '革翅目',
  trichoptera: '毛翅目',
  mecoptera: '长翅目',
  siphonaptera: '蚤目',
  thysanoptera: '缨翅目',
  psocodea: '啮虫目',
  zygentoma: '衣鱼目',
  ephemeroptera: '蜉蝣目',
  plecoptera: '襀翅目',
  raphidioptera: '蛇蛉目',
  megaloptera: '广翅目',
  strepsiptera: '捻翅目',
  emboptera: '纺足目',
  zoraptera: '缺翅目',
  grylloblattodea: '蛩蠊目',
  mantophasmatodea: '螳䗛目',

  // 科（常见蝶/甲）
  papilionidae: '凤蝶科',
  nymphalidae: '蛱蝶科',
  pieridae: '粉蝶科',
  lycaenidae: '灰蝶科',
  hesperiidae: '弄蝶科',
  saturniidae: '天蚕蛾科',
  sphingidae: '天蛾科',
  noctuidae: '夜蛾科',
  geometridae: '尺蛾科',
  scarabaeidae: '金龟科',
  cerambycidae: '天牛科',
  buprestidae: '吉丁虫科',
  carabidae: '步甲科',
  curculionidae: '象甲科',
  lucanidae: '锹甲科',
  dynastidae: '犀金龟科',
  formicidae: '蚁科',
  apidae: '蜜蜂科',
  vespidae: '胡蜂科',
  libellulidae: '蜻科',
  aeshnidae: '蜓科',
  mantidae: '螳科',
  cicadidae: '蝉科',
  'quartz group': '水晶族',
  quartzgroup: '水晶族'
}

const TAX_KEYS = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus']

function hasCjk(s) {
  return /[\u4e00-\u9fff]/.test(s)
}

function normalizeKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[._-]+/g, ' ')
}

/**
 * 单字段拉丁 → 中文；已中文或无映射则保留原文
 */
export function translateTaxonValue(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (hasCjk(s)) return s
  const key = normalizeKey(s)
  if (LATIN_TO_ZH[key]) return LATIN_TO_ZH[key]
  const compact = key.replace(/\s+/g, '')
  if (LATIN_TO_ZH[compact]) return LATIN_TO_ZH[compact]
  return s
}

/**
 * 将 taxonomy 对象各层级转为中文（就地兼容：不增删字段）
 */
export function toChineseTaxonomy(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const k of TAX_KEYS) {
    out[k] = translateTaxonValue(t[k])
  }
  return out
}

export { TAX_KEYS, LATIN_TO_ZH }
