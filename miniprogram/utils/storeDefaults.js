/**
 * 这有山 · 双门店默认配置
 * S1: 山海造物（山腰·主店） / 星宸标本工作室（楼下·工坊）
 * 门店大图走云存储 CDN，见 config/storeMediaCdn.js
 */

const media = require('../config/storeMediaCdn')

const DEFAULT_STORE_ID = 'store_shanhaizaowu'

const DEFAULT_STORES = [
  {
    storeId: 'store_shanhaizaowu',
    name: '山海造物',
    nameEn: 'SHANHAI CREATIONS',
    role: 'main',
    roleLabel: '品牌主店',
    locationLabel: '这有山 · 山腰',
    mallName: '这有山',
    floor: '山坡 X-06-1',
    address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1',
    latitude: 43.86661,
    longitude: 125.29306,
    phone: '18519110274',
    hours: { open: '10:00', close: '22:00', note: '' },
    coverImage: media.STORE_COVER.store_shanhaizaowu,
    heroTagline: '像走进一间暖光标本馆',
    intro: '山海造物主店位于这有山山腰，陈列昆虫、矿物、植物与海洋标本，可现场选购与预约参观。',
    features: ['入店参观', '馆藏零售', '品牌体验'],
    visitTips: [
      '从商场主入口进入，沿山坡动线至 X-06-1',
      '建议错峰参观，周末下午客流较多',
      '展柜内标本请勿触摸，如需协助可联系店员'
    ],
    isDefault: true,
    sort: 1,
    status: 'active',
    walkingGuide: {
      peerStoreId: 'store_xingchen',
      headline: '下楼到星宸 · 步行约 5 分钟',
      steps: [
        '从山海造物主店出发，沿商场山坡动线至下行扶梯',
        '乘扶梯至楼下层，沿标识前往星宸标本工作室',
        '工坊承接定制确认、装裱咨询与手作课程'
      ],
      tip: '建议先逛主店选品，再到工坊确认定制方案'
    }
  },
  {
    storeId: 'store_xingchen',
    name: '星宸标本工作室',
    nameEn: 'STELLAR SPECIMEN STUDIO',
    role: 'workshop',
    roleLabel: '标本工坊',
    locationLabel: '这有山 · 楼下',
    mallName: '这有山',
    floor: '楼下',
    address: '吉林省长春市朝阳区红旗街959号这有山商场楼下',
    latitude: 43.828984,
    longitude: 125.289355,
    phone: '18519110274',
    hours: { open: '10:00', close: '22:00', note: '' },
    coverImage: media.STORE_COVER.store_xingchen,
    heroTagline: '标本定制与手作的工作室空间',
    intro: '星宸标本工作室承接标本装裱、标品与伴宠定制确认、手作课程等工坊服务。',
    features: ['标本工坊', '定制确认', '手作课程'],
    visitTips: [
      '位于这有山楼下，与山海造物主店步行约 5 分钟',
      '定制与伴宠方案确认建议提前预约到店',
      '手作课程名额有限，可在小程序内在线报名'
    ],
    isDefault: false,
    sort: 2,
    status: 'active',
    walkingGuide: {
      peerStoreId: 'store_shanhaizaowu',
      headline: '上山到山海造物 · 步行约 5 分钟',
      steps: [
        '从星宸标本工作室出发，沿标识至上行扶梯',
        '乘扶梯至山坡层 X-06-1，沿动线进入标本馆',
        '主店陈列昆虫、矿物、植物与海洋标本，可现场选购'
      ],
      tip: '定制方案确认后，可上楼主店挑选标本与礼盒'
    }
  }
]

const { shanhaizaowu: SHM, xingchenCover: XC } = media

