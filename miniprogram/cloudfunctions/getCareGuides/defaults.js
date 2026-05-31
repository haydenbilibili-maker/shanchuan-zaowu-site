/**
 * 标本养护 — 默认内容（与 utils/careDefaults.js 保持同步）
 */

const CATEGORY_META = {
  INSECTA: { label: '神奇昆虫', overline: 'INSECTA', color: '#52B788' },
  PLANTAE: { label: '植物探微', overline: 'PLANTAE', color: '#6DA34D' },
  MARINE: { label: '无尽海洋', overline: 'MARINE', color: '#5B8FB9' },
  MINERALS: { label: '群山回响', overline: 'MINERALS', color: '#7B68AE' },
  GENERAL: { label: '通用安放', overline: 'GENERAL', color: '#C4A76C' },
  FRAMING: { label: '装裱养护', overline: 'FRAMING', color: '#C4A76C' }
}

const CATEGORY_CARDS = [
  { category: 'INSECTA', ...CATEGORY_META.INSECTA, desc: '框画与展柜昆虫标本' },
  { category: 'PLANTAE', ...CATEGORY_META.PLANTAE, desc: '押花、干制与植物标本' },
  { category: 'MARINE', ...CATEGORY_META.MARINE, desc: '海洋干制与浸液标本' },
  { category: 'MINERALS', ...CATEGORY_META.MINERALS, desc: '矿物与晶洞陈列' },
  { category: 'GENERAL', ...CATEGORY_META.GENERAL, desc: '摆放、避光与运输' },
  { category: 'FRAMING', ...CATEGORY_META.FRAMING, desc: '木框、金属框与定制装裱', wide: true }
]

const GENERAL_TIPS = [
  { key: 'light', title: '避光安放', desc: '远离南向窗台与射灯长时间直射' },
  { key: 'humidity', title: '干爽环境', desc: '室内相对湿度建议 45–60%，避免浴室与厨房旁' },
  { key: 'touch', title: '少触碰', desc: '观赏时轻拿框架，避免手指直接按压标本表面' },
  { key: 'move', title: '搬运原则', desc: '原包装+缓冲材，框面或玻璃面向上平放' }
]

