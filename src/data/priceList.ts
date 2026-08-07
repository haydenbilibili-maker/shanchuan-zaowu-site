/**
 * /price-list · 线下供货价格表
 * 扁平 items[] + 双维筛选：包装方式 × 生物/题材。
 */

/** 标本制作方式（展示用） */
export type PrepMethod = '干制' | '浸液' | '塑化' | '其他';

/** 方式1 · 包装 / 品类（筛选枚举；含「收藏级标本」等高端品类） */
export type PackagingFilter =
  | '玻璃罩'
  | '相框'
  | '冰箱贴'
  | '精灵球'
  | '蝶翅画'
  | '压制标本'
  | '创意摆件'
  | '首饰'
  | '收藏级标本'
  | '其它标本';

/** 方式2 · 生物/题材类（筛选枚举；含爬行动物以正确归类宠物蛇） */
export type BioFilter =
  | '植物果实'
  | '海洋'
  | '蝴蝶'
  | '昆虫'
  | '哺乳动物'
  | '两栖动物'
  | '爬行动物';

/** 标价：单一数字，或 { min, max } 区间（元） */
export type PriceAmount = number | { min: number; max: number };

export function isPriceRange(value: PriceAmount | null | undefined): value is { min: number; max: number } {
  return typeof value === 'object' && value !== null && 'min' in value && 'max' in value;
}

/** 展示文案：15 / 20–40 / — */
export function formatPriceAmount(value: PriceAmount | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (isPriceRange(value)) return `${value.min}–${value.max}`;
  return String(value);
}

/** 采购估算用下限；区间取 min，单一取自身 */
export function priceLowerBound(value: PriceAmount | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (isPriceRange(value)) return value.min;
  return Number.isFinite(value) ? value : null;
}

export function priceUpperBound(value: PriceAmount | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (isPriceRange(value)) return value.max;
  return Number.isFinite(value) ? value : null;
}

export interface PriceListItem {
  /** 稳定 id，用于后续编辑与锚点 */
  id: string;
  /** 完整可读品名 */
  name: string;
  /** 物种名称（组合款可用「A + B」） */
  species: string;
  /** 标本制作方式 */
  prepMethod: PrepMethod;
  /** 包装方式（展示文案，可与筛选项不同） */
  packaging: string;
  /** 筛选 · 包装方式 */
  packagingFilter: PackagingFilter;
  /** 筛选 · 生物/题材 */
  bioFilter: BioFilter;
  /** 供货价（元）；支持单一数字或区间；未填时页面显示占位 */
  price: PriceAmount | null;
  /** 指导售价（元）；支持单一数字或区间；未填时页面显示占位 */
  guidePrice?: PriceAmount | null;
  /** 规格说明，如尺寸 */
  specs: string;
  /** 备注 */
  note?: string;
  /** 商品图路径（public/ 下）；未填时显示占位块；多图时通常等于 images[0] */
  image?: string;
  /** 同一 SKU 多图；有值时 lightbox 可切换；首张同步到 image 以兼容旧字段 */
  images?: string[];
  imageAlt?: string;
}

export const packagingFilterOptions: PackagingFilter[] = [
  '玻璃罩',
  '相框',
  '冰箱贴',
  '精灵球',
  '蝶翅画',
  '压制标本',
  '创意摆件',
  '首饰',
  '收藏级标本',
  '其它标本',
];

export const bioFilterOptions: BioFilter[] = [
  '植物果实',
  '海洋',
  '蝴蝶',
  '昆虫',
  '哺乳动物',
  '两栖动物',
  '爬行动物',
];

export const priceListMeta = {
  /** 完整页面/SEO 标题（含品牌） */
  title: '山海造物线下供货价格表',
  /** 封面主标题拆行：品牌行 + 说明行 */
  brand: '山海造物',
  heading: '线下供货价格表',
  year: '2026',
  eyebrow: 'Price List · 供货报价',
  lead: '按包装/品类与题材组合筛选线下供货报价。每条商品标注物种、制作方式与包装；图片与价格持续补充。',
};

/**
 * 扁平商品清单。
 * 原「框 / 玻璃罩」合并项已拆为独立 SKU，便于双维筛选准确命中。
 */
