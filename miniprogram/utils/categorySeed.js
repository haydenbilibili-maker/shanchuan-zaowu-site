/**
 * categories 集合标准种子 — 自然科学分类 + 衍生品
 * 字段：level(1|2), parentId, taxonomy{界门纲目科属 + Latin}
 */

const CATEGORY_TYPE = {
  SPECIMEN: 'specimen',
  MERCH: 'merch',
  DISPLAY: 'display'
}

function tax(kingdom, phylum, cls, order, family, genus, latin = {}) {
  return {
    kingdom: kingdom || '',
    kingdomLatin: latin.kingdom || '',
    phylum: phylum || '',
    phylumLatin: latin.phylum || '',
    class: cls || '',
    classLatin: latin.class || '',
    order: order || '',
    orderLatin: latin.order || '',
    family: family || '',
    familyLatin: latin.family || '',
    genus: genus || '',
    genusLatin: latin.genus || ''
  }
}

const DEFAULT_CATEGORY_TREE = [
  {
    name: '昆虫馆',
    enName: 'INSECTA',
    sortOrder: 1,
    categoryType: CATEGORY_TYPE.SPECIMEN,
    taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '', '', '', {
      kingdom: 'Animalia',
      phylum: 'Arthropoda',
      class: 'Insecta'
    }),
    children: [
      {
        name: '鳞翅目 · 蝴蝶',
        enName: 'LEPIDOPTERA',
        sortOrder: 1,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '鳞翅目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Lepidoptera'
        })
      },
      {
        name: '鞘翅目 · 甲虫',
        enName: 'COLEOPTERA',
        sortOrder: 2,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '鞘翅目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Coleoptera'
        })
      },
      {
        name: '螳螂目 · 螳螂',
        enName: 'MANTODEA',
        sortOrder: 3,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '螳螂目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Mantodea'
        })
      },
      {
        name: '膜翅目 · 蜂蚁',
        enName: 'HYMENOPTERA',
        sortOrder: 4,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '膜翅目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Hymenoptera'
        })
      },
      {
        name: '半翅目 · 蝉与蝽',
        enName: 'HEMIPTERA',
        sortOrder: 5,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '半翅目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Hemiptera'
        })
      },
      {
        name: '直翅目 · 蝗螽',
        enName: 'ORTHOPTERA',
        sortOrder: 6,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '直翅目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Orthoptera'
        })
      },
      {
        name: '蜻蜓目 · 蜻蜓',
        enName: 'ODONATA',
        sortOrder: 7,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '蜻蜓目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Odonata'
        })
      },
      {
        name: '竹节虫目 · 竹节虫',
        enName: 'PHASMATODEA',
        sortOrder: 8,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '竹节虫目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Phasmatodea'
        })
      },
      {
        name: '其他昆虫',
        enName: 'INSECTA OTHER',
        sortOrder: 9,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta'
        })
      },
      {
        name: '组合框画',
        enName: 'FRAME SET',
        sortOrder: 10,
        categoryType: CATEGORY_TYPE.DISPLAY,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta'
        })
      }
    ]
  },
  {
    name: '矿石馆',
    enName: 'MINERALS',
    sortOrder: 2,
    categoryType: CATEGORY_TYPE.SPECIMEN,
    taxonomy: tax('矿物', '', '', '', '', '', {}),
    children: [
      {
        name: '石英与水晶',
        enName: 'QUARTZ',
        sortOrder: 1,
        taxonomy: tax('矿物', '硅酸盐类', '石英族', '', '', '', {
          kingdom: 'Mineral',
          class: 'Silicates'
        })
      },
      {
        name: '紫水晶与晶洞',
        enName: 'AMETHYST',
        sortOrder: 2,
        taxonomy: tax('矿物', '硅酸盐类', '石英族', '', '水晶族', '', {
          kingdom: 'Mineral',
          class: 'Silicates',
          family: 'Quartz Group'
        })
      },
      {
        name: '方解石与碳酸盐',
        enName: 'CARBONATE',
        sortOrder: 3,
        taxonomy: tax('矿物', '碳酸盐类', '', '', '', '', {
          kingdom: 'Mineral',
          phylum: 'Carbonates'
        })
      },
      {
        name: '化石标本',
        enName: 'FOSSIL',
        sortOrder: 4,
        taxonomy: tax('古生物', '', '', '', '', '', {
          kingdom: 'Fossil'
        })
      }
    ]
  },
  {
    name: '植物馆',
    enName: 'PLANTAE',
    sortOrder: 3,
    categoryType: CATEGORY_TYPE.SPECIMEN,
    taxonomy: tax('植物界', '', '', '', '', '', {
      kingdom: 'Plantae'
    }),
    children: [
      {
        name: '被子植物 · 押花',
        enName: 'ANGIOSPERMAE',
        sortOrder: 1,
        taxonomy: tax('植物界', '', '被子植物纲', '', '', '', {
          kingdom: 'Plantae',
          class: 'Magnoliopsida'
        })
      },
      {
        name: '蕨类植物',
        enName: 'PTERIDOPHYTA',
        sortOrder: 2,
        taxonomy: tax('植物界', '', '蕨类植物门', '', '', '', {
          kingdom: 'Plantae',
          phylum: 'Pteridophyta'
        })
      },
      {
        name: '苔藓与地衣',
        enName: 'BRYOPHYTA',
        sortOrder: 3,
        taxonomy: tax('植物界', '苔藓植物门', '', '', '', '', {
          kingdom: 'Plantae',
          phylum: 'Bryophyta'
        })
      },
      {
        name: '种子与果实',
        enName: 'SEED FRUIT',
        sortOrder: 4,
        taxonomy: tax('植物界', '', '被子植物纲', '', '', '', {
          kingdom: 'Plantae',
          class: 'Magnoliopsida'
        })
      }
    ]
  },
  {
    name: '海洋馆',
    enName: 'MARINE',
    sortOrder: 4,
    categoryType: CATEGORY_TYPE.SPECIMEN,
    taxonomy: tax('动物界', '', '', '', '', '', {
      kingdom: 'Animalia'
    }),
    children: [
      {
        name: '腹足纲 · 贝壳',
        enName: 'GASTROPODA',
        sortOrder: 1,
        taxonomy: tax('动物界', '软体动物门', '腹足纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Mollusca',
          class: 'Gastropoda'
        })
      },
      {
        name: '双壳纲 · 双壳贝',
        enName: 'BIVALVIA',
        sortOrder: 2,
        taxonomy: tax('动物界', '软体动物门', '双壳纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Mollusca',
          class: 'Bivalvia'
        })
      },
      {
        name: '珊瑚纲 · 珊瑚',
        enName: 'ANTHOZOA',
        sortOrder: 3,
        taxonomy: tax('动物界', '刺胞动物门', '珊瑚纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Cnidaria',
          class: 'Anthozoa'
        })
      },
      {
        name: '头足纲 · 头足类',
        enName: 'CEPHALOPODA',
        sortOrder: 4,
        taxonomy: tax('动物界', '软体动物门', '头足纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Mollusca',
          class: 'Cephalopoda'
        })
      },
      {
        name: '甲壳纲 · 蟹虾',
        enName: 'MALACOSTRACA',
        sortOrder: 5,
        taxonomy: tax('动物界', '节肢动物门', '甲壳纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Malacostraca'
        })
      },
      {
        name: '辐鳍鱼纲 · 鱼类',
        enName: 'ACTINOPTERYGII',
        sortOrder: 6,
        taxonomy: tax('动物界', '脊索动物门', '辐鳍鱼纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Actinopterygii'
        })
      }
    ]
  },
  {
    name: '动物馆',
    enName: 'ANIMAL HALL',
    sortOrder: 5,
    categoryType: CATEGORY_TYPE.SPECIMEN,
    taxonomy: tax('动物界', '脊索动物门', '', '', '', '', {
      kingdom: 'Animalia',
      phylum: 'Chordata'
    }),
    children: [
      {
        name: '哺乳纲',
        enName: 'MAMMALIA',
        sortOrder: 1,
        taxonomy: tax('动物界', '脊索动物门', '哺乳纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Mammalia'
        })
      },
      {
        name: '鸟纲',
        enName: 'AVES',
        sortOrder: 2,
        taxonomy: tax('动物界', '脊索动物门', '鸟纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Aves'
        })
      },
      {
        name: '爬行纲',
        enName: 'REPTILIA',
        sortOrder: 3,
        taxonomy: tax('动物界', '脊索动物门', '爬行纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Reptilia'
        })
      },
      {
        name: '两栖纲',
        enName: 'AMPHIBIA',
        sortOrder: 4,
        taxonomy: tax('动物界', '脊索动物门', '两栖纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Amphibia'
        })
      },
      {
        name: '辐鳍鱼纲',
        enName: 'ACTINOPTERYGII',
        sortOrder: 5,
        taxonomy: tax('动物界', '脊索动物门', '辐鳍鱼纲', '', '', '', {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Actinopterygii'
        })
      }
    ]
  },
  {
    name: '首饰馆',
    enName: 'JEWELRY',
    sortOrder: 6,
    categoryType: CATEGORY_TYPE.MERCH,
    taxonomy: tax('', '', '', '', '', '', {}),
    children: [
      {
        name: '戒指与指环',
        enName: 'RINGS',
        sortOrder: 1,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '项链与吊坠',
        enName: 'NECKLACE',
        sortOrder: 2,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '手链与手镯',
        enName: 'BRACELET',
        sortOrder: 3,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '耳饰',
        enName: 'EARRINGS',
        sortOrder: 4,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '胸针与别针',
        enName: 'BROOCH',
        sortOrder: 5,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      }
    ]
  },
  {
    name: '衍生品',
    enName: 'MERCHANDISE',
    sortOrder: 7,
    categoryType: CATEGORY_TYPE.MERCH,
    taxonomy: tax('', '', '', '', '', '', {}),
    children: [
      {
        name: '包装与礼盒',
        enName: 'PACKAGING',
        sortOrder: 1,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '物种科普卡片',
        enName: 'SPECIES CARD',
        sortOrder: 2,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '书籍与画册',
        enName: 'BOOKS',
        sortOrder: 3,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '标本工具耗材',
        enName: 'TOOLS',
        sortOrder: 4,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '家居陈饰',
        enName: 'HOME DECOR',
        sortOrder: 5,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      },
      {
        name: '品牌联名周边',
        enName: 'COLLAB',
        sortOrder: 6,
        categoryType: CATEGORY_TYPE.MERCH,
        taxonomy: tax('', '', '', '', '', '', {})
      }
    ]
  }
]