const GUIDES = {
  GENERAL: {
    guideId: 'care_general_v1',
    category: 'GENERAL',
    title: '通用安放指南',
    overline: 'GENERAL',
    summary: '干处、避晒、少碰，让藏品慢慢适应新家',
    disclaimer: '一般性安放建议，具体请以随件说明或专员指引为准。',
    sections: [
      {
        key: 'environment',
        title: '适宜环境',
        body: '标本适合在稳定、干燥的室内环境中陈列。避免温度骤变与长时间高湿，这类环境容易让框体与内部材料产生变化。',
        tips: ['室温 18–26℃ 较为适宜', '避免空调直吹与暖气贴墙悬挂', '新装修房间请待气味散尽后再开箱陈列']
      },
      {
        key: 'placement',
        title: '日常摆放',
        body: '优先选择视线高度、少人流碰撞的位置。重型框画宜靠墙挂置或平放在稳固台面，不与杂物叠压。',
        tips: ['不与饮料、花瓶同层摆放', '儿童与宠物活动区建议加高或柜内陈列', '大型藏品注意承重与墙面固定']
      },
      {
        key: 'cleaning',
        title: '清洁与除尘',
        body: '日常以干式清洁为主。发现浮灰时，可在通风处用软毛刷轻轻单向扫过，不要用水或化学清洁剂直接擦拭标本本体。',
        tips: ['玻璃/亚克力面可用微湿无绒布擦外框', '禁止使用酒精、湿巾反复摩擦翅面或叶片', '不确定时先联系专员']
      },
      {
        key: 'transport',
        title: '运输与搬家',
        body: '短途搬运请保留原包装与缓冲材料。长途运输建议框面向上、固定四角，避免在车厢内滚动。',
        tips: ['拆挂前先拍照记录挂点位置', '多件套请分件包装，避免相互摩擦', '极端天气不建议当日长途运输']
      },
      {
        key: 'warning',
        title: '异常信号',
        body: '若发现框内返潮、异味、虫蛀痕迹或标本表面出现异常变化，请停止自行处理，联系门店专员协助查看。',
        tips: ['框角开胶、背板鼓胀', '昆虫标本出现新的粉末或碎屑', '湿标本液面浑浊或密封松动']
      }
    ],
    framingAddons: []
  },
  INSECTA: {
    guideId: 'care_insecta_v1',
    category: 'INSECTA',
    title: '神奇昆虫 · 框画与展柜标本',
    overline: 'INSECTA',
    summary: '少碰、避晒、干处安放',
    disclaimer: '不同物种与装裱方式可能存在差异，如有疑问请联系专员。',
    sections: [
      {
        key: 'environment',
        title: '适宜环境',
        body: '昆虫框画对光照与湿度较敏感。长时间直射会让翅面颜色变淡，高湿环境则不利于长期保存。',
        tips: ['避免阳光与强 LED 射灯直射', '相对湿度 45–60%', '勿将框体长期贴靠外墙或卫生间墙面']
      },
      {
        key: 'placement',
        title: '日常安放',
        body: '宜挂墙或平置于稳固展柜内，保持框体水平，避免长期倾斜导致内部结构受力。',
        tips: ['展柜内可放少量干燥剂（勿接触标本）', '不与樟脑丸、香水等强挥发物同柜', '大型框画注意挂钉承重']
      },
      {
        key: 'cleaning',
        title: '清洁与除尘',
        body: '如有浮灰，可在干燥环境下用软毛刷沿翅脉方向轻扫。不要用手直接触摸翅面，汗渍与油脂可能留下痕迹。',
        tips: ['仅清洁外框与玻璃时可用干布', '禁止湿布、酒精、吹尘器近距离直吹', '闪蝶等翅面标本尤其避免反复擦拭']
      },
      {
        key: 'transport',
        title: '运输',
        body: '运输时保持框面向上，用原盒或气泡膜固定四角。途中避免重压与剧烈震动。',
        tips: ['多件叠放时中间加硬纸板分隔', '夏季车内高温勿长时间存放']
      },
      {
        key: 'warning',
        title: '异常信号',
        body: '若发现框内出现不明粉末、翅角断裂增多或背板受潮，请联系专员，不建议自行拆框处理。',
        tips: ['框内出现蚂蚁、书虱等活虫', '玻璃内侧出现雾气状水痕', '标本体色突然变深或发粘']
      }
    ],
    framingAddons: [
      { frameType: 'wood', extraTips: ['木框在梅雨季可能轻微胀缩，避免紧贴潮湿墙面'] },
      { frameType: 'metal', extraTips: ['金属框导热较快，请勿靠近持续热源'] }
    ]
  },
  PLANTAE: {
    guideId: 'care_plantae_v1',
    category: 'PLANTAE',
    title: '植物探微 · 押花与干制标本',
    overline: 'PLANTAE',
    summary: '防潮、避晒、轻拿轻放',
    disclaimer: '不同押花与干制工艺对湿度敏感度不同，请以实际藏品为准。',
    sections: [
      {
        key: 'environment',
        title: '适宜环境',
        body: '植物押花与干制标本怕潮、怕晒。保持干燥与散射光环境，可延长色泽与形态稳定时间。',
        tips: ['避免南向窗直射', '南方梅雨季注意除湿', '勿置于加湿器出风口附近']
      },
      {
        key: 'placement',
        title: '日常安放',
        body: '宜平放或小幅倾斜展示于案几、书架中层。避免挤压花材与频繁翻转。',
        tips: ['不与书籍重压叠放', '开放式陈列时减少触摸', '带玻璃罩者保持罩内干燥']
      },
      {
        key: 'cleaning',
        title: '清洁',
        body: '以软毛刷轻扫表面浮尘即可。植物标本一般不宜水洗或液体清洁。',
        tips: ['用吹风机冷风档时保持 30cm 以上距离', '发现霉点请停止自行处理']
      },
      {
        key: 'transport',
        title: '运输',
        body: '平面运输为主，防止花材折压。原盒内如有固定卡纸请保留使用。',
        tips: ['竖放运输可能导致花材移位', '长途运输建议箱内加「向上」标识']
      },
      {
        key: 'warning',
        title: '异常信号',
        body: '叶片或花瓣出现发黑、发软、霉斑时，请拍照联系专员评估。',
        tips: ['框内出现白色絮状霉丝', '押花颜色整体变暗且伴随潮味']
      }
    ],
    framingAddons: []
  },
  MARINE: {
    guideId: 'care_marine_v1',
    category: 'MARINE',
    title: '无尽海洋 · 海洋标本',
    overline: 'MARINE',
    summary: '干制避潮，浸液避晒避摔',
    disclaimer: '湿标本与干制标本养护方式不同，请以实际品类与随件说明为准。',
    sections: [
      {
        key: 'environment',
        title: '适宜环境',
        body: '海洋干制标本需防潮防蛀；浸液标本则需避免阳光直射与剧烈震动，防止液体浑浊或密封老化。',
        tips: ['干制：湿度 45–55%', '浸液：避免阳光与 LED 直射', '两种类型均不宜高温烘烤']
      },
      {
        key: 'placement',
        title: '日常安放',
        body: '干制标本可像昆虫框画一样挂墙或展柜陈列。浸液标本宜置于稳定台面，避免儿童触碰导致倾倒。',
        tips: ['浸液标本远离桌边与动线碰撞区', '大型贝壳类注意底面防滑', '勿与腐蚀性化学品同柜']
      },
      {
        key: 'cleaning',
        title: '清洁',
        body: '干制标本可用软毛刷除尘。浸液标本仅清洁外壁与底座，不要打开密封或自行换液。',
        tips: ['玻璃器皿外壁用干布擦拭', '发现液面下降或浑浊请联系专员']
      },
      {
        key: 'transport',
        title: '运输',
        body: '浸液标本运输风险较高，建议使用原包装并标注易碎。干制标本参照框画运输方式。',
        tips: ['浸液：瓶口向上、固定不晃动', '冬季注意防冻（部分溶液）']
      },
      {
        key: 'warning',
        title: '异常信号',
        body: '浸液出现浑浊、变色、密封渗液；干制出现虫蛀、碎屑增多，均建议联系专员。',
        tips: ['瓶内出现絮状物或气泡异常增多', '贝壳表面出现粉化手触即掉']
      }
    ],
    framingAddons: []
  },
  MINERALS: {
    guideId: 'care_minerals_v1',
    category: 'MINERALS',
    title: '群山回响 · 矿物与晶洞',
    overline: 'MINERALS',
    summary: '轻拿、防尘、避免酸碱与硬物碰撞',
    disclaimer: '不同矿物硬度与稳定性差异大，请以具体藏品说明为准。',
    sections: [
      {
        key: 'environment',
        title: '适宜环境',
        body: '矿物标本一般可在常湿室内陈列，但应避免长期高湿导致底座或标签受潮。部分晶洞对温度变化敏感。',
        tips: ['避免浴室、厨房等高湿空间长期陈列', '远离强酸强碱清洁环境', '带金属底座者注意防锈']
      },
      {
        key: 'placement',
        title: '日常安放',
        body: '宜使用专用底座或展柜层板，确保重心稳定。尖利晶簇朝向内侧，避免儿童触碰。',
        tips: ['大晶洞建议低重心台面陈列', '多件相邻时留缓冲间距', '勿与重物堆叠']
      },
      {
        key: 'cleaning',
        title: '清洁',
        body: '灰尘可用软毛刷与低压气流（远距离）去除。部分矿物遇水可能变色或溶蚀，请勿随意水洗。',
        tips: ['方解石等软矿物禁止硬刷', '不确定时先咨询专员', '标签牌避免液体溅湿']
      },
      {
        key: 'transport',
        title: '运输',
        body: '尖角部位用泡沫或软纸包裹，箱内固定不晃动。晶洞与 fragile 簇晶建议专车或原箱运输。',
        tips: ['箱内注明「易碎·向上」', '分件包装避免晶簇互撞']
      },
      {
        key: 'warning',
        title: '异常信号',
        body: '晶簇出现新的碎裂、底座松动、表面粉化加剧，请联系专员评估是否需要加固或重新固定。',
        tips: ['底座开胶与矿物分离', '表面出现不明水渍或盐霜']
      }
    ],
    framingAddons: []
  },
  FRAMING: {
    guideId: 'care_framing_v1',
    category: 'FRAMING',
    title: '装裱与框体养护',
    overline: 'FRAMING',
    summary: '框体防潮、挂置稳固、定期目视检查',
    disclaimer: '定制框型与包装方式会影响防潮与挂置要求，详见订单装裱信息。',
    sections: [
      {
        key: 'environment',
        title: '框体与环境',
        body: '木框在湿度变化时可能有轻微胀缩；金属框需注意避免长期靠近热源。背板受潮是框画常见问题之一。',
        tips: ['梅雨季可在展柜内放干燥剂（不接触标本）', '检查挂绳/挂钉是否锈蚀或松脱', '避免框体直接接触外墙']
      },
      {
        key: 'placement',
        title: '挂置与稳固',
        body: '挂墙请使用承重足够的挂钩，大型作品建议两人协作安装。展柜陈列注意通风，勿长期密闭高湿。',
        tips: ['安装前确认墙体材质与承重', '水平仪校正，避免长期受力不均', '礼盒包装不适用于长期陈列环境']
      },
      {
        key: 'warning',
        title: '何时联系工坊',
        body: '框角开胶、背板鼓胀、玻璃松动、密封条老化等情况，建议联系门店或工坊评估，不建议自行拆框。',
        tips: ['定制单可在订单详情查看框型信息', '如需换框、除尘深度护理可预约到店']
      }
    ],
    framingAddons: []
  }
}

