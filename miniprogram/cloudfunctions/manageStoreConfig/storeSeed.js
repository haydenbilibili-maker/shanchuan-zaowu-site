const media = require('./storeMediaCdn')
const { shanhaizaowu: SHM, xingchenCover: XC } = media

const DEFAULT_STORES = [
  {
    storeId: 'store_shanhaizaowu',
    name: '山川造物',
    nameEn: 'SHANCHUAN CREATIONS',
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
    intro: '主店位于这有山山腰，陈列昆虫、矿物、植物与海洋标本，可现场选购与预约参观。',
    features: ['入店参观', '馆藏零售', '品牌体验'],
    isDefault: true,
    sort: 1,
    status: 'active'
  },
  {
    storeId: 'store_xingchen',
    name: '星宸标本',
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
    intro: '楼下工坊承接标本装裱、标品与伴宠定制确认、手作课程等服务。',
    features: ['标本工坊', '定制确认', '手作课程'],
    isDefault: false,
    sort: 2,
    status: 'active'
  }
]

const DEFAULT_ZONES = [
  { zoneId: 'zone_insect', storeId: 'store_shanhaizaowu', title: '蝴蝶昆虫柜', overline: 'INSECTA', desc: '蝴蝶与甲虫标本沿柜陈列，闪蝶、鸟翼蝶与组合框画。', categoryTag: 'INSECTA', coverImage: SHM.insectCover, images: SHM.insectImages, sort: 1, status: 'active' },
  { zoneId: 'zone_mineral', storeId: 'store_shanhaizaowu', title: '矿石标本柜', overline: 'MINERALS', desc: '羊角、爬行动物与陆地标本，亦有晶洞与矿石。', categoryTag: 'MINERALS', coverImage: SHM.mineralCover, images: SHM.mineralImages, sort: 2, status: 'active' },
  { zoneId: 'zone_plant', storeId: 'store_shanhaizaowu', title: '植物果实柜', overline: 'PLANTAE', desc: '押花、果实与种子标本，亦有植物元素首饰。', categoryTag: 'PLANTAE', coverImage: SHM.plantCover, images: SHM.plantImages, sort: 3, status: 'active' },
  { zoneId: 'zone_marine', storeId: 'store_shanhaizaowu', title: '海洋标本柜', overline: 'MARINE', desc: '螃蟹、河豚、贝壳与深海物种，湿标本与框画并列。', categoryTag: 'MARINE', coverImage: SHM.marineCover, images: SHM.marineImages, sort: 4, status: 'active' },
  { zoneId: 'zone_gift', storeId: 'store_shanhaizaowu', title: '出口赠礼', overline: 'GIFT', desc: '包装、物种卡与礼盒动线。', categoryTag: 'GIFT', sort: 5, status: 'active' },
  { zoneId: 'zone_atelier', storeId: 'store_xingchen', title: '标本工坊', overline: 'ATELIER', desc: '装裱台、框型样品与定制流程说明。', categoryTag: 'ATELIER', coverImage: XC, images: [XC], sort: 1, status: 'active' },
  { zoneId: 'zone_framing', storeId: 'store_xingchen', title: '装裱与包装', overline: 'FRAMING', desc: '框型、礼盒与卡片样式现场选配。', categoryTag: 'FRAMING', coverImage: XC, images: [XC], sort: 2, status: 'active' },
  { zoneId: 'zone_course', storeId: 'store_xingchen', title: '手作课堂', overline: 'WORKSHOP', desc: '标本相关手作课程在此进行。', categoryTag: 'WORKSHOP', coverImage: XC, images: [XC], sort: 3, status: 'active' }
]

module.exports = { DEFAULT_STORES, DEFAULT_ZONES }