/** 旧一级名 → 精简一级馆名（合并脏数据用） */
const LEGACY_ROOT_ALIASES = {
  神奇昆虫: '昆虫馆',
  神奇昆虫馆: '昆虫馆',
  蝴蝶昆虫: '昆虫馆',
  蝴蝶昆虫馆: '昆虫馆',
  首饰: '首饰馆',
  饰品馆: '首饰馆',
  群山回响: '矿石馆',
  植物探微: '植物馆',
  植物果实: '植物馆',
  无尽海洋: '海洋馆',
  海洋标本: '海洋馆',
  动物类: '动物馆',
  动物世界: '动物馆',
  昆虫: '昆虫馆',
  植物: '植物馆',
  海洋: '海洋馆',
  矿石: '矿石馆',
  矿物: '矿石馆',
  动物: '动物馆'
}

/** 旧二级名 → 新二级名（便于 upsert 迁移） */
const LEGACY_CHILD_ALIASES = {
  蝴蝶: '鳞翅目 · 蝴蝶',
  甲虫: '鞘翅目 · 甲虫',
  螳螂: '螳螂目 · 螳螂',
  膜翅目: '膜翅目 · 蜂蚁',
  蜂蚁: '膜翅目 · 蜂蚁',
  半翅目: '半翅目 · 蝉与蝽',
  '半翅目 · 蝉与蚧': '半翅目 · 蝉与蝽',
  蝉与蚧: '半翅目 · 蝉与蝽',
  蝉与蝽: '半翅目 · 蝉与蝽',
  直翅目: '直翅目 · 蝗螽',
  蝗螽: '直翅目 · 蝗螽',
  蜻蜓目: '蜻蜓目 · 蜻蜓',
  蜻蜓: '蜻蜓目 · 蜻蜓',
  竹节虫目: '竹节虫目 · 竹节虫',
  竹节虫: '竹节虫目 · 竹节虫',
  矿石晶体: '石英与水晶',
  晶洞: '紫水晶与晶洞',
  干花标本: '被子植物 · 押花',
  种子标本: '种子与果实',
  贝壳: '腹足纲 · 贝壳',
  珊瑚: '珊瑚纲 · 珊瑚',
  头足类: '头足纲 · 头足类',
  哺乳类: '哺乳纲',
  爬行类: '爬行纲',
  鸟类: '鸟纲',
  两栖类: '两栖纲',
  鱼类: '辐鳍鱼纲',
  周边文创: '品牌联名周边',
  书籍画册: '书籍与画册',
  工具耗材: '标本工具耗材'
}

