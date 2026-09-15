/**
 * 确认订单 · 启程前须知（开箱影像 + 入柜保养）
 * 口径与发货私信同源；朋友式博物柜语气（事实→感受→连接）；
 * 可控分行，避免弹窗内尴尬折行。
 */

const CARE_NOTICE_TITLE = '启程前须知'
/** 引导句：连接「落定前」与日后发货私信 */
const CARE_NOTICE_INTRO = '落定前，先与你说清这几件小事——到柜时也会再信告你。'

const CARE_SECTION_UNBOX_LABEL = '开箱与售后'
const CARE_SECTION_CARE_LABEL = '入柜保养'

/**
 * 蝶类判定：类目 / 标签 / 品名 / 学名 / taxonomy。
 * 不单凭「昆虫馆」；首饰/文创衍生品不展示触须说明。
 */
const BUTTERFLY_RE =
  /蝴蝶|闪蝶|蓝闪蝶|鳞翅|凤蝶|蛱蝶|粉蝶|眼蝶|弄蝶|斑蝶|绢蝶|蝶|Lepidoptera|lepidoptera|butterfly|morpho/i

const NON_SPECIMEN_BUTTERFLY_RE =
  /项链|手链|耳环|耳钉|吊坠|戒指|指环|胸针|手镯|手串|耳饰|首饰|饰品|钟表|手表|腕表|手环|文创|衍生|周边|代金券/

function productCareText(product) {
  if (!product || typeof product !== 'object') return ''
  const tax = product.taxonomy || {}
  const tags = Array.isArray(product.tags)
    ? product.tags.join(' ')
    : product.tags || ''
  return [
    product.rootCategoryName,
    product.rootCategory,
    product.categoryType,
    product.category,
    product.categoryName,
    product.subCategoryName,
    product.title,
    product.name,
    product.latinName,
    product.latin,
    tags,
    tax.order,
    tax.family,
    tax.class,
    tax.genus
  ]
    .filter(Boolean)
    .join(' ')
}

function isButterflyProduct(product) {
  if (!product || typeof product !== 'object') return false
  if (product.categoryType === 'merch') return false
  const text = productCareText(product)
  if (!BUTTERFLY_RE.test(text)) return false
  if (NON_SPECIMEN_BUTTERFLY_RE.test(text)) return false
  if (/首饰馆|饰品馆|衍生品/.test(text)) return false
  return true
}

function orderHasButterfly(items) {
  if (!Array.isArray(items) || !items.length) return false
  return items.some((item) => isButterflyProduct(item))
}

/**
 * 每行独立成块，避免自动换行甩出短尾巴。
 * @returns {{ segs: { t: string, brass?: boolean }[] }[]}
 */
function unboxLines() {
  return [
    {
      segs: [
        { t: '到柜时请轻取，并全程录制' },
        { t: '开箱影像', brass: true },
        { t: '。' }
      ]
    },
    {
      segs: [{ t: '有影像在，馆员才能更好帮你看顾。' }]
    },
    {
      segs: [
        { t: '无开箱影像将难以受理售后', brass: true },
        { t: '。' }
      ]
    }
  ]
}

/** 仅蝶类：触须说明（事实）+ 其余部位可约定（连接） */
function antennaLines() {
  return [
    {
      segs: [
        { t: '蝶类触须纤细，' },
        { t: '不在包损之列', brass: true },
        { t: '；' }
      ]
    },
    {
      segs: [{ t: '其余部位若有损毁，可按约定处理。' }]
    }
  ]
}

function careLines() {
  return [
    {
      segs: [
        { t: '入柜后请' },
        { t: '避直射', brass: true },
        { t: '、注意' },
        { t: '防潮', brass: true },
        { t: '；' }
      ]
    },
    {
      segs: [
        { t: '罩框尽量' },
        { t: '保持闭合', brass: true },
        { t: '，让它慢慢安顿。' }
      ]
    }
  ]
}

function resolveCheckoutCareNotice(items) {
  const hasButterfly = orderHasButterfly(items)
  return {
    title: CARE_NOTICE_TITLE,
    intro: CARE_NOTICE_INTRO,
    hasButterfly,
    unboxLabel: CARE_SECTION_UNBOX_LABEL,
    unboxLines: unboxLines(),
    antennaLines: hasButterfly ? antennaLines() : [],
    careLabel: CARE_SECTION_CARE_LABEL,
    careLines: careLines()
  }
}

module.exports = {
  CARE_NOTICE_TITLE,
  CARE_NOTICE_INTRO,
  CARE_SECTION_UNBOX_LABEL,
  CARE_SECTION_CARE_LABEL,
  BUTTERFLY_RE,
  NON_SPECIMEN_BUTTERFLY_RE,
  productCareText,
  isButterflyProduct,
  orderHasButterfly,
  resolveCheckoutCareNotice
}