function normalizeCategory(raw) {
  if (!raw) return 'GENERAL'
  const s = String(raw).trim().toUpperCase()
  if (GUIDES[s]) return s
  const map = {
    INSECT: 'INSECTA',
    INSECTS: 'INSECTA',
    PLANT: 'PLANTAE',
    PLANTS: 'PLANTAE',
    MARINE: 'MARINE',
    OCEAN: 'MARINE',
    MINERAL: 'MINERALS',
    MINERALS: 'MINERALS',
    CRYSTAL: 'MINERALS'
  }
  return map[s] || 'GENERAL'
}

function getGuideByCategory(category) {
  const cat = normalizeCategory(category)
  return GUIDES[cat] || GUIDES.GENERAL
}

function getCategoryMeta(category) {
  const cat = normalizeCategory(category)
  return CATEGORY_META[cat] || CATEGORY_META.GENERAL
}

function buildGuideUrl(options = {}) {
  const q = []
  if (options.category) q.push(`category=${encodeURIComponent(normalizeCategory(options.category))}`)
  if (options.orderId) q.push(`orderId=${encodeURIComponent(options.orderId)}`)
  if (options.productId) q.push(`productId=${encodeURIComponent(options.productId)}`)
  if (options.from) q.push(`from=${encodeURIComponent(options.from)}`)
  const qs = q.length ? `?${q.join('&')}` : ''
  return `/pages/care/guide/index${qs}`
}

