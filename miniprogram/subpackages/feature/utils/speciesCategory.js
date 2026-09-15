/**
 * 根据分类学信息推断图鉴大类（与六馆 shortName 对齐）
 */

const CLASS_HINTS = [
  { keys: ['insecta', '昆虫纲'], category: '昆虫' },
  { keys: ['magnoliopsida', 'liliopsida', '双子叶', '单子叶', '木兰纲', 'plantae'], category: '植物' },
  { keys: ['mammalia', 'aves', 'reptilia', 'amphibia', '哺乳纲', '鸟纲', '爬行纲', '两栖纲'], category: '动物' },
  {
    keys: ['actinopterygii', 'chondrichthyes', 'cephalopoda', 'gastropoda', 'bivalvia', 'anthozoa', '硬骨鱼', '软骨鱼', '腹足', '双壳', '头足'],
    category: '海洋'
  },
  { keys: ['mineral', '矿物', 'crystall', '石英', '方解石', 'amethyst'], category: '矿石' }
]

function normalize(s) {
  return (s || '').toLowerCase()
}

/**
 * @param {object} taxonomy
 * @param {string} speciesNameZh
 * @returns {string} 昆虫 | 矿石 | 植物 | 海洋 | 动物 | 衍生品 | 其他
 */
function inferCollectionCategory(taxonomy, speciesNameZh) {
  const cls = normalize(taxonomy && taxonomy.class)
  const phy = normalize(taxonomy && taxonomy.phylum)
  const order = normalize(taxonomy && taxonomy.order)
  const zh = speciesNameZh || ''
  const blob = `${cls} ${phy} ${order} ${zh}`

  for (const row of CLASS_HINTS) {
    for (const k of row.keys) {
      if (blob.toLowerCase().includes(k.toLowerCase())) {
        return row.category
      }
    }
  }

  if (/衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒|卡片|陈饰|联名/.test(zh)) return '衍生品'
  if (/蝶|蛾|甲虫|蜂|蚁|蜻蜓|螳螂|虫/.test(zh)) return '昆虫'
  if (/藻|草|树|花|兰|蕨|木|竹|藤|植物|种子|果实/.test(zh)) return '植物'
  if (/鱼|虾|蟹|贝|海|鲸|豚|珊瑚|螺|蚝|藻/.test(zh)) return '海洋'
  if (/矿|晶|石|玉|玛瑙|水晶|紫晶|石英/.test(zh)) return '矿石'
  if (/鸟|兽|龟|蛇|蛙|哺乳|爬行/.test(zh)) return '动物'

  return '其他'
}

/** 图鉴 Tab 列表（与 categories 六馆 shortName 一致） */
const ATLAS_TAB_LIST = ['全部', '昆虫', '矿石', '植物', '海洋', '动物', '衍生品', '其他']

module.exports = {
  inferCollectionCategory,
  ATLAS_TAB_LIST
}