/** 允许存在的一级馆白名单（顺序即 Picker 顺序） */
const CANONICAL_ROOT_NAMES = DEFAULT_CATEGORY_TREE.map((r) => r.name)
const CANONICAL_ROOT_SET = new Set(CANONICAL_ROOT_NAMES)

/**
 * 首页「博物标本室」灵动球 _id → 规范一级馆名
 * 注意：旧版第二球曾映射矿石馆/群山回响，现为动物馆
 */
const HOME_ORB_ROOT = {
  insect: '昆虫馆',
  animal: '动物馆',
  plant: '植物馆',
  marine: '海洋馆'
}

/** 任意一级名 / 短名 / 旧展示名 → 规范馆名（如 动物 → 动物馆） */
function toCanonicalRootName(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  if (!s) return ''
  if (CANONICAL_ROOT_SET.has(s)) return s
  if (LEGACY_ROOT_ALIASES[s]) return LEGACY_ROOT_ALIASES[s]
  if (!s.endsWith('馆')) {
    const withHall = `${s}馆`
    if (CANONICAL_ROOT_SET.has(withHall)) return withHall
    if (LEGACY_ROOT_ALIASES[withHall]) return LEGACY_ROOT_ALIASES[withHall]
  }
  return ''
}

/**
 * C 端馆藏一级展示名（与 Admin / 云库 name 对齐）
 * 旧短名仍可通过 LEGACY_ROOT_ALIASES / toCanonicalRootName 解析匹配。
 * ROOT_DISPLAY_NAMES 仅作可选覆盖；默认直接展示规范馆名（含「馆」）。
 */