function buildHubUrl(from) {
  return `/pages/care/index${from ? `?from=${encodeURIComponent(from)}` : ''}`
}

function isVoucherLikeProduct(product) {
  if (!product) return true
  const priceStr = product.price ? String(product.price) : ''
  if (priceStr.includes('PTS') || priceStr.includes('积分')) return true
  const latinUpper = product.latin ? String(product.latin).toUpperCase() : ''
  return latinUpper === 'COUPON' || latinUpper === 'VOUCHER' || latinUpper.includes('COUPON')
}

/** 是否展示标本养护入口（排除文创/券类等） */
function isSpecimenCareProduct(product) {
  if (!product || isVoucherLikeProduct(product)) return false
  if (product.categoryType === 'merch') return false
  const text = `${product.rootCategoryName || ''}${product.category || ''}${product.title || ''}`
  if (/衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒|卡片|课程|活动|代金券/.test(text)) return false
  return true
}

function getCareSummary(guide, framingName) {
  if (!guide) return '签收后请按品类指南妥善安放。'
  let text = guide.summary || ''
  if (framingName) {
    text += ` 装裱：${framingName}，请注意防潮与挂置稳固。`
  }
  return text
}

module.exports = {
  CATEGORY_META,
  CATEGORY_CARDS,
  GENERAL_TIPS,
  GUIDES,
  normalizeCategory,
  getGuideByCategory,
  getCategoryMeta,
  buildGuideUrl,
  buildHubUrl,
  isVoucherLikeProduct,
  isSpecimenCareProduct,
  getCareSummary
}
