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
        name: '半翅目 · 蝉与蚧',
        enName: 'HEMIPTERA',
        sortOrder: 4,
        taxonomy: tax('动物界', '节肢动物门', '昆虫纲', '半翅目', '', '', {
          kingdom: 'Animalia',
          phylum: 'Arthropoda',
          class: 'Insecta',
          order: 'Hemiptera'
        })
      },
      {
        name: '组合框画',
        enName: 'FRAME SET',
        sortOrder: 5,
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
    name: '衍生品',
    enName: 'MERCHANDISE',
    sortOrder: 6,
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
  群山回响: '矿石馆',
  植物探微: '植物馆',
  无尽海洋: '海洋馆',
  动物类: '动物馆',
  昆虫: '昆虫馆',
  植物: '植物馆',
  海洋: '海洋馆',
  矿石: '矿石馆',
  矿物: '矿石馆'
}

/** 旧二级名 → 新二级名（便于 upsert 迁移） */
const LEGACY_CHILD_ALIASES = {
  蝴蝶: '鳞翅目 · 蝴蝶',
  甲虫: '鞘翅目 · 甲虫',
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
  buildCategoryDoc,
  tax
}
