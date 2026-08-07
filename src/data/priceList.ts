/**
 * /price-list · 线下供货价格表
 * 骨架数据：分类与表格字段已定，商品内容后续持续填充。
 */

export interface PriceListItem {
  /** 稳定 id，用于后续编辑与锚点 */
  id: string;
  /** 品名 */
  name: string;
  /** 供货价（元）；未填时页面显示占位 */
  price: number | null;
  /** 规格说明，如尺寸 */
  specs: string;
  /** 备注 */
  note?: string;
  /** 商品图路径（public/ 下）；未填时显示占位块 */
  image?: string;
  imageAlt?: string;
}

export interface PriceListCategory {
  id: string;
  label: string;
  /** 英文 eyebrow，可选 */
  eyebrow?: string;
  items: PriceListItem[];
}

export const priceListMeta = {
  title: '线下供货价格表',
  year: '2025',
  eyebrow: 'Price List · 供货报价',
  lead: '按品类查阅线下供货报价。商品图片、价格与规格将持续补充——当前为页面骨架。',
};

/** 与 Numbers 报价表工作表标签对齐 */
export const priceListCategories: PriceListCategory[] = [
  {
    id: 'glass-dome',
    label: '玻璃罩款',
    eyebrow: 'Glass Dome',
    items: [
      {
        id: 'glass-dome-placeholder-1',
        name: '品名待填',
        price: null,
        specs: '球直径 — 厘米 / 底座直径 — 厘米 / 整体高度 — 厘米',
      },
      {
        id: 'glass-dome-placeholder-2',
        name: '品名待填',
        price: null,
        specs: '球直径 — 厘米 / 底座直径 — 厘米 / 整体高度 — 厘米',
      },
      {
        id: 'glass-dome-placeholder-3',
        name: '品名待填',
        price: null,
        specs: '球直径 — 厘米 / 底座直径 — 厘米 / 整体高度 — 厘米',
      },
    ],
  },
  {
    id: 'combo',
    label: '组合款',
    eyebrow: 'Combination',
    items: [],
  },
  {
    id: 'domestic-butterfly',
    label: '国产蝶',
    eyebrow: 'Domestic Butterfly',
    items: [],
  },
  {
    id: 'insects',
    label: '昆虫类',
    eyebrow: 'Insects',
    items: [],
  },
  {
    id: 'imported-butterfly',
    label: '进口蝶',
    eyebrow: 'Imported Butterfly',
    items: [],
  },
  {
    id: 'chinese-edition',
    label: '中文版',
    eyebrow: 'Chinese Edition',
    items: [],
  },
  {
    id: 'art',
    label: '艺术款',
    eyebrow: 'Art',
    items: [],
  },
  {
    id: 'wenge-jewelry',
    label: '鸡翅木款+首饰',
    eyebrow: 'Wenge & Jewelry',
    items: [],
  },
  {
    id: 'magnet-ocean',
    label: '冰箱贴+海洋系列',
    eyebrow: 'Magnet & Ocean',
    items: [],
  },
];