export const priceListItems: PriceListItem[] = [
  // —— 收藏级标本 ——
  {
    id: 'green-birdwing-collection',
    name: '绿鸟翼凤蝶',
    species: '绿鸟翼凤蝶',
    prepMethod: '干制',
    packaging: '收藏级装裱',
    packagingFilter: '收藏级标本',
    bioFilter: '蝴蝶',
    price: { min: 1000, max: 2000 },
    guidePrice: { min: 2000, max: 4000 },
    specs: '收藏级相框装裱 · 尺寸待补',
    note: '国际二级保护动物，合法带证书',
    image: '/images/price-list/green-birdwing-collection.jpg',
    imageAlt: '绿鸟翼凤蝶（收藏级标本）',
  },

  // —— 大蓝闪蝶 ——
  {
    id: 'morpho-solid-wood-frame',
    name: '大蓝闪蝶实木框',
    species: '大蓝闪蝶',
    prepMethod: '干制',
    packaging: '实木框',
    packagingFilter: '相框',
    bioFilter: '蝴蝶',
    price: 290,
    guidePrice: 499,
    specs: '实木相框装裱 · 尺寸待补',
    note: 'Morpho 干制标本',
    image: '/images/price-list/blue-morpho-wood-frame.jpg',
    imageAlt: '大蓝闪蝶实木框',
  },
  {
    id: 'morpho-combo-frame',
    name: '大蓝闪蝶组合相框',
    species: '大蓝闪蝶',
    prepMethod: '干制',
    packaging: '组合相框',
    packagingFilter: '相框',
    bioFilter: '蝴蝶',
    price: 390,
    guidePrice: 899,
    specs: '双只组合 · 相框装裱 · 尺寸待补',
    note: '双只组合',
    image: '/images/price-list/blue-morpho-combo-frame.jpg',
    imageAlt: '大蓝闪蝶组合相框',
  },
  {
    id: 'morpho-glass-dome-single',
    name: '大蓝闪蝶玻璃罩（单只）',
    species: '大蓝闪蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 300,
    guidePrice: 499,
    specs: '单只装玻璃罩 · 尺寸待补',
    note: 'Morpho 干制标本',
    image: '/images/price-list/blue-morpho-dome-single.jpg',
    imageAlt: '大蓝闪蝶玻璃罩（单只）',
  },
  {
    id: 'morpho-glass-dome-triple',
    name: '大蓝闪蝶玻璃罩（三只）',
    species: '大蓝闪蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: null,
    specs: '三只组合玻璃罩 · 尺寸待补',
    note: 'Morpho 干制标本',
  },

  // —— 天堂凤蝶（原合并项拆分）——
  {
    id: 'ornithoptera-paradise-frame',
    name: '天堂凤蝶实木框',
    species: '天堂凤蝶',
    prepMethod: '干制',
    packaging: '实木框',
    packagingFilter: '相框',
    bioFilter: '蝴蝶',
    price: 180,
    guidePrice: 368,
    specs: '实木相框装裱 · 尺寸待补',
    note: '另有玻璃罩款',
    image: '/images/price-list/paradise-birdwing-wood-frame.jpg',
    imageAlt: '天堂凤蝶实木框',
  },
  {
    id: 'ornithoptera-paradise-dome',
    name: '天堂凤蝶玻璃罩',
    species: '天堂凤蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 180,
    guidePrice: 368,
    specs: '玻璃罩 · 尺寸待补',
    note: '另有相框款',
    image: '/images/price-list/paradise-birdwing-dome.jpg',
    imageAlt: '天堂凤蝶玻璃罩',
  },
  {
    id: 'green-banded-peacock-swallowtail-dome',
    name: '绿带翠凤蝶玻璃罩',
    species: '绿带翠凤蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 45,
    guidePrice: 128,
    specs: '玻璃罩装裱 · 尺寸待补',
    image: '/images/price-list/green-banded-peacock-swallowtail-dome.jpg',
    imageAlt: '绿带翠凤蝶玻璃罩',
  },
  {
    id: 'blue-banded-velvet-butterfly-dome',
    name: '蓝带绒夹蝶玻璃罩',
    species: '蓝带绒夹蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 99,
    guidePrice: 198,
    specs: '玻璃罩装裱 · 尺寸待补',
    image: '/images/price-list/blue-banded-velvet-butterfly-dome.jpg',
    imageAlt: '蓝带绒夹蝶玻璃罩',
  },

  // —— 爱神凤蝶（原合并项拆分）——
  {
    id: 'papilio-eros-frame',
    name: '爱神凤蝶相框',
    species: '爱神凤蝶',
    prepMethod: '干制',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '蝴蝶',
    price: 180,
    guidePrice: 368,
    specs: '相框装裱 · 尺寸待补',
    note: '另有玻璃罩款',
    image: '/images/price-list/papilio-eros-frame.jpg',
    imageAlt: '爱神凤蝶相框',
  },
  {
    id: 'papilio-eros-dome',
    name: '爱神凤蝶玻璃罩',
    species: '爱神凤蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 180,
    guidePrice: 368,
    specs: '玻璃罩 · 尺寸待补',
    note: '另有相框款',
    image: '/images/price-list/papilio-eros-dome.jpg',
    imageAlt: '爱神凤蝶玻璃罩',
  },

  // —— 天堂 + 爱神组合（原合并项拆分）——
  {
    id: 'paradise-eros-combo-frame',
    name: '天堂凤蝶 + 爱神凤蝶组合相框',
    species: '天堂凤蝶 + 爱神凤蝶',
    prepMethod: '干制',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '蝴蝶',
    price: 350,
    guidePrice: 599,
    specs: '双蝶组合 · 相框装裱 · 尺寸待补',
    note: '另有玻璃罩款',
    image: '/images/price-list/paradise-eros-combo-frame.jpg',
    imageAlt: '天堂凤蝶 + 爱神凤蝶组合相框',
  },
  {
    id: 'paradise-eros-combo-dome',
    name: '天堂凤蝶 + 爱神凤蝶组合玻璃罩',
    species: '天堂凤蝶 + 爱神凤蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: null,
    specs: '双蝶组合 · 玻璃罩 · 尺寸待补',
    note: '另有相框款',
  },

  // —— 国内杂蝶（原合并项拆分）——
  {
    id: 'domestic-mixed-butterfly-frame',
    name: '国内杂蝶（约30种）相框',
    species: '国内杂蝶',
    prepMethod: '干制',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '蝴蝶',
    price: 39,
    guidePrice: 98,
    specs: '约30种混装 · 相框装裱 · 规格待补',
    note: '品种搭配以实际供货为准；另有玻璃罩款',
    image: '/images/price-list/domestic-mixed-butterfly-frame-01.jpg',
    images: [
      '/images/price-list/domestic-mixed-butterfly-frame-01.jpg',
      '/images/price-list/domestic-mixed-butterfly-frame-02.jpg',
      '/images/price-list/domestic-mixed-butterfly-frame-03.jpg',
      '/images/price-list/domestic-mixed-butterfly-frame-04.jpg',
    ],
    imageAlt: '国内杂蝶（约30种）相框',
  },
  {
    id: 'domestic-mixed-butterfly-dome',
    name: '国内杂蝶（约30种）玻璃罩',
    species: '国内杂蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 45,
    guidePrice: 128,
    specs: '约30种混装 · 玻璃罩 · 规格待补',
    note: '品种搭配以实际供货为准；另有相框款',
    image: '/images/price-list/domestic-mixed-butterfly-dome-01.jpg',
    images: [
      '/images/price-list/domestic-mixed-butterfly-dome-01.jpg',
      '/images/price-list/domestic-mixed-butterfly-dome-02.jpg',
      '/images/price-list/domestic-mixed-butterfly-dome-03.jpg',
      '/images/price-list/domestic-mixed-butterfly-dome-04.jpg',
    ],
    imageAlt: '国内杂蝶（约30种）玻璃罩',
  },

  // —— 绿贝矩蛱蝶 ——
  {
    id: 'green-mother-of-pearl-dome',
    name: '绿贝矩蛱蝶玻璃罩',
    species: '绿贝矩蛱蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 390,
    guidePrice: 699,
    specs: '玻璃罩 · 尺寸待补',
    image: '/images/price-list/green-mother-of-pearl-dome.jpg',
    imageAlt: '绿贝矩蛱蝶玻璃罩',
  },

  // —— 肯特白闪蝶 ——
  {
    id: 'kent-white-morpho-dome',
    name: '肯特白闪蝶玻璃罩',
    species: '肯特白闪蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 300,
    guidePrice: 599,
    specs: '玻璃罩 · 尺寸待补',
    image: '/images/price-list/kent-white-morpho-dome.jpg',
    imageAlt: '肯特白闪蝶玻璃罩',
  },

  // —— 血漪蛱蝶 ——
  {
    id: 'blood-ripple-butterfly-dome',
    name: '血漪蛱蝶玻璃罩',
    species: '血漪蛱蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 90,
    guidePrice: 198,
    specs: '玻璃罩装裱 · 尺寸待补',
    image: '/images/price-list/blood-ripple-butterfly-dome.jpg',
    imageAlt: '血漪蛱蝶玻璃罩',
  },

  // —— 黄菲纹蝶 ——
  {
    id: 'yellow-phoebis-dome',
    name: '黄菲纹蝶玻璃罩',
    species: '黄菲纹蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 65,
    guidePrice: 148,
    specs: '玻璃罩装裱 · 尺寸待补',
    image: '/images/price-list/yellow-phoebis-dome.jpg',
    imageAlt: '黄菲纹蝶玻璃罩',
  },

  // —— 蛾娆灰蝶 ——
  {
    id: 'moth-hairstreak-dome',
    name: '蛾娆灰蝶玻璃罩',
    species: '蛾娆灰蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 150,
    guidePrice: 299,
    specs: '玻璃罩装裱 · 尺寸待补',
    image: '/images/price-list/moth-hairstreak-dome.jpg',
    imageAlt: '蛾娆灰蝶玻璃罩',
  },

  // —— 精灵球 / 冰箱贴 / 蝶翅画 ——
  {
    id: 'lyre-hairstreak-glass-sphere',
    name: '雅灰蝶精灵球',
    species: '雅灰蝶',
    prepMethod: '干制',
    packaging: '精灵球',
    packagingFilter: '精灵球',
    bioFilter: '蝴蝶',
    price: 58,
    guidePrice: 98,
    specs: '球直径 — 厘米 / 底座直径 — 厘米',
    note: '国产灰蝶干制标本',
    image: '/images/price-list/lycaenid-pokeball.jpg',
    imageAlt: '雅灰蝶精灵球',
  },
  {
    id: 'mixed-butterfly-fridge-magnet',
    name: '杂蝶冰箱贴',
    species: '杂蝶',
    prepMethod: '干制',
    packaging: '冰箱贴',
    packagingFilter: '冰箱贴',
    bioFilter: '蝴蝶',
    price: { min: 20, max: 40 },
    guidePrice: { min: 59, max: 79 },
    specs: '磁贴尺寸待补 · 品种混搭',
    note: '根据蝴蝶品种稀缺度与供需关系动态调整。',
    image: '/images/price-list/mixed-butterfly-magnet.jpg',
    images: [
      '/images/price-list/mixed-butterfly-magnet.jpg',
      '/images/price-list/mixed-butterfly-magnet-01.jpg',
      '/images/price-list/mixed-butterfly-magnet-02.jpg',
      '/images/price-list/mixed-butterfly-magnet-03.jpg',
      '/images/price-list/mixed-butterfly-magnet-04.jpg',
      '/images/price-list/mixed-butterfly-magnet-05.jpg',
    ],
    imageAlt: '杂蝶冰箱贴',
  },
  {
    id: 'bumblebee-fridge-magnet',
    name: '熊蜂冰箱贴',
    species: '熊蜂',
    prepMethod: '干制',
    packaging: '冰箱贴',
    packagingFilter: '冰箱贴',
    bioFilter: '昆虫',
    price: 50,
    guidePrice: 128,
    specs: '磁贴尺寸待补',
    image: '/images/price-list/bumblebee-magnet.jpg',
    imageAlt: '熊蜂冰箱贴',
  },
  {
    id: 'green-rose-chafer-dome',
    name: '绿萝花金龟玻璃罩',
    species: '绿萝花金龟',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '昆虫',
    price: 69,
    guidePrice: 168,
    specs: '玻璃罩装裱 · 尺寸待补',
    image: '/images/price-list/green-rose-chafer-dome.jpg',
    imageAlt: '绿萝花金龟玻璃罩',
  },
  {
    id: 'vestalis-splendens-dome',
    name: '华艳色蟌玻璃罩',
    species: '华艳色蟌',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '昆虫',
    price: 65,
    guidePrice: 158,
    specs: '玻璃罩装裱 · 尺寸待补',
    note: '豆娘/蜻蜓目，归昆虫',
    image: '/images/price-list/vestalis-splendens-dome.jpg',
    imageAlt: '华艳色蟌玻璃罩',
  },
  {
    id: 'butterfly-wing-pendant',
    name: '蝴蝶翅膀挂件',
    species: '蝴蝶',
    prepMethod: '干制',
    packaging: '挂件',
    packagingFilter: '蝶翅画',
    bioFilter: '蝴蝶',
    price: 7,
    guidePrice: 19.9,
    specs: '翅膀切片挂件 · 尺寸 / 款式待补',
    note: '物种与款式以实际供货为准',
    image: '/images/price-list/butterfly-wing-pendant-01.jpg',
    images: [
      '/images/price-list/butterfly-wing-pendant-01.jpg',
      '/images/price-list/butterfly-wing-pendant-02.jpg',
    ],
    imageAlt: '蝴蝶翅膀挂件',
  },

  // —— 首饰 ——
  {
    id: 'ladybug-ring',
    name: '七星瓢虫戒指',
    species: '七星瓢虫',
    prepMethod: '干制',
    packaging: '戒指',
    packagingFilter: '首饰',
    bioFilter: '昆虫',
    price: 20,
    guidePrice: 49,
    specs: '标本首饰戒指 · 尺寸 / 款式待补',
    image: '/images/price-list/ladybug-ring.jpg',
    imageAlt: '七星瓢虫戒指',
  },

  // —— 创意摆件（蝴蝶题材 · 实用陈列）——
  {
    id: 'morpho-large-shell-watch',
    name: '大蓝闪蝶大贝壳表',
    species: '大蓝闪蝶',
    prepMethod: '其他',
    packaging: '大贝壳表',
    packagingFilter: '创意摆件',
    bioFilter: '蝴蝶',
    price: 400,
    guidePrice: 799,
    specs: '大贝壳造型时钟 · 尺寸待补',
    note: '大贝壳表造型',
    image: '/images/price-list/blue-morpho-large-shell-clock.jpg',
    imageAlt: '大蓝闪蝶大贝壳表',
  },
  {
    id: 'small-morpho-glass-dome',
    name: '小蓝闪蝶玻璃罩',
    species: '小蓝闪蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 350,
    guidePrice: 699,
    specs: '玻璃罩 · 尺寸待补',
    note: '另有贝壳表款',
    image: '/images/price-list/small-morpho-glass-dome.jpg',
    imageAlt: '小蓝闪蝶玻璃罩',
  },
  {
    id: 'small-morpho-shell-clock',
    name: '小蓝闪蝶贝壳表',
    species: '小蓝闪蝶',
    prepMethod: '其他',
    packaging: '贝壳表',
    packagingFilter: '创意摆件',
    bioFilter: '蝴蝶',
    price: 550,
    guidePrice: 899,
    specs: '贝壳造型时钟 · 尺寸待补',
    note: '贝壳表造型',
    image: '/images/price-list/small-morpho-shell-watch.jpg',
    imageAlt: '小蓝闪蝶贝壳表',
  },
  {
    id: 'yellow-crystal-eye-alarm',
    name: '黄晶眼蝶闹钟',
    species: '黄晶眼蝶',
    prepMethod: '干制',
    packaging: '闹钟',
    packagingFilter: '创意摆件',
    bioFilter: '蝴蝶',
    price: 130,
    guidePrice: 258,
    specs: '标本闹钟 · 功能与尺寸待补',
    note: '闹钟造型',
    image: '/images/price-list/yellow-crystal-eye-alarm.jpg',
    imageAlt: '黄晶眼蝶闹钟',
  },
  {
    id: 'yellow-crystal-eye-dome',
    name: '黄晶眼蝶玻璃罩',
    species: '黄晶眼蝶',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    price: 100,
    guidePrice: 198,
    specs: '玻璃罩装裱 · 尺寸待补',
    note: '与「黄晶眼蝶闹钟」区分的独立 SKU',
    image: '/images/price-list/yellow-crystal-eye-dome.jpg',
    imageAlt: '黄晶眼蝶玻璃罩',
  },
  {
    id: 'rose-pretty-eye-alarm',
    name: '玫瑰俏眼蝶闹钟',
    species: '玫瑰俏眼蝶',
    prepMethod: '干制',
    packaging: '闹钟',
    packagingFilter: '创意摆件',
    bioFilter: '蝴蝶',
    price: 160,
    guidePrice: 298,
    specs: '标本闹钟 · 功能与尺寸待补',
    note: '闹钟造型',
    image: '/images/price-list/rose-pretty-eye-alarm.jpg',
    imageAlt: '玫瑰俏眼蝶闹钟',
  },

  // —— 植物 ——
  {
    id: 'dandelion-glass-dome',
    name: '蒲公英玻璃罩',
    species: '蒲公英',
    prepMethod: '干制',
    packaging: '玻璃罩',
    packagingFilter: '玻璃罩',
    bioFilter: '植物果实',
    price: 30,
    guidePrice: 88,
    specs: '玻璃罩 · 尺寸待补',
    image: '/images/price-list/dandelion-glass-dome.jpg',
    imageAlt: '蒲公英玻璃罩',
  },
  {
    id: 'four-leaf-clover-laminated',
    name: '四叶草塑封',
    species: '四叶草',
    prepMethod: '其他',
    packaging: '塑封',
    packagingFilter: '压制标本',
    bioFilter: '植物果实',
    price: 2,
    guidePrice: 5,
    specs: '塑封片规格待补',
    note: '植物压制塑封',
    image: '/images/price-list/four-leaf-clover-laminated.jpg',
    imageAlt: '四叶草塑封',
  },
  {
    id: 'ginkgo-leaf-laminated',
    name: '银杏叶塑封',
    species: '银杏叶',
    prepMethod: '其他',
    packaging: '塑封',
    packagingFilter: '压制标本',
    bioFilter: '植物果实',
    price: null,
    specs: '塑封片规格待补',
    note: '植物压制塑封',
  },
  {
    id: 'plant-combo-frame',
    name: '植物组合相框',
    species: '植物组合',
    prepMethod: '其他',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '植物果实',
    price: 58,
    guidePrice: 158,
    specs: '多植物组合装裱 · 尺寸待补',
    note: '压制植物装饰相框（植物相框）',
    image: '/images/price-list/plant-combo-frame.jpg',
    images: [
      '/images/price-list/plant-combo-frame.jpg',
      '/images/price-list/plant-combo-frame-02.jpg',
      '/images/price-list/plant-combo-frame-03.jpg',
    ],
    imageAlt: '植物组合相框',
  },
  {
    id: 'butterfly-plant-combo-frame',
    name: '蝴蝶植物组合相框',
    species: '蝴蝶 + 植物',
    prepMethod: '其他',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '植物果实',
    price: 180,
    guidePrice: 499,
    specs: '3×5 格蝴蝶 + 植物组合装裱 · 规格待补',
    note: '大型组合框；与六格植物组合相框区分',
    image: '/images/price-list/butterfly-plant-combo-frame-01.jpg',
    images: [
      '/images/price-list/butterfly-plant-combo-frame-01.jpg',
      '/images/price-list/butterfly-plant-combo-frame-02.jpg',
    ],
    imageAlt: '蝴蝶植物组合相框',
  },

  // —— 海洋 ——
  {
    id: 'shell-photo-frame',
    name: '贝壳相框',
    species: '贝壳',
    prepMethod: '其他',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '海洋',
    price: 15,
    guidePrice: 39,
    specs: '贝壳装裱相框 · 尺寸待补',
    note: '与「贝壳组合相框」区分的单品 SKU',
    image: '/images/price-list/shell-photo-frame.jpg',
    imageAlt: '贝壳相框',
  },
  {
    id: 'shell-combo-frame',
    name: '贝壳组合相框',
    species: '贝壳组合',
    prepMethod: '其他',
    packaging: '相框',
    packagingFilter: '相框',
    bioFilter: '海洋',
    price: null,
    specs: '多贝壳组合装裱 · 尺寸待补',
  },
  {
    id: 'jellyfish-bottle',
    name: '水母瓶',
    species: '水母',
    prepMethod: '浸液',
    packaging: '瓶',
    packagingFilter: '其它标本',
    bioFilter: '海洋',
    price: null,
    specs: '瓶装浸液标本 · 容量 / 尺寸待补',
    note: '海洋浸液标本',
  },

  // —— 爬行动物 ——
  {
    id: 'pet-snake-wet',
    name: '宠物蛇浸制标本',
    species: '宠物蛇',
    prepMethod: '浸液',
    packaging: '瓶 / 罐',
    packagingFilter: '其它标本',
    bioFilter: '爬行动物',
    price: null,
    specs: '浸液保存 · 体长 / 容器规格待补',
    note: '爬行动物；与塑化版分开报价',
  },
  {
    id: 'pet-snake-plastinated',
    name: '宠物蛇塑化标本',
    species: '宠物蛇',
    prepMethod: '塑化',
    packaging: '塑化成品',
    packagingFilter: '其它标本',
    bioFilter: '爬行动物',
    price: null,
    specs: '塑化保存 · 体长 / 姿态待补',
    note: '爬行动物；与浸制版分开报价',
  },
];