const DEFAULT_ZONES = [
  {
    zoneId: 'zone_insect',
    storeId: 'store_shanhaizaowu',
    title: '神奇昆虫柜',
    overline: 'INSECTA',
    desc: '蝴蝶与甲虫标本沿柜陈列，闪蝶、鸟翼蝶与组合框画，每件配有物种信息。',
    longDesc: '柜内按目科分区陈列：闪蝶与鸟翼蝶占据视觉中心，甲虫与螳螂则藏在意想不到的角度。每件标本配有铜牌标注——中文名、拉丁学名与产地，像博物馆里被认真阅读的一页。若你第一次来，建议先找一只闪蝶，换个角度看翅面的结构色。',
    featuredSpecies: [
      { nameZh: '大蓝闪蝶', nameLatin: 'Morpho menelaus' },
      { nameZh: '金斑蝶', nameLatin: 'Danaus plexippus' }
    ],
    relatedProductIds: [],
    relatedWikiIds: [],
    categoryTag: 'INSECTA',
    coverImage: SHM.insectCover,
    images: SHM.insectImages,
    sort: 1
  },
  {
    zoneId: 'zone_mineral',
    storeId: 'store_shanhaizaowu',
    title: '群山回响',
    overline: 'MINERALS',
    desc: '羊角、爬行动物与陆地标本，亦有晶洞与矿石，呈现大地的色彩与几何。',
    longDesc: '这一柜讲「大地的几何」：晶洞剖面、紫水晶簇与矿物标本并置，旁边是陆地生态的爬行动物与角制品。冷色晶体与暖色骨骼在同一视线里对话——不是装饰性的堆砌，而是按质感与来源策展。',
    featuredSpecies: [
      { nameZh: '紫水晶晶洞', nameLatin: 'Amethyst geode' }
    ],
    relatedProductIds: [],
    relatedWikiIds: [],
    categoryTag: 'MINERALS',
    coverImage: SHM.mineralCover,
    images: SHM.mineralImages,
    sort: 2
  },
  {
    zoneId: 'zone_plant',
    storeId: 'store_shanhaizaowu',
    title: '植物探微',
    overline: 'PLANTAE',
    desc: '押花、果实与种子标本，亦有植物元素首饰，记录叶片与花的细微结构。',
    longDesc: '植物柜区偏安静：押花保留叶片脉络，干燥果实与种子标本则把季节封存在玻璃里。部分作品与植物主题首饰相邻陈列——从标本到佩戴，是同一条自然观察线的延伸。',
    featuredSpecies: [
      { nameZh: '尤加利押花', nameLatin: 'Eucalyptus' }
    ],
    relatedProductIds: [],
    relatedWikiIds: [],
    categoryTag: 'PLANTAE',
    coverImage: SHM.plantCover,
    images: SHM.plantImages,
    sort: 3
  },
  {
    zoneId: 'zone_marine',
    storeId: 'store_shanhaizaowu',
    title: '无尽海洋',
    overline: 'MARINE',
    desc: '螃蟹、河豚、贝壳与深海物种，湿标本与框画并列，感受来自深海的安静蓝色。',
    longDesc: '海洋区以深蓝与透明介质为主：螃蟹与贝壳的硬壳、河豚的轮廓、深海物种的奇形，在灯光下像被放慢的海浪。湿标本与框画并列，方便近看细节——适合在这里停久一点。',
    featuredSpecies: [
      { nameZh: '冠螺', nameLatin: 'Cassis cornuta' }
    ],
    relatedProductIds: [],
    relatedWikiIds: [],
    categoryTag: 'MARINE',
    coverImage: SHM.marineCover,
    images: SHM.marineImages,
    sort: 4
  },
  {
    zoneId: 'zone_gift',
    storeId: 'store_shanhaizaowu',
    title: '出口赠礼',
    overline: 'GIFT',
    desc: '包装、物种卡与礼盒动线，把一件标本变成可送出的礼物。',
    categoryTag: 'GIFT',
    sort: 5
  },
  {
    zoneId: 'zone_atelier',
    storeId: 'store_xingchen',
    title: '标本工坊',
    overline: 'ATELIER',
    desc: '装裱台、框型样品与定制流程说明，标品与伴宠方案可在此确认。',
    categoryTag: 'ATELIER',
    coverImage: XC,
    images: [XC],
    sort: 1
  },
  {
    zoneId: 'zone_framing',
    storeId: 'store_xingchen',
    title: '装裱与包装',
    overline: 'FRAMING',
    desc: '框型、礼盒与卡片样式现场选配，与线上标本工坊选项一致。',
    categoryTag: 'FRAMING',
    coverImage: XC,
    images: [XC],
    sort: 2
  },
  {
    zoneId: 'zone_course',
    storeId: 'store_xingchen',
    title: '手作课堂',
    overline: 'WORKSHOP',
    desc: '标本相关手作课程在此进行，可预约名额并领取材料包。',
    categoryTag: 'WORKSHOP',
    coverImage: XC,
    images: [XC],
    sort: 3
  }
]

const STORE_SERVICES = [
  { id: 'visit', label: '入店参观', tab: 0, storeRoles: ['main', 'workshop'] },
  { id: 'course', label: '手作课程', tab: 1, storeRoles: ['workshop'] },
  { id: 'activity', label: '特别活动', tab: 2, storeRoles: ['main', 'workshop'] },
  { id: 'custom', label: '定制到店确认', tab: 0, storeRoles: ['workshop'], path: 'custom' },
  { id: 'hub', label: '标本工坊', tab: -1, storeRoles: ['workshop'], path: '/pages/custom/hub/index' },
  { id: 'support', label: '联系专员', tab: -1, storeRoles: ['main', 'workshop'], path: '/pages/user/support/index' }
]

module.exports = {
  DEFAULT_STORE_ID,
  DEFAULT_STORES,
  DEFAULT_ZONES,
  STORE_SERVICES
}