const ROOT_DISPLAY_NAMES = {
  昆虫馆: '蝴蝶昆虫馆'
}

/** 规范馆名 / 别名 → 馆藏 Tab 展示名（优先 Admin 云库 name，如 饰品馆、蝴蝶昆虫馆） */
function toRootDisplayName(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  if (!s || s === '全部') return s === '全部' ? '全部' : ''
  const canonical = toCanonicalRootName(s)
  if (canonical && s !== canonical) return s
  const base = canonical || s
  if (ROOT_DISPLAY_NAMES[base]) return ROOT_DISPLAY_NAMES[base]
  return base
}

/**
 * 二级缺注释时的展示兜底（云库 sync 重命名前仍可读）
 * 正式名仍以 categories.name / seed 为准；此处仅 UI 拼接。
 */
const L2_DISPLAY_ANNOTATIONS = {
  膜翅目: '蜂蚁',
  直翅目: '蝗螽',
  蜻蜓目: '蜻蜓',
  竹节虫目: '竹节虫',
  半翅目: '蝉与蝽',
  鳞翅目: '蝴蝶',
  鞘翅目: '甲虫',
  螳螂目: '螳螂',
  腹足纲: '贝壳',
  双壳纲: '双壳贝',
  珊瑚纲: '珊瑚',
  头足纲: '头足类',
  甲壳纲: '蟹虾',
  辐鳍鱼纲: '鱼类',
  被子植物: '押花'
}

/**
 * 二级品类展示名：优先 name；若无「·」注释则用 alias / subtitle / commonName / 兜底表拼接
 */
function formatCategoryDisplayName(catOrName) {
  if (catOrName == null) return ''
  if (typeof catOrName === 'string') {
    const name = String(catOrName).trim()
    if (!name) return ''
    if (/[·・]/.test(name)) return name
    const note = L2_DISPLAY_ANNOTATIONS[name]
    return note ? `${name} · ${note}` : name
  }
  const name = String(catOrName.name || '').trim()
  if (!name) return ''
  if (/[·・]/.test(name)) return name
  const note = String(
    catOrName.alias ||
      catOrName.subtitle ||
      catOrName.commonName ||
      L2_DISPLAY_ANNOTATIONS[name] ||
      ''
  ).trim()
  if (note && note !== name) return `${name} · ${note}`
  return name
}

/**
 * 商品 rootCategoryName / 仅写了一级名的 category 可能出现的全部别名
 * 用于云库 _.in 精确匹配，避免用「海」「动物」等短词正则误伤 title/二级名
 */
function collectRootAliases(canonicalOrRaw) {
  const canonical = toCanonicalRootName(canonicalOrRaw)
  if (!canonical) return []
  const names = new Set([canonical])
  if (canonical.endsWith('馆')) names.add(canonical.slice(0, -1))
  Object.entries(LEGACY_ROOT_ALIASES).forEach(([legacy, target]) => {
    if (target !== canonical) return
    names.add(legacy)
    if (legacy.endsWith('馆')) names.add(legacy.slice(0, -1))
  })
  return [...names]
}

function buildCategoryDoc(node, level, parentId) {
  const doc = {
    name: node.name,
    enName: node.enName || '',
    level,
    sortOrder: node.sortOrder || 99,
    status: 'active',
    categoryType: node.categoryType || (level === 1 ? CATEGORY_TYPE.SPECIMEN : undefined) || CATEGORY_TYPE.SPECIMEN,
    taxonomy: node.taxonomy || tax('', '', '', '', '', '', {})
  }
  if (parentId) doc.parentId = parentId
  return doc
}

module.exports = {
  CATEGORY_TYPE,
  DEFAULT_CATEGORY_TREE,
  CANONICAL_ROOT_NAMES,
  LEGACY_ROOT_ALIASES,
  LEGACY_CHILD_ALIASES,
  HOME_ORB_ROOT,
  ROOT_DISPLAY_NAMES,
  L2_DISPLAY_ANNOTATIONS,
  toCanonicalRootName,
  toRootDisplayName,
  formatCategoryDisplayName,
  collectRootAliases,
  buildCategoryDoc,
  tax
}
