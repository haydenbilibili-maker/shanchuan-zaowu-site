/**
 * 山海图鉴目录 · feature 分包（与 cloudfunctions/manageAtlas/catalog.js 同步）
 * 卷一（2026-11-22 扩至 80 张：原 16 张 × 5，编号 001–080；2026-11-23 再扩至 200 张，编号 001–200；十五章，200 页每页恰好归一章，前三章与成就绑定的页集不变）
 * 文案守则：主语是光 / 季节 / 时刻 / 颜色 / 编号；标本不做主语。
 * 不写「治愈 / 神奇」浮词；限定是「这一批就这些」，不是「今天不买明天没了」。
 */

const RARITY = {
  common: { id: 'common', label: '普通', dots: 2, card: 'plain' },
  rare: { id: 'rare', label: '稀有', dots: 3, card: 'silver' },
  legendary: { id: 'legendary', label: '传奇', dots: 5, card: 'gold' }
}

const METHODS = {
  discover: { id: 'discover', label: '发现采集', logLabel: '在馆里被找到' },
  photo: { id: 'photo', label: '拍照采集', logLabel: '镜头记下' },
  behavior: { id: 'behavior', label: '行为采集', logLabel: '随收藏落入' },
  encounter: { id: 'encounter', label: '偶遇采集', logLabel: '碰巧遇见' }
}

const ATLAS_SERIES = [
  {
    id: 'frost',
    name: '霜降守望',
    speciesIds: ['017', '023', '018', '021'],
    blurb: '十月末到霜降前后，颜色会自己安静下来。'
  },
  {
    id: 'overwinter',
    name: '越冬者',
    speciesIds: ['001', '012', '028'],
    blurb: '翅面把一整季的光收进去，到来年还在。'
  },
  {
    id: 'mountain',
    name: '守山者',
    speciesIds: ['041', '031', '033', '015', '034', '036'],
    blurb: '石头、叶片与壳，都是山海留下的截面。'
  },
  // 2026-11-22 图鉴扩到 80 页：新增三章（原三章与成就绑定的页集不变）
  {
    id: 'armored',
    name: '甲胄者',
    speciesIds: ['044', '045', '046', '047', '048', '049', '050', '051', '052', '053', '054'],
    blurb: '鞘翅把整个身体收进一层硬壳，光在壳上走得很慢。'
  },
  {
    id: 'nocturne',
    name: '夜行者',
    speciesIds: ['055', '056', '057', '058', '059', '060', '114', '115', '116', '117'],
    blurb: '灯一亮，它们从黑里落下来，翅上带着一层粉。'
  },
  {
    id: 'tidepool',
    name: '潮间带',
    speciesIds: ['038', '039', '069', '073', '157', '159', '160', '168', '169', '171', '173', '161', '172', '170', '068'],
    blurb: '水退下去的那几个小时，海把一些形状留在礁石上。'
  },
  // 2026-11-23 图鉴扩到 200 页：再加四章（原六章页集不变）
  {
    id: 'jewel',
    name: '宝石甲',
    speciesIds: ['106', '107', '108', '109', '110', '111', '112', '113'],
    blurb: '光落在壳上碎成一层彩，颜色是角度给的。'
  },
  {
    id: 'meadow',
    name: '原野花事',
    speciesIds: ['126', '127', '128', '129', '130', '142', '026', '027', '087', '101', '102', '103', '035', '037', '065', '131', '132', '133', '135', '137', '138', '139', '140', '141', '149', '064', '067', '143', '134'],
    blurb: '一季的花压进纸里，颜色走得比那个下午慢一点。'
  },
  {
    id: 'shellroad',
    name: '贝壳之路',
    speciesIds: ['151', '152', '153', '154', '164', '167', '070', '071', '155', '156', '158', '162', '163', '165', '166', '174', '175', '072'],
    blurb: '贝壳做过钱，也做过路标；潮水把它们一枚一枚推上岸。'
  },
  {
    id: 'deeptime',
    name: '深时',
    speciesIds: ['187', '188', '189', '190', '200'],
    blurb: '琥珀、菊石、三叶虫与陨铁，时间在它们身上按万年计。'
  },
  // 2026-11-23 凑满十二章（卷章卡三张一行，四行整）
  {
    id: 'swallowtail',
    name: '燕尾',
    speciesIds: ['081', '082', '083', '085', '086', '094', '002', '003', '005', '006', '007', '008', '010', '011', '013', '084'],
    blurb: '后翅拖着一截尾突，飞起来身后总跟着一道影子。'
  },
  {
    id: 'refraction',
    name: '折光',
    speciesIds: ['176', '177', '179', '185', '192', '197', '076', '077', '078', '079', '178', '184', '193', '198', '199', '191'],
    blurb: '光走进去，被分开、被折回、被点亮，出来时已不是原来的样子。'
  },
  // 2026-11-23 全册归章（产品负责人「图鉴已有 200，章节中数量不足 200」）：再加三章，200 页每页恰好一章
  {
    id: 'wings',
    name: '翅影',
    speciesIds: ['009', '024', '091', '092', '093', '004', '099', '105', '088', '089', '090', '042', '019', '020', '022', '014', '016', '025', '095', '096', '097', '098', '100', '043', '104', '029', '061', '062', '063', '118', '119', '120'],
    blurb: '闪蝶的蓝、蛱蝶的斑、蜻蜓的网，翅膀在光里各有各的写法。'
  },
  {
    id: 'understory',
    name: '林下与孑遗',
    speciesIds: ['030', '121', '122', '123', '125', '136', '145', '146', '148', '032', '066', '150', '124', '144', '147'],
    blurb: '落叶、蕨与苔，还有几株从冰期前一路活下来的树。'
  },
  {
    id: 'lode',
    name: '矿脉',
    speciesIds: ['040', '074', '075', '080', '180', '181', '182', '183', '186', '194', '195', '196'],
    blurb: '颜色藏在石头里，要等一道裂缝，或者一把锤子。'
  }
]

const ATLAS_SPOTS = [
  { id: 's1', speciesId: '001', storeId: 'store_shanhaizaowu', hint: '主店一层，蝴蝶昆虫柜深处' },
  { id: 's2', speciesId: '018', storeId: 'store_shanhaizaowu', hint: '主店走廊尽头' },
  { id: 's3', speciesId: '041', storeId: 'store_shanhaizaowu', hint: '矿石标本柜' },
  { id: 's4', speciesId: '031', storeId: 'store_xingchen', hint: '工坊角落的工作台' },
  { id: 's5', speciesId: '033', storeId: 'store_shanhaizaowu', hint: '海洋标本柜下层' }
]

/** 霜降：2026 年为 10 月 23 日；取当日与次日，避免时区把这一天漏掉 */
function isFrostDescent(date) {
  const cst = toCst(date || new Date())
  return cst.getMonth() === 9 && (cst.getDate() === 23 || cst.getDate() === 24)
}

function toCst(date) {
  const d = date instanceof Date ? date : new Date(date)
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  return new Date(utc + 8 * 3600000)
}

const ATLAS_SPECIES = [
  {
    id: '001',
    no: '001',
    nameZh: '大蓝闪蝶',
    nameLatin: 'Morpho menelaus',
    category: '昆虫',
    rarity: 'common',
    origin: '中美洲至南美北部雨林',
    habit: '林冠中层滑翔，取食发酵果实与树液',
    collectHint: '拍照识别，或在主店蝴蝶昆虫柜深处被找到',
    seriesIds: ['overwinter'],
    aliases: ['大蓝闪蝶', '大蓝闪蝶', 'Morpho menelaus', 'Morpho', '闪蝶'],
    essay:
      '雨林中层的光，走过鳞片时会停一下。那不是染料能做出的蓝，是微观结构把白光拆开，再只把这一段送回来。换一个角度，它会自己暗下去。'
  },
  {
    id: '012',
    no: '012',
    nameZh: '金斑蝶',
    nameLatin: 'Danaus plexippus',
    category: '昆虫',
    rarity: 'common',
    origin: '美洲；迁徙种群随季节跨越大陆',
    habit: '以萝藦科为寄主，成虫作长距离迁徙',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['overwinter'],
    aliases: ['金斑蝶', '黑脉金斑蝶', 'Danaus plexippus', 'monarch'],
    essay:
      '橙色不是为了被注意，是为了在很长的路上还被认出来。翅脉把颜色分成一块一块，像迁徙时记下的站名。有些个体会飞过整个冬天还没到的地方。'
  },
  {
    id: '017',
    no: '017',
    nameZh: '雅灰蝶',
    nameLatin: 'Celastrina argiolus',
    category: '昆虫',
    rarity: 'common',
    origin: '古北界林缘与庭园',
    habit: '霜降之后更常停在枯叶与墙根，翅背拟态树皮',
    collectHint: '拍照识别；霜降前后在馆中更容易被看见',
    seriesIds: ['frost'],
    aliases: ['雅灰蝶', '霍氏灰蝶', 'Celastrina argiolus', '灰蝶'],
    essay:
      '霜降之后，安静的颜色会落在枯叶上。这种灰蝶翅膀背面像树皮，正面却是很浅的蓝。十月末的清晨，露水重的时候，能看见它在墙边收着翅膀。'
  },
  {
    id: '018',
    no: '018',
    nameZh: '枯叶蛱蝶',
    nameLatin: 'Kallima inachus',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚至南亚的阔叶林',
    habit: '停栖时翅背完全拟态枯叶，连叶脉与霉斑一并写下',
    collectHint: '在走廊尽头被找到，或拍照识别',
    seriesIds: ['frost'],
    aliases: ['枯叶蛱蝶', '枯叶蝶', 'Kallima inachus'],
    essay:
      '秋天把叶子的写法教给了翅背：主脉、虫蛀、一点干裂。合起来的时候，它不是蝴蝶，是地上那片还没被风翻走的叶子。只有掀开正面，橙色才肯出来。'
  },
  {
    id: '031',
    no: '031',
    nameZh: '银杏押花',
    nameLatin: 'Ginkgo biloba',
    category: '植物',
    rarity: 'common',
    origin: '中国；现作行道与庭园栽培',
    habit: '扇形叶，秋末转黄后最适合压制保存',
    collectHint: '工坊角落的工作台，或收藏对应押花藏品',
    seriesIds: ['mountain'],
    aliases: ['银杏押花', '银杏', '白果', 'Ginkgo biloba', '押花'],
    essay:
      '扇形的黄不是一下子来的，是叶绿素先退场。压进纸页之后，脉络还在原来的位置。这一页记下的不是一棵树，是它决定把夏天交出去的那个下午。'
  },
  {
    id: '033',
    no: '033',
    nameZh: '鹦鹉螺',
    nameLatin: 'Nautilus pompilius',
    category: '海洋',
    rarity: 'common',
    origin: '西太平洋至印度洋深浅交界',
    habit: '壳室充气调节浮力，夜间更贴近上层',
    collectHint: '海洋标本柜下层，或拍照识别壳体',
    seriesIds: ['mountain'],
    aliases: ['鹦鹉螺', 'Nautilus pompilius', 'Nautilus', '鹦鹉螺壳'],
    essay:
      '螺塔按等角螺线往外长，每一室都是上一室的回忆。切开以后，隔板像年轮。光从切面走进去，会在最老的那一室停住。'
  },
  {
    id: '041',
    no: '041',
    nameZh: '紫水晶',
    nameLatin: 'Amethyst',
    category: '矿石',
    rarity: 'common',
    origin: '巴西、乌拉圭等热液晶洞',
    habit: '石英族，紫色来自微量铁与辐照色心',
    collectHint: '矿石标本柜，或收藏对应矿物藏品',
    seriesIds: ['mountain'],
    aliases: ['紫水晶', '紫晶', 'Amethyst', '紫水晶晶洞', '晶洞'],
    essay:
      '紫色停在晶体里，是铁和光后来才加上去的句子。晶洞内侧长满尖锥，像山把一口井翻过来。手电斜着照，尖端会先亮。'
  },
  {
    id: '023',
    no: '023',
    nameZh: '血漪蛱蝶',
    nameLatin: 'Cethosia biblis',
    category: '昆虫',
    rarity: 'rare',
    origin: '东南亚至中国南部林缘',
    habit: '翅表朱红由外缘向内晕开；霜降前后飞得更慢',
    collectHint: '霜降当日到店，才会被写进这一页',
    seriesIds: ['frost'],
    season: 'frost',
    aliases: ['血漪蛱蝶', '红锯蛱蝶', 'Cethosia biblis', '血斑蛱蝶'],
    essay:
      '十月的颜色，到它这里最深。红色不是夺目的那种，是从翅尖慢慢漫进去的。霜降前后，这种蝴蝶才安静下来，可以被慢慢看见。'
  },
  {
    id: '028',
    no: '028',
    nameZh: '绿鸟翼凤蝶',
    nameLatin: 'Ornithoptera priamus',
    category: '昆虫',
    rarity: 'rare',
    origin: '新几内亚至北澳雨林',
    habit: '雄蝶翅面金属绿，大型凤蝶，飞行缓慢',
    collectHint: '时令在馆时拍照或收藏对应藏品',
    seriesIds: ['overwinter'],
    aliases: ['绿鸟翼凤蝶', '鸟翼凤蝶', 'Ornithoptera priamus', '鸟翼蝶'],
    essay:
      '绿色在这么大的翅面上会显得很慢。不是草地的绿，是金属被雨打湿以后那种。它飞过林冠的时候，叶子会误认自己在动。'
  },
  {
    id: '004',
    no: '004',
    nameZh: '琉璃蛱蝶',
    nameLatin: 'Kaniska canace',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚林缘、庭园与河谷',
    habit: '冬型翅面偏蓝紫，夏型转褐；喜停在枯枝与石上',
    collectHint: '拍照识别；馆内蝴蝶昆虫柜亦可见',
    seriesIds: ['wings'],
    aliases: ['琉璃蛱蝶', '琉璃蛱蝶', 'Kaniska canace', 'Kaniska'],
    essay:
      '冬天把蓝色收短，夏天把褐色还回去。同一枚翅面，一年写两遍。停在枯枝上的时候，颜色几乎不说话。'
  },
  {
    id: '006',
    no: '006',
    nameZh: '柑橘凤蝶',
    nameLatin: 'Papilio xuthus',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚至西伯利亚南部',
    habit: '幼虫取食芸香科；成虫沿林缘与果园巡飞',
    collectHint: '拍照识别；庭园与馆门口都容易被看见',
    seriesIds: ['swallowtail'],
    aliases: ['柑橘凤蝶', '柑橘凤蝶', 'Papilio xuthus'],
    essay:
      '黄与黑排成一行，像果园把季节画在翅膀上。它飞过的路不长，从树下到门前，被认出来的次数却很多。'
  },
  {
    id: '015',
    no: '015',
    nameZh: '萤石',
    nameLatin: 'Fluorite',
    category: '矿石',
    rarity: 'common',
    origin: '热液脉中；常见于湖南、江西等地',
    habit: '立方或八面体解理；部分晶体在紫外下发荧光',
    collectHint: '矿石标本柜中的晶体；或收藏对应矿物',
    seriesIds: ['mountain'],
    aliases: ['萤石', '萤石', 'Fluorite', '萤石晶体'],
    essay:
      '紫外灯一开，颜色才肯从格子里出来。关掉以后，晶体仍是晶体，只是把那句荧光收回去了。'
  },
  {
    id: '021',
    no: '021',
    nameZh: '大红蛱蝶',
    nameLatin: 'Vanessa indica',
    category: '昆虫',
    rarity: 'common',
    origin: '东亚至喜马拉雅林缘',
    habit: '成虫春秋可见，喜访菊科与荨麻科附近',
    collectHint: '拍照识别；霜降前后在馆外也更容易遇见',
    seriesIds: ['frost'],
    aliases: ['大红蛱蝶', '大红蛱蝶', 'Vanessa indica'],
    essay:
      '砖红不是节日的红。翅缘有一圈碎白点，像秋天把路走完后留下的记号。它不急着停，也不急着被写成藏品。'
  },
  {
    id: '034',
    no: '034',
    nameZh: '唐冠螺',
    nameLatin: 'Cassis cornuta',
    category: '海洋',
    rarity: 'common',
    origin: '印度洋至西太平洋暖水浅海',
    habit: '厚唇壳口，栖于砂质底，夜行觅食海胆',
    collectHint: '海洋标本柜；或拍照识别壳体',
    seriesIds: ['mountain'],
    aliases: ['唐冠螺', '唐冠螺', 'Cassis cornuta', '冠螺'],
    essay:
      '壳口那一圈厚唇，是沙底把时间攒下来的边。拿起来会沉。光从唇缘滑进去，停在最深的那一转。'
  },
  {
    id: '036',
    no: '036',
    nameZh: '莲花押花',
    nameLatin: 'Nelumbo nucifera',
    category: '植物',
    rarity: 'common',
    origin: '东亚浅水；花瓣适于压制保存',
    habit: '花瓣宽薄，失水后仍留脉纹',
    collectHint: '工坊押花台，或收藏对应押花页',
    seriesIds: ['mountain'],
    aliases: ['莲花押花', '荷花押花', 'Nelumbo nucifera', '莲瓣'],
    essay:
      '花瓣被压进纸页以后，粉才慢慢退成旧纸的颜色。脉络还在原处。这一页记下的不是盛开，是水把花交出去的那个早晨。'
  },
  {
    id: '009',
    no: '009',
    nameZh: '光明女神闪蝶',
    nameLatin: 'Morpho helena',
    category: '昆虫',
    rarity: 'legendary',
    origin: '南美热带雨林',
    habit: '结构色蓝随入射角改变；本店编码款对应证书编号',
    collectHint: '持有编码款藏品后写入；编号 001–004',
    seriesIds: ['wings'],
    numbered: { from: '001', to: '004' },
    aliases: ['光明女神闪蝶', 'Morpho helena', '海伦娜闪蝶', '编码闪蝶'],
    essay:
      '编号 001–004。这一批，到此为止。鳞片折射出的蓝色，需要光很慢地走过去才看得全。证书上的编号，和它一样，只有这些。'
  },
  // ——— 2026-11-22 图鉴扩到 80 页（原 16 页 × 5）：新增 64 页，编号补齐 001–080 ———
  {
    id: '002',
    no: '002',
    nameZh: '巴黎翠凤蝶',
    nameLatin: 'Papilio paris',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南部至东南亚的山地森林',
    habit: '雄蝶常在溪边湿地吸水，幼虫取食芸香科植物',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['巴黎翠凤蝶', 'Papilio paris', '翠凤蝶', 'Papilio'],
    essay:
      '黑色的底子上撒满绿色鳞粉，像夜里落了一层细雨。后翅中央那块蓝绿色的斑，在侧光下会忽然亮起来，正对着看反而沉静。它在溪石上吸水时，翅膀一开一合，很少停满三秒。'
  },
  {
    id: '003',
    no: '003',
    nameZh: '金斑喙凤蝶',
    nameLatin: 'Teinopalpus aureus',
    category: '昆虫',
    rarity: 'legendary',
    origin: '中国南部及越南、老挝北部的中高山常绿阔叶林',
    habit: '多在山顶林冠上方盘旋，幼虫取食木兰科植物',
    collectHint: '拍照识别',
    seriesIds: ['swallowtail'],
    aliases: ['金斑喙凤蝶', 'Teinopalpus aureus', '金斑喙', '喙凤蝶', 'Teinopalpus'],
    essay:
      '翠绿的翅面上，后翅一块金黄色的斑，边缘镶着细窄的尾突。它是国家一级保护动物，生在云雾常驻的山脊，一年里只在很短的晴日露面。这里只做记录，不作收藏与买卖。'
  },
  {
    id: '005',
    no: '005',
    nameZh: '天堂凤蝶',
    nameLatin: 'Papilio ulysses',
    category: '昆虫',
    rarity: 'common',
    origin: '马鲁古群岛、新几内亚、所罗门群岛至澳大利亚东北部',
    habit: '飞行迅速，雄蝶会被蓝色物体吸引而俯冲靠近',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['swallowtail'],
    aliases: ['天堂凤蝶', 'Papilio ulysses', '英雄翠凤蝶', '尤利西斯凤蝶', 'Papilio'],
    essay:
      '正面是一整片电光蓝，四周压着宽阔的黑边，像把一块天空裁下来装进了框。合拢翅膀时只剩背面的褐黑，停在叶下几乎看不见。雨林里，它的蓝往往先于身形被看到。'
  },
  {
    id: '007',
    no: '007',
    nameZh: '红颈鸟翼凤蝶',
    nameLatin: 'Trogonoptera brookiana',
    category: '昆虫',
    rarity: 'rare',
    origin: '马来半岛、苏门答腊与婆罗洲的低地雨林',
    habit: '雄蝶成群聚集在溪岸与温泉边的湿地吸取矿物质',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['红颈鸟翼凤蝶', 'Trogonoptera brookiana', '拉贾布鲁克鸟翼凤蝶', '红颈鸟翼蝶', 'Trogonoptera'],
    essay:
      '狭长的黑翅上，一列翠绿色的斑排成锯齿，像羽毛的轮廓。颈部一圈绯红，是整只蝴蝶唯一的暖色。它们在湿沙上成片停落时，绿斑随呼吸般的振翅一闪一灭。'
  },
  {
    id: '008',
    no: '008',
    nameZh: '金裳凤蝶',
    nameLatin: 'Troides aeacus',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国南部及台湾、喜马拉雅南麓至中南半岛的林地',
    habit: '飞行舒缓多滑翔，幼虫取食马兜铃属植物',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['swallowtail'],
    aliases: ['金裳凤蝶', 'Troides aeacus', '金裳鸟翼凤蝶', '黄裳凤蝶', 'Troides'],
    essay:
      '前翅是丝绒般的黑，翅脉两侧泛着一点灰白。后翅金黄，逆光时几乎透明，黑色的脉纹像铅条嵌在彩窗里。它是国家二级保护动物，飞得很慢，在林缘的高处兜着大圈。'
  },
  {
    id: '010',
    no: '010',
    nameZh: '紫青凤蝶',
    nameLatin: 'Graphium weiskei',
    category: '昆虫',
    rarity: 'common',
    origin: '新几内亚中部山地森林',
    habit: '飞行急促，雄蝶常聚在溪边湿沙上吸水',
    collectHint: '拍照识别',
    seriesIds: ['swallowtail'],
    aliases: ['紫青凤蝶', 'Graphium weiskei', '紫斑青凤蝶', '维斯基青凤蝶', 'Graphium'],
    essay:
      '黑褐的翅面上铺着几块半透明的斑，从翠绿过渡到粉紫，颜色之间没有界线。那些斑几乎不含鳞片，光是从翅膜里透过来的。它很少停留，落下时也总是不停地扇动翅膀。'
  },
  {
    id: '011',
    no: '011',
    nameZh: '碧凤蝶',
    nameLatin: 'Papilio bianor',
    category: '昆虫',
    rarity: 'common',
    origin: '中国大部、朝鲜半岛、日本至中南半岛',
    habit: '常访百合、马缨丹等花，幼虫取食芸香科植物',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['碧凤蝶', 'Papilio bianor', '乌鸦凤蝶', '翠凤蝶', 'Papilio'],
    essay:
      '远看是一只黑蝶，走近了才发现满翅都是细碎的蓝绿色鳞片，密得像一层薄霜。后翅外缘有一排红色的新月斑，尾突细长。它在城市的公园里也常见，只是很少有人停下来看它的颜色。'
  },
  {
    id: '013',
    no: '013',
    nameZh: '双尾褐凤蝶',
    nameLatin: 'Bhutanitis thaidina',
    category: '昆虫',
    rarity: 'legendary',
    origin: '中国西南至西北部的高山林地',
    habit: '飞行缓慢，栖于高海拔林缘，幼虫取食马兜铃属植物',
    collectHint: '拍照识别',
    seriesIds: ['swallowtail'],
    aliases: ['双尾褐凤蝶', 'Bhutanitis thaidina', '双尾凤蝶', '褐凤蝶', 'Bhutanitis'],
    essay:
      '黑褐的翅上画着一道道淡黄的细纹，后翅拖着两条长短不一的尾突，靠近臀角处有一抹红与蓝。它只生活在中国的高山上，被列为国家二级保护动物。这里只做记录，不作收藏与买卖。'
  },
  {
    id: '014',
    no: '014',
    nameZh: '二尾蛱蝶',
    nameLatin: 'Polyura narcaea',
    category: '昆虫',
    rarity: 'common',
    origin: '中国华北以南至中南半岛的林地',
    habit: '喜吸食树汁与腐果，幼虫取食合欢等豆科植物',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['wings'],
    aliases: ['二尾蛱蝶', 'Polyura narcaea', '双尾蛱蝶', '二尾蝶', 'Polyura'],
    essay:
      '淡绿色的翅面被黑色的宽带分隔开，后翅末端伸出两枚细尖的尾。它飞起来快而有力，落在树干的伤口上就不肯走，口器插进渗出的汁液里，一停就是很久。'
  },
  {
    id: '016',
    no: '016',
    nameZh: '大紫蛱蝶',
    nameLatin: 'Sasakia charonda',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国东部及台湾、朝鲜半岛与日本的落叶阔叶林',
    habit: '成虫吸食栎树树汁，幼虫取食朴树叶片',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['大紫蛱蝶', 'Sasakia charonda', '大紫蝶', 'Sasakia'],
    essay:
      '雄蝶的翅基泛着深紫色的金属光泽，外侧散着白斑与黄斑，后翅臀角一点红。紫色只在某个角度出现，换个方向就褪成墨黑。夏日的栎林里，它会把别的蝴蝶从树汁边赶开。'
  },
  {
    id: '019',
    no: '019',
    nameZh: '小红蛱蝶',
    nameLatin: 'Vanessa cardui',
    category: '昆虫',
    rarity: 'common',
    origin: '除南极洲与南美洲大部外几乎遍布全球',
    habit: '著名的长距离迁飞者，幼虫多取食菊科蓟类植物',
    collectHint: '拍照识别',
    seriesIds: ['wings'],
    aliases: ['小红蛱蝶', 'Vanessa cardui', '赤蛱蝶', '花蛱蝶', 'Vanessa'],
    essay:
      '橙粉色的翅面上散着黑斑，前翅尖端缀几点白。它的体量不大，却是最能迁徙的蝴蝶之一，几代接力，可以往返于非洲与欧洲北部之间。路边一丛蓟花上的它，可能来自很远的地方。'
  },
  {
    id: '020',
    no: '020',
    nameZh: '孔雀蛱蝶',
    nameLatin: 'Aglais io',
    category: '昆虫',
    rarity: 'common',
    origin: '欧洲至亚洲温带，包括中国北方与日本',
    habit: '以成虫越冬，藏身树洞与屋檐下，幼虫取食荨麻',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['wings'],
    aliases: ['孔雀蛱蝶', 'Aglais io', 'Inachis io', '孔雀蝶', 'Aglais'],
    essay:
      '四只翅角各有一枚眼斑，蓝、黄、黑一圈圈套着，像孔雀尾羽上的那一点。翅背面却是近黑的烟褐色，合起来就是一片枯叶。冬天它躲进阴暗的角落，受惊时会忽然张翅，并发出细微的摩擦声。'
  },
  {
    id: '022',
    no: '022',
    nameZh: '黄钩蛱蝶',
    nameLatin: 'Polygonia c-aureum',
    category: '昆虫',
    rarity: 'common',
    origin: '中国大部、朝鲜半岛、日本至越南北部',
    habit: '秋型以成虫越冬，幼虫取食葎草等植物',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['黄钩蛱蝶', 'Polygonia c-aureum', '黄蛱蝶', '金钩角蛱蝶', 'Polygonia'],
    essay:
      '翅缘参差，像被剪过的纸，后翅背面有一枚银白色的小钩。夏型橙黄明亮，秋型颜色更深，翅缘也更尖。入冬后它不死去，而是收起翅膀贴在枯枝与墙缝间，等第一阵暖风。'
  },
  {
    id: '024',
    no: '024',
    nameZh: '尖翅蓝闪蝶',
    nameLatin: 'Morpho rhetenor',
    category: '昆虫',
    rarity: 'rare',
    origin: '南美洲北部，圭亚那地区至亚马孙流域及安第斯山东麓',
    habit: '雄蝶沿河道与林冠高速巡飞，很少落到地面',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['wings'],
    aliases: ['尖翅蓝闪蝶', 'Morpho rhetenor', '蓝摩尔福蝶', '雷特纳闪蝶', 'Morpho'],
    essay:
      '前翅尖而长，整面是近乎发白的冷蓝，没有一点杂纹。那层蓝来自鳞片上层层叠起的细脊，光在其间反复干涉，只留下这一段波长。雌蝶却是褐色与橙色，常年藏在林下。'
  },
  {
    id: '025',
    no: '025',
    nameZh: '猫头鹰环蝶',
    nameLatin: 'Caligo eurilochus',
    category: '昆虫',
    rarity: 'common',
    origin: '中美洲至南美洲北部的热带森林',
    habit: '多在黄昏活动，嗜食腐果，幼虫取食芭蕉科植物',
    collectHint: '拍照识别',
    seriesIds: ['wings'],
    aliases: ['猫头鹰环蝶', 'Caligo eurilochus', '猫头鹰蝶', '枭眼蝶', 'Caligo'],
    essay:
      '翅背面布满细密的波状纹，后翅中央一枚大眼斑，黄圈套着黑瞳，像是在暗处睁着。它白天多半伏在树干上，到了傍晚才贴着林下慢慢飞。正面的翅只是暗蓝与褐，很少示人。'
  },
  {
    id: '026',
    no: '026',
    nameZh: '报喜斑粉蝶',
    nameLatin: 'Delias pasithoe',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南部及台湾、印度至东南亚',
    habit: '飞行缓慢，常访花，幼虫取食桑寄生科植物',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['报喜斑粉蝶', 'Delias pasithoe', '红斑粉蝶', '红肩粉蝶', 'Delias'],
    essay:
      '翅背面是黑底，散着灰白的斑，后翅基部一块鲜红，中间夹一抹明黄。颜色是一种提醒，幼虫吃下寄生植物里的物质，让鸟儿不愿再碰第二次。它因此飞得不慌不忙。'
  },
  {
    id: '027',
    no: '027',
    nameZh: '鹤顶粉蝶',
    nameLatin: 'Hebomoia glaucippe',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南部及台湾、印度至东南亚的低山林地',
    habit: '飞行迅疾有力，幼虫取食山柑科鱼木属植物',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['鹤顶粉蝶', 'Hebomoia glaucippe', '端红蝶', '红端粉蝶', 'Hebomoia'],
    essay:
      '大片的白，在前翅尖端忽然收成一块橙红，四周描着黑边，像丹顶鹤头上那一点。它是本地体型最大的粉蝶之一，飞起来直而快。翅背面是枯叶般的灰褐，停下时便隐进落叶里。'
  },
  {
    id: '029',
    no: '029',
    nameZh: '红灰蝶',
    nameLatin: 'Lycaena phlaeas',
    category: '昆虫',
    rarity: 'common',
    origin: '欧亚大陆、北非与北美的草地，中国广布',
    habit: '雄蝶占据领地停栖草尖，幼虫取食酸模等蓼科植物',
    collectHint: '拍照识别',
    seriesIds: ['wings'],
    aliases: ['红灰蝶', 'Lycaena phlaeas', '红小灰蝶', '小灰蝶', 'Lycaena'],
    essay:
      '翅展不过三厘米，前翅是带金属感的橙红，撒着几粒黑点，外缘一圈暗褐。它常停在草尖上晒太阳，有别的蝴蝶飞过便起身驱赶，再回到原处。小，却很有分寸。'
  },
  {
    id: '030',
    no: '030',
    nameZh: '枫叶押花',
    nameLatin: 'Acer palmatum',
    category: '植物',
    rarity: 'common',
    origin: '原产中国、日本与朝鲜半岛，浙江、安徽山地多见',
    habit: '叶掌状五至七深裂，边缘有重锯齿，秋季转红',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['understory'],
    aliases: ['枫叶押花', '鸡爪槭', '红枫', 'Acer palmatum', '押花'],
    essay:
      '红是从叶尖开始的，一裂一裂往叶柄退。压平之后，七道裂片仍朝着原来的方向张开，像一只停在半空的手。纸页吸走了水分，没有吸走那一点迟疑的橙。'
  },
  {
    id: '032',
    no: '032',
    nameZh: '铁线蕨标本',
    nameLatin: 'Adiantum capillus-veneris',
    category: '植物',
    rarity: 'common',
    origin: '中国长江以南及西南各省，生于石灰岩溪边与湿石壁',
    habit: '叶柄紫黑光亮如铁丝，小羽片扇形，喜阴湿石灰岩',
    collectHint: '拍照识别',
    seriesIds: ['understory'],
    aliases: ['铁线蕨', '少女的发丝', 'Adiantum capillus-veneris', '蕨类标本'],
    essay:
      '它的叶柄细而黑，硬得像一段旧铁丝。小羽片一枚枚是扇形，边缘向内卷起，背面藏着孢子囊群。它不开花，只在潮湿的石缝里，用另一种方式把自己传下去。'
  },
  {
    id: '035',
    no: '035',
    nameZh: '绣球押花',
    nameLatin: 'Hydrangea macrophylla',
    category: '植物',
    rarity: 'common',
    origin: '原产日本，中国长江流域及以南广泛栽培',
    habit: '观赏的花瓣实为不孕花萼片，花色随土壤酸碱变化',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['绣球押花', '绣球花', '八仙花', 'Hydrangea macrophylla', '押花'],
    essay:
      '人们以为的花瓣，其实是四枚萼片，真正的花小得几乎看不见。酸性的土让它偏蓝，碱性的土让它偏粉。压进纸里的这一朵，记住的是某一块土地的脾气。'
  },
  {
    id: '037',
    no: '037',
    nameZh: '薰衣草标本',
    nameLatin: 'Lavandula angustifolia',
    category: '植物',
    rarity: 'common',
    origin: '原产地中海沿岸，法国普罗旺斯与新疆伊犁霍城大面积种植',
    habit: '唇形科半灌木，轮伞花序集成穗状，全株含芳香油',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['薰衣草', '狭叶薰衣草', 'lavender', 'Lavandula angustifolia', '干花'],
    essay:
      '紫色的小花沿着一根茎排成层层的轮，干燥之后颜色会淡一些。气味却藏得更深，指腹轻轻一碾，花萼里的油腺还会醒过来。它比别的标本更难安静地待在纸上。'
  },
  {
    id: '038',
    no: '038',
    nameZh: '水字螺',
    nameLatin: 'Lambis lambis',
    category: '海洋',
    rarity: 'common',
    origin: '印度—西太平洋珊瑚礁浅海，中国海南、西沙群岛与台湾',
    habit: '外唇伸出六枚弯棘，形似水字，栖于珊瑚礁浅滩',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['tidepool'],
    aliases: ['水字螺', '蜘蛛螺', 'spider conch', 'Lambis lambis', '凤螺'],
    essay:
      '壳口外缘伸出六根弯曲的长棘，翻过来看，正像一个写在沙上的水字。这些棘是成年之后才长出的，幼螺的外唇还是薄的。它在礁坪上靠一枚角质的厣跳着前行。'
  },
  {
    id: '039',
    no: '039',
    nameZh: '虎斑宝贝',
    nameLatin: 'Cypraea tigris',
    category: '海洋',
    rarity: 'common',
    origin: '印度—西太平洋珊瑚礁，中国海南、西沙群岛与台湾南部',
    habit: '壳面釉亮布满黑褐斑点，活体外套膜包覆壳表',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['虎斑宝贝', '虎斑贝', 'tiger cowrie', 'Cypraea tigris', '宝螺'],
    essay:
      '它的光泽不是打磨出来的，活着的时候，外套膜从两侧翻上来，把整个壳包住，一层一层地上釉。斑点因此不会被磨损。古人拿它当钱，大概也是因为这份不肯褪色。'
  },
  {
    id: '040',
    no: '040',
    nameZh: '黄铁矿',
    nameLatin: 'Pyrite',
    category: '矿石',
    rarity: 'common',
    origin: '西班牙拉里奥哈纳瓦洪、秘鲁，以及中国湖南、安徽等地',
    habit: '等轴晶系硫化铁，常成立方体，晶面带平行条纹',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['lode'],
    aliases: ['黄铁矿', '愚人金', 'Pyrite', 'fools gold'],
    essay:
      '它从泥岩里长出来，每一面都几乎是正方形，边角利落得像有人量过。晶面上细细的平行纹，是生长时两种晶形互相让步留下的。黄铜色的光很像金子，但它更硬，也更脆。'
  },
  {
    id: '042',
    no: '042',
    nameZh: '大帛斑蝶',
    nameLatin: 'Idea leuconoe',
    category: '昆虫',
    rarity: 'common',
    origin: '台湾、琉球群岛至东南亚的沿海林地与红树林',
    habit: '滑翔缓慢而悠长，幼虫取食夹竹桃科爬森藤',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['大帛斑蝶', 'Idea leuconoe', '大白斑蝶', '大笨蝶', 'Idea'],
    essay:
      '半透明的白翅上缀满黑色的点与脉，像一张被墨洇过的薄绢。它飞得极慢，几下扇翅之后便长长地滑行，仿佛并不急着去任何地方。幼虫从寄主植物里积下毒素，所以它不必躲。'
  },
  {
    id: '043',
    no: '043',
    nameZh: '波蚬蝶',
    nameLatin: 'Zemeros flegyas',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南部、印度至东南亚的林缘与灌丛',
    habit: '常在叶面半张翅停栖，短距跳飞，幼虫取食杜茎山',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['wings'],
    aliases: ['波蚬蝶', 'Zemeros flegyas', '蚬蝶', 'Zemeros'],
    essay:
      '红褐色的翅面上，白点沿着翅脉排成一行行，每个白点内侧都衬着一点黑。它属于蚬蝶，体形小，翅缘微微起伏。停在叶面时翅膀半张，一受惊就跳到旁边另一片叶上。'
  },
  {
    id: '044',
    no: '044',
    nameZh: '长戟大兜虫',
    nameLatin: 'Dynastes hercules',
    category: '昆虫',
    rarity: 'rare',
    origin: '中美洲至南美的山地雨林',
    habit: '成虫夜行，舔食落地腐熟果实，雄虫以长角相角力',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['armored'],
    aliases: ['长戟大兜虫', '赫拉克勒斯大兜虫', 'Dynastes hercules', '大兜虫'],
    essay:
      '胸角向前伸出，像一柄没有收鞘的戟。鞘翅是橄榄色的，会随空气的湿度慢慢转暗，干燥时又浮出零散的黑斑。它在林下行走时很慢，那对角从不急着证明什么。'
  },
  {
    id: '045',
    no: '045',
    nameZh: '南洋大兜虫',
    nameLatin: 'Chalcosoma atlas',
    category: '昆虫',
    rarity: 'common',
    origin: '东南亚的低地与丘陵森林',
    habit: '夜间活动，吸食树汁与熟果，雄虫三角用于争斗',
    collectHint: '拍照识别',
    seriesIds: ['armored'],
    aliases: ['南洋大兜虫', '阿特拉斯南洋大兜虫', 'Chalcosoma atlas', '南洋兜'],
    essay:
      '三支角从头胸间伸出，弯成一道封闭的弧。甲壳是深青铜色，暗处看是黑，侧光下才透出一层金属的绿。它把全部的分量都放在了前面，身后只留下两片安静的鞘翅。'
  },
  {
    id: '046',
    no: '046',
    nameZh: '欧洲深山锹形虫',
    nameLatin: 'Lucanus cervus',
    category: '昆虫',
    rarity: 'common',
    origin: '欧洲的古老栎树林',
    habit: '幼虫在腐朽栎木中生活数年，成虫黄昏飞行',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['armored'],
    aliases: ['欧洲深山锹形虫', '鹿角锹甲', 'Lucanus cervus', '欧洲锹甲', '锹形虫'],
    essay:
      '大颚分叉，内缘有细小的齿，像初生的鹿角。它在朽木里度过五年左右，出来之后只剩一个夏天。栗色的大颚在标本盒里依旧张着，仿佛黄昏还没有结束。'
  },
  {
    id: '047',
    no: '047',
    nameZh: '长颈鹿锯锹形虫',
    nameLatin: 'Prosopocoilus giraffa',
    category: '昆虫',
    rarity: 'common',
    origin: '印度至印度尼西亚的热带森林',
    habit: '成虫吸食树汁，夜间趋光，雄虫大颚极长',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['armored'],
    aliases: ['长颈鹿锯锹形虫', '长颈鹿锯锹', 'Prosopocoilus giraffa', '锯锹'],
    essay:
      '一对大颚几乎与身体等长，末端微微内弯，内侧排着一列锯齿。黑色的甲壳带着细密的磨砂感，不反光，只把轮廓留下。它看上去像在伸手，又像在丈量什么。'
  },
  {
    id: '048',
    no: '048',
    nameZh: '日本吉丁虫',
    nameLatin: 'Chrysochroa fulgidissima',
    category: '昆虫',
    rarity: 'common',
    origin: '日本、朝鲜半岛及中国东部的阔叶林',
    habit: '盛夏晴日绕榉、朴等高树飞行，幼虫蛀食枯木',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['armored'],
    aliases: ['日本吉丁虫', '彩虹吉丁', '玉虫', 'Chrysochroa fulgidissima', '吉丁虫'],
    essay:
      '鞘翅是绿的，两道紫红的纵纹从肩部一直落到翅端。这颜色来自甲壳表层的叠层结构，千年后也不会褪。古人曾把它的鞘翅嵌进佛龛，大约是看中了这份不肯老去的光。'
  },
  {
    id: '049',
    no: '049',
    nameZh: '毛象大兜虫',
    nameLatin: 'Megasoma elephas',
    category: '昆虫',
    rarity: 'rare',
    origin: '墨西哥南部至南美北部的低地雨林',
    habit: '成虫夜行，吸食树汁与嫩枝汁液，幼虫居朽木',
    collectHint: '拍照识别',
    seriesIds: ['armored'],
    aliases: ['毛象大兜虫', '象兜', '大象兜虫', 'Megasoma elephas'],
    essay:
      '通身覆着一层金褐色的短绒毛，像落了一层细尘。头角粗壮上扬，前胸两侧另有短角。手指拂过时绒毛会倒伏，露出底下乌黑的甲壳，片刻后又慢慢立起来。'
  },
  {
    id: '050',
    no: '050',
    nameZh: '大王花金龟',
    nameLatin: 'Goliathus goliatus',
    category: '昆虫',
    rarity: 'legendary',
    origin: '西非至中非的赤道雨林',
    habit: '成虫白天在林冠取食树汁与熟果，幼虫食腐殖质',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['armored'],
    aliases: ['大王花金龟', '歌利亚大角花金龟', '巨人花金龟', 'Goliathus goliatus', 'Goliathus'],
    essay:
      '它是世上最重的昆虫之一，幼虫期的体重能超过一枚鸡蛋。前胸背板是黑白相间的纵纹，像一块被风化的石刻。鞘翅则是浅栗色的丝绒，在林冠的光里显得格外沉静。'
  },
  {
    id: '051',
    no: '051',
    nameZh: '泰国吉丁虫',
    nameLatin: 'Sternocera aequisignata',
    category: '昆虫',
    rarity: 'common',
    origin: '泰国至中南半岛的季风林',
    habit: '成虫雨季羽化，取食豆科乔木叶片，飞行有声',
    collectHint: '拍照识别',
    seriesIds: ['armored'],
    aliases: ['泰国吉丁虫', '绿宝石吉丁', '泰国大吉丁', 'Sternocera aequisignata', 'Sternocera'],
    essay:
      '整只虫是一枚饱满的绿，带着金色的边。当地人曾把它的鞘翅缝进锦缎与舞衣，烛火一动，满身都是碎光。离开了身体，那绿依然不散，只是更安静了一些。'
  },
  {
    id: '052',
    no: '052',
    nameZh: '金属细身赤锹形虫',
    nameLatin: 'Cyclommatus metallifer',
    category: '昆虫',
    rarity: 'common',
    origin: '印度尼西亚苏拉威西岛及马鲁古群岛',
    habit: '成虫栖于林中树干，吸食树汁，雄虫大颚细长',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['armored'],
    aliases: ['金属细身赤锹形虫', '金属细身赤锹', '金属锹', 'Cyclommatus metallifer'],
    essay:
      '大颚纤长，像两根弯过的铜丝，末端交错而不相碰。全身泛着金铜与青绿的金属色，换个角度又偏向赤褐。它身形窄而薄，仿佛是为了穿过树皮的缝隙才长成这样。'
  },
  {
    id: '053',
    no: '053',
    nameZh: '黄金金龟',
    nameLatin: 'Chrysina resplendens',
    category: '昆虫',
    rarity: 'rare',
    origin: '哥斯达黎加与巴拿马的高山云雾林',
    habit: '成虫夜间活动，取食云雾林乔木叶片，具趋光性',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['armored'],
    aliases: ['黄金金龟', '光辉丽金龟', '黄金宝石金龟', 'Chrysina resplendens', 'Plusiotis resplendens'],
    essay:
      '它看上去像一粒刚出炉的金，其实甲壳里没有一点金属。层层几丁质把光拆开，只把金色送回眼睛，还把它偏转成圆偏振光。云雾林里湿漉漉的叶面上，它是最亮的一滴。'
  },
  {
    id: '054',
    no: '054',
    nameZh: '云斑白条天牛',
    nameLatin: 'Batocera horsfieldi',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南北各地至越南、印度的林地',
    habit: '幼虫蛀食杨、柳、核桃等树干，成虫啃食嫩枝皮',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['armored'],
    aliases: ['云斑白条天牛', '云斑天牛', 'Batocera horsfieldi', 'Batocera'],
    essay:
      '灰褐的鞘翅上散着几块白色绒斑，像冬日窗玻璃上的霜。触角一节节向后延伸，比身体还长出一截。它在树干上停着不动时，几乎就是树皮的一部分。'
  },
  {
    id: '055',
    no: '055',
    nameZh: '绿尾大蚕蛾',
    nameLatin: 'Actias selene',
    category: '昆虫',
    rarity: 'common',
    origin: '中国至南亚、东南亚的山地森林',
    habit: '幼虫取食枫杨、乌桕等叶，成虫口器退化不进食',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['nocturne'],
    aliases: ['绿尾大蚕蛾', '月神蛾', '水青蛾', 'Actias selene', 'Actias'],
    essay:
      '翅是极淡的青绿，像月光照过的薄纱，前缘镶一道紫褐。后翅拖出两条长尾，飞行时在身后轻轻翻转。四枚眼斑静静地看着，它这一生只为夜里那几次相遇。'
  },
  {
    id: '056',
    no: '056',
    nameZh: '乌桕大蚕蛾',
    nameLatin: 'Attacus atlas',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南部至南亚、东南亚的热带森林',
    habit: '世上翅面积最大的蛾类之一，成虫不取食，寿约一周',
    collectHint: '拍照识别',
    seriesIds: ['nocturne'],
    aliases: ['乌桕大蚕蛾', '皇蛾', '阿特拉斯蛾', 'Attacus atlas', '蛇头蛾'],
    essay:
      '赭红的翅面上嵌着几块透明的三角窗，光可以直接穿过去。前翅尖弯成蛇头的样子，连眼睛的位置都画好了。它不吃东西，只靠幼虫时攒下的力气，把一周过完。'
  },
  {
    id: '057',
    no: '057',
    nameZh: '马达加斯加金燕蛾',
    nameLatin: 'Chrysiridia rhipheus',
    category: '昆虫',
    rarity: 'rare',
    origin: '马达加斯加的热带森林',
    habit: '白天飞行访花，幼虫专食有毒的脐戟属植物',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['nocturne'],
    aliases: ['马达加斯加金燕蛾', '日落蛾', '燕蛾', 'Chrysiridia rhipheus'],
    essay:
      '它是白天飞行的蛾，翅上铺着绿、金、橙、蓝的条带，每一种颜色都不是色素。鳞片弯成细小的曲面，让光彼此折返再出来。后翅镶着白色的流苏，像一段剪下来的黄昏。'
  },
  {
    id: '058',
    no: '058',
    nameZh: '马达加斯加彗星蛾',
    nameLatin: 'Argema mittrei',
    category: '昆虫',
    rarity: 'legendary',
    origin: '马达加斯加东部的雨林',
    habit: '成虫无口器，只活四五天，后翅尾带长约十五厘米',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['nocturne'],
    aliases: ['马达加斯加彗星蛾', '彗星蛾', '月亮蛾', 'Argema mittrei', 'Argema'],
    essay:
      '鹅黄的翅上各有一枚褐色的眼斑，后翅却拖出两条极长的尾带，末端微微泛红。飞起来时，尾带落在身后，像夜空里一颗慢慢划过的彗星。它没有口器，四五天后便安静地停下。'
  },
  {
    id: '059',
    no: '059',
    nameZh: '多音天蚕蛾',
    nameLatin: 'Antheraea polyphemus',
    category: '昆虫',
    rarity: 'common',
    origin: '北美洲的温带落叶林',
    habit: '幼虫取食栎、桦、枫等叶，成虫夜行且不进食',
    collectHint: '拍照识别',
    seriesIds: ['nocturne'],
    aliases: ['多音天蚕蛾', '独眼巨人蛾', '波吕斐摩斯蛾', 'Antheraea polyphemus', 'Antheraea'],
    essay:
      '翅是暖褐色的，像一张晒过的牛皮纸。后翅中央一枚大眼斑，蓝黑相套，中心是一小块透明的鳞缺。它以独眼巨人的名字命名，被惊动时便张开翅，让那只眼睛看回去。'
  },
  {
    id: '060',
    no: '060',
    nameZh: '大孔雀蛾',
    nameLatin: 'Saturnia pyri',
    category: '昆虫',
    rarity: 'rare',
    origin: '南欧、北非至西亚的果园与林地',
    habit: '欧洲最大的蛾，幼虫取食梨、桃等果树叶片',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['nocturne'],
    aliases: ['大孔雀蛾', '欧洲大孔雀天蚕蛾', '梨天蚕蛾', 'Saturnia pyri', 'Saturnia'],
    essay:
      '四片翅各有一枚眼斑，黑瞳外绕着赭红与灰白的环，像孔雀尾羽落下的一片。翅面是烟灰色的，边缘有一圈浅色波纹。它在初夏的夜里出现，绕过路灯，又回到果园深处。'
  },
  {
    id: '061',
    no: '061',
    nameZh: '碧伟蜓',
    nameLatin: 'Anax parthenope',
    category: '昆虫',
    rarity: 'common',
    origin: '欧洲至东亚的池塘与湿地',
    habit: '雄虫沿水面来回巡飞护域，空中捕食小型飞虫',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['wings'],
    aliases: ['碧伟蜓', '伟蜓', '大蜻蜓', 'Anax parthenope', 'Anax'],
    essay:
      '胸部是青绿色的，腹部第二节有一圈天蓝，像水面倒映的一角天空。四片翅几乎透明，翅脉细密如网，光从网眼里漏下去。它在池塘上空来回巡行，很少停下。'
  },
  {
    id: '062',
    no: '062',
    nameZh: '网脉蜻',
    nameLatin: 'Neurothemis fulvia',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南部至南亚、东南亚的池塘与稻田',
    habit: '常停栖于水边草茎，雄虫翅大部呈红褐色',
    collectHint: '拍照识别',
    seriesIds: ['wings'],
    aliases: ['网脉蜻', '褐网蜻', 'Neurothemis fulvia', 'Neurothemis'],
    essay:
      '翅的大半染成红褐，只在翅尖留下一点透明，像一封信没有写完的边。翅脉格外稠密，把每一片翅分成无数细小的格。它停在草茎上时，翅平平展开，一动不动。'
  },
  {
    id: '063',
    no: '063',
    nameZh: '巨豆娘',
    nameLatin: 'Megaloprepus caerulatus',
    category: '昆虫',
    rarity: 'rare',
    origin: '墨西哥南部至南美北部的低地雨林',
    habit: '在积水树洞中产卵，林下慢速盘飞捕食结网蜘蛛',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['巨豆娘', '蓝带巨豆娘', '直升机豆娘', 'Megaloprepus caerulatus', 'Megaloprepus'],
    essay:
      '它是翅展最大的豆娘，四片翅各自错开拍动，在林下缓缓旋转。翅端有一道深蓝的横带，外侧缀一块乳白。在雨林昏暗的光里，人先看见的是这几点闪烁，然后才是它。'
  },
  {
    id: '064',
    no: '064',
    nameZh: '雪绒花标本',
    nameLatin: 'Leontopodium alpinum',
    category: '植物',
    rarity: 'rare',
    origin: '欧洲阿尔卑斯山海拔约1800至3000米的石灰岩草甸，野生种多国受保护，馆藏取自栽培',
    habit: '菊科高山草本，星状苞叶密被白绒毛以御寒抗紫外线',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['雪绒花', '高山火绒草', 'Edelweiss', 'Leontopodium alpinum'],
    essay:
      '看上去像花瓣的白色星芒，其实是苞叶，上面覆着一层细密的绒毛。绒毛留住空气，也挡住高处过强的光。真正的花挤在中央，是几粒不起眼的黄色小头状花序。'
  },
  {
    id: '065',
    no: '065',
    nameZh: '樱花押花',
    nameLatin: 'Prunus serrulata',
    category: '植物',
    rarity: 'common',
    origin: '原产中国、日本与朝鲜半岛，华东及西南山地有野生',
    habit: '蔷薇科落叶乔木，伞房花序，花瓣先端常有缺刻',
    collectHint: '拍照识别',
    seriesIds: ['meadow'],
    aliases: ['樱花押花', '山樱花', 'cherry blossom', 'Prunus serrulata', '押花'],
    essay:
      '五枚花瓣，每一枚的尖端都有一道浅浅的缺口。在枝头它只停留七八天，压进纸页的时候，粉色已经开始往白里褪。留下来的是一个比花期更长的形状。'
  },
  {
    id: '066',
    no: '066',
    nameZh: '桫椤',
    nameLatin: 'Alsophila spinulosa',
    category: '植物',
    rarity: 'legendary',
    origin: '四川、贵州、云南、广西、福建、台湾等地的沟谷林下',
    habit: '中生代孑遗树蕨，茎干可高数米，国家二级保护仅作记录',
    collectHint: '拍照识别',
    seriesIds: ['understory'],
    aliases: ['桫椤', '树蕨', '刺桫椤', 'Alsophila spinulosa', 'tree fern'],
    essay:
      '它和恐龙生活在同一个纪元，至今仍以孢子繁殖。新叶从顶端拳曲着展开，像一只慢慢松开的手。这一页只收录它的样子，不收录它的叶片，让它留在原来的沟谷里。'
  },
  {
    id: '067',
    no: '067',
    nameZh: '睡莲押花',
    nameLatin: 'Nymphaea tetragona',
    category: '植物',
    rarity: 'common',
    origin: '中国南北各地池沼广布，亦见于日本、朝鲜半岛与西伯利亚',
    habit: '浮叶水生草本，叶基深裂，花午间开放傍晚闭合',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['睡莲押花', '睡莲', '子午莲', 'Nymphaea tetragona', 'water lily'],
    essay:
      '它的花在正午前后打开，到傍晚又合拢，所以有人叫它子午莲。叶片平贴水面，基部裂开一道窄口。压干的花瓣层层叠着，还保留着最后一次闭合之前的弧度。'
  },
  {
    id: '068',
    no: '068',
    nameZh: '大扇贝',
    nameLatin: 'Pecten maximus',
    category: '海洋',
    rarity: 'common',
    origin: '东北大西洋，挪威至西班牙沿岸，英国与法国布列塔尼多产',
    habit: '右壳凸左壳平，放射肋宽而清晰，可拍合双壳游动',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['tidepool'],
    aliases: ['大扇贝', '欧洲大扇贝', 'great scallop', 'Pecten maximus', '扇贝'],
    essay:
      '十几道放射肋从壳顶散开，像一把收拢的扇骨。两扇壳并不对称，一扇鼓起，一扇平直，平的那面朝上躺在沙里。受惊时它会拍合双壳，借喷出的水向后跳开一段。'
  },
  {
    id: '069',
    no: '069',
    nameZh: '蓝指海星',
    nameLatin: 'Linckia laevigata',
    category: '海洋',
    rarity: 'common',
    origin: '印度—西太平洋珊瑚礁浅水，中国南海诸岛与台湾',
    habit: '通体钴蓝，五腕细长近圆柱形，断腕能再生完整个体',
    collectHint: '拍照识别',
    seriesIds: ['tidepool'],
    aliases: ['蓝指海星', '蓝海星', 'blue sea star', 'Linckia laevigata', '海星'],
    essay:
      '五条腕几乎一样粗，表面布满细小的颗粒，摸上去像干燥的皮革。它的蓝在礁坪上很显眼，却很少被鱼吃掉。断下的一条腕，过些日子能重新长出其余四条。'
  },
  {
    id: '070',
    no: '070',
    nameZh: '织锦芋螺',
    nameLatin: 'Conus textile',
    category: '海洋',
    rarity: 'rare',
    origin: '印度—太平洋热带珊瑚礁与砂底，中国西沙群岛与台湾',
    habit: '壳面布满帐篷状网纹，毒齿舌可致人死亡，活体勿触',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['织锦芋螺', '织锦螺', 'textile cone', 'Conus textile', '芋螺'],
    essay:
      '壳上的花纹像一张细密织就的锦缎，白色的三角一格格排开。这样好看的壳里，藏着一枚能射出毒液的齿舌，它用这枚针捕食别的螺。陈列在这里的只是空壳。'
  },
  {
    id: '071',
    no: '071',
    nameZh: '维纳斯骨螺',
    nameLatin: 'Murex pecten',
    category: '海洋',
    rarity: 'rare',
    origin: '印度—西太平洋砂泥质浅海至近海，菲律宾与中国南海',
    habit: '壳生百余枚细长棘刺，排列如梳，前水管沟极长',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['shellroad'],
    aliases: ['维纳斯骨螺', '维纳斯梳骨螺', 'Venus comb murex', 'Murex pecten', '骨螺'],
    essay:
      '一百多根棘刺沿着螺层排开，细得像鱼骨，又整齐得像一把梳子。每长一圈，它就新添一排，旧的那排并不拆去。这些刺让它陷在软泥里时，不至于被翻过身来。'
  },
  {
    id: '072',
    no: '072',
    nameZh: '大砗磲',
    nameLatin: 'Tridacna gigas',
    category: '海洋',
    rarity: 'legendary',
    origin: '西太平洋与东印度洋珊瑚礁浅海，中国南海诸岛',
    habit: '现存最大的双壳贝类，国家一级保护，仅作记录不交易',
    collectHint: '拍照识别',
    seriesIds: ['shellroad'],
    aliases: ['大砗磲', '砗磲', 'giant clam', 'Tridacna gigas', '车渠'],
    essay:
      '它的壳可以长过一米，波浪形的边缘紧紧咬合。外套膜里住着共生的藻，替它在阳光下制造养分，所以它总把壳口朝上张开。这一条只登记，不收藏，它该留在礁上。'
  },
  {
    id: '073',
    no: '073',
    nameZh: '沙钱标本',
    nameLatin: 'Dendraster excentricus',
    category: '海洋',
    rarity: 'common',
    origin: '北美太平洋沿岸，阿拉斯加南部至加利福尼亚的潮间带沙滩',
    habit: '扁圆骨壳背面有五瓣花纹，常斜插半埋于潮间带沙中',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['沙钱', '沙币', '偏心沙钱', 'sand dollar', 'Dendraster excentricus'],
    essay:
      '活着的时候，它覆着一层紫褐色的短棘，在沙里斜插成一片。死后棘刺脱落，日晒把骨壳漂成白色，背面那朵五瓣的花纹才露出来。那是它用来呼吸的管足排列的位置。'
  },
  {
    id: '074',
    no: '074',
    nameZh: '孔雀石',
    nameLatin: 'Malachite',
    category: '矿石',
    rarity: 'common',
    origin: '刚果（金）加丹加、俄罗斯乌拉尔，以及中国广东阳春、湖北大冶',
    habit: '单斜晶系铜的次生碳酸盐，切面呈同心环带',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['lode'],
    aliases: ['孔雀石', '石绿', 'Malachite', '铜矿石'],
    essay:
      '铜矿露出地表，被雨水和空气慢慢改写，便生成这种绿色。剖开来看，深浅不同的绿一圈套着一圈，像树的年轮。古代画师把它研成粉，叫作石绿，用来画山。'
  },
  {
    id: '075',
    no: '075',
    nameZh: '玛瑙',
    nameLatin: 'Agate',
    category: '矿石',
    rarity: 'common',
    origin: '巴西南里奥格兰德、乌拉圭，以及中国内蒙古阿拉善、辽宁阜新',
    habit: '隐晶质石英，于火山岩空洞中层层沉淀成环带',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['lode'],
    aliases: ['玛瑙', '玛瑙切片', 'Agate', '缟玛瑙'],
    essay:
      '熔岩冷却时留下气孔，含硅的水一次次渗进去，每次留下一层极薄的石英。几百万年后剖开，就是这些一圈一圈的纹。中心若还空着，便长出细小的晶簇。'
  },
  {
    id: '076',
    no: '076',
    nameZh: '粉晶',
    nameLatin: 'Rose Quartz',
    category: '矿石',
    rarity: 'common',
    origin: '巴西米纳斯吉拉斯、马达加斯加，以及中国新疆阿勒泰',
    habit: '三方晶系石英，多为块状，含微细纤维状包体而显粉色',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['粉晶', '芙蓉石', '玫瑰石英', 'Rose Quartz'],
    essay:
      '它很少长成完整的六方柱，多半是成块地出现在伟晶岩里。那一点粉色来自极细的纤维状包体，迎着光看，里面有一层薄雾。放在阳光下久了，颜色会慢慢变浅。'
  },
  {
    id: '077',
    no: '077',
    nameZh: '碧玺',
    nameLatin: 'Tourmaline',
    category: '矿石',
    rarity: 'rare',
    origin: '巴西米纳斯吉拉斯、马达加斯加，以及中国新疆阿勒泰',
    habit: '三方晶系硼硅酸盐，柱面有纵纹，横截面呈弧边三角形',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['refraction'],
    aliases: ['碧玺', '电气石', 'Tourmaline', '西瓜碧玺'],
    essay:
      '长柱的侧面布满竖直的细纹，横着截断，是一个三条边都向外鼓的三角形。同一根晶体里，颜色可以从粉过渡到绿。受热或受压时，它的两端会带上相反的电荷。'
  },
  {
    id: '078',
    no: '078',
    nameZh: '天青石',
    nameLatin: 'Celestine',
    category: '矿石',
    rarity: 'common',
    origin: '马达加斯加马哈赞加，以及中国江苏南京、湖北等地沉积岩中',
    habit: '斜方晶系硫酸锶，淡蓝透明板状晶体，常簇生于晶洞',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['refraction'],
    aliases: ['天青石', '天蓝石', 'Celestine', 'Celestite', '天青石晶洞'],
    essay:
      '它的蓝很淡，像傍晚天边最后一块没有被染上颜色的地方。晶体在空心的结核里一片片立起来，边缘透光。它含锶，烟火里那种红，就是从这类矿物里提出来的。'
  },
  {
    id: '079',
    no: '079',
    nameZh: '拉长石',
    nameLatin: 'Labradorite',
    category: '矿石',
    rarity: 'common',
    origin: '加拿大拉布拉多、芬兰、马达加斯加',
    habit: '三斜晶系斜长石，因内部薄层干涉转动时泛蓝绿晕彩',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['refraction'],
    aliases: ['拉长石', '光谱石', 'Labradorite'],
    essay:
      '正面看只是一块灰黑的石头，稍稍转动，蓝和绿忽然从深处浮上来。那光不是颜色，是矿物里极薄的层片让光彼此干涉。换一个角度，它又沉回灰色里去。'
  },
  {
    id: '080',
    no: '080',
    nameZh: '辰砂',
    nameLatin: 'Cinnabar',
    category: '矿石',
    rarity: 'rare',
    origin: '贵州铜仁万山、湖南凤凰与新晃，古称辰州所产者为佳',
    habit: '三方晶系硫化汞，朱红色，含汞有毒，勿入口勿研磨',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['lode'],
    aliases: ['辰砂', '朱砂', '丹砂', 'Cinnabar'],
    essay:
      '它的名字来自湖南的辰州，那里出的晶体红得最透。小小的菱面体伏在白色的白云石上，像一滴凝住的血。古人拿它作颜料与印泥，也拿它炼丹，后者伤了不少人。'
  },
  // ——— 2026-11-23 图鉴扩到 200 页：新增 120 页（081–200），昆虫 +40 / 植物 +30 / 海洋 +25 / 矿石 +25 ———
  {
    id: '081',
    no: '081',
    nameZh: '金凤蝶',
    nameLatin: 'Papilio machaon',
    category: '昆虫',
    rarity: 'common',
    origin: '欧亚大陆与北美的山地、草甸，中国南北多地可见',
    habit: '幼虫取食伞形科茴香、胡萝卜等，成虫喜访花',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['金凤蝶', '黄凤蝶', 'Old World swallowtail', 'Papilio machaon'],
    essay:
      '黄与黑在翅面上分得很清楚，后翅尾突旁各有一枚带蓝鳞的红斑。初夏的山坡上，它常停在开着小白花的伞形科植物上，翅膀张开又合拢，像在数阳光。'
  },
  {
    id: '082',
    no: '082',
    nameZh: '玉带凤蝶',
    nameLatin: 'Papilio polytes',
    category: '昆虫',
    rarity: 'common',
    origin: '中国长江以南至东南亚、南亚',
    habit: '幼虫取食柑橘类叶片，雌蝶有多种拟态型',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['玉带凤蝶', '白带凤蝶', 'Common Mormon', 'Papilio polytes'],
    essay:
      '黑色的翅上横着一条白斑，像系了一根玉带。雌蝶有好几种模样，有的会模仿带毒的红珠凤蝶，把后翅染上红点。同一个名字下，藏着几种不同的打扮。'
  },
  {
    id: '083',
    no: '083',
    nameZh: '青凤蝶',
    nameLatin: 'Graphium sarpedon',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方、东南亚至澳大利亚东北部',
    habit: '飞行迅速，雄蝶常聚集在湿地吸水',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['青凤蝶', '青带凤蝶', 'Common Bluebottle', 'Graphium sarpedon'],
    essay:
      '一道半透明的青色斑带从前翅贯穿到后翅，像一条细河。它飞得很快，很少停下来，只在雨后的溪边和泥地上聚成一小群，低头喝水。'
  },
  {
    id: '084',
    no: '084',
    nameZh: '美凤蝶',
    nameLatin: 'Papilio memnon',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方、东南亚至印度东北部',
    habit: '雌雄异型，雌蝶有有尾与无尾等多种型',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['美凤蝶', '大凤蝶', 'Great Mormon', 'Papilio memnon'],
    essay:
      '雄蝶是一整片带蓝光的黑，雌蝶却花样繁多，后翅有的拖着尾，有的没有，翅基还常带一抹红。图鉴里只能先收下一种模样，其余的留给下一次遇见。'
  },
  {
    id: '085',
    no: '085',
    nameZh: '燕凤蝶',
    nameLatin: 'Lamproptera curius',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国华南、西南至东南亚的溪谷林缘',
    habit: '体形很小，后翅尾突极长，悬停时像蜻蜓',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['燕凤蝶', '白带燕凤蝶', 'White Dragontail', 'Lamproptera curius'],
    essay:
      '它的尾突比翅膀还长，飞起来时两条白尾一直在身后摆动。在溪边悬停的样子，更像一只小蜻蜓，而不像凤蝶。正午的水面上，最容易看见它。'
  },
  {
    id: '086',
    no: '086',
    nameZh: '丝带凤蝶',
    nameLatin: 'Sericinus montela',
    category: '昆虫',
    rarity: 'common',
    origin: '中国东北、华北至华东，朝鲜半岛',
    habit: '幼虫取食马兜铃，成虫飞行缓慢、贴地滑翔',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['丝带凤蝶', '软尾亚凤蝶', 'Sericinus montela'],
    essay:
      '翅膀薄得近乎透光，后翅拖着一条柔软的长尾，飞起来像一段被风牵着的丝带。它飞得很慢，常贴着草丛滑过去，春夏之间各出一代。'
  },
  {
    id: '087',
    no: '087',
    nameZh: '冰清绢蝶',
    nameLatin: 'Parnassius glacialis',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国东北、华北至华东山地，日本与朝鲜半岛',
    habit: '一年一代，春末出现，翅面鳞片稀薄近半透明',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['冰清绢蝶', '白绢蝶', 'Parnassius glacialis'],
    essay:
      '它的翅膀像一张起了薄雾的宣纸，几乎透得过光，只在边缘留着一点灰。它只在春末短短出现几周，之后的一整年，都以卵的样子等在山里。'
  },
  {
    id: '088',
    no: '088',
    nameZh: '虎斑蝶',
    nameLatin: 'Danaus genutia',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方、南亚至澳大利亚北部',
    habit: '幼虫取食萝藦科植物，体内积累毒素以防天敌',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['虎斑蝶', '黑脉桦斑蝶', 'Common Tiger', 'Danaus genutia'],
    essay:
      '橙色的翅面上，黑色翅脉像一张摊开的网。它飞得从容，因为幼虫吃下的植物让它带着苦味，鸟很少碰它。这种不慌不忙，本身就是一种警告。'
  },
  {
    id: '089',
    no: '089',
    nameZh: '青斑蝶',
    nameLatin: 'Tirumala limniace',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方、南亚与东南亚',
    habit: '常在林缘访花，成群越冬',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['青斑蝶', '淡色青斑蝶', 'Blue Tiger', 'Tirumala limniace'],
    essay:
      '黑底上散着一片片淡青色的斑，像冬天窗玻璃上的冰花。天冷的时候，它们会聚到背风的山谷里，挂满一整片树枝，等到回暖再散开。'
  },
  {
    id: '090',
    no: '090',
    nameZh: '大绢斑蝶',
    nameLatin: 'Parantica sita',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方、西南至日本、喜马拉雅一带',
    habit: '能长距离迁飞，日本有秋季南迁的记录',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['大绢斑蝶', 'Chestnut Tiger', 'Parantica sita'],
    essay:
      '前翅是半透明的淡青，后翅染着栗色，像同一张纸被分成了两种季节。秋天，有人在它的翅上写下编号放飞，几个月后在千里之外又找到同一只。'
  },
  {
    id: '091',
    no: '091',
    nameZh: '海伦闪蝶',
    nameLatin: 'Morpho helenor',
    category: '昆虫',
    rarity: 'common',
    origin: '中美洲至南美洲热带森林',
    habit: '常沿林道与溪谷低飞，嗜食腐熟落果',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['海伦闪蝶', '蓝带闪蝶', 'Morpho helenor'],
    essay:
      '黑色的翅面中间一道宽阔的蓝带，飞起来时蓝和黑一明一灭，在林间忽隐忽现。合起翅膀，背面是褐色的眼斑，一下子就不见了。'
  },
  {
    id: '092',
    no: '092',
    nameZh: '黑框蓝闪蝶',
    nameLatin: 'Morpho peleides',
    category: '昆虫',
    rarity: 'rare',
    origin: '墨西哥至南美北部的热带森林',
    habit: '翅面蓝色为结构色，合翅时只露褐色眼斑',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['黑框蓝闪蝶', '蓝闪蝶', 'Peleides Blue Morpho', 'Morpho peleides'],
    essay:
      '亮蓝的翅面外镶着一圈黑框，像一扇被描了边的窗。那层蓝来自鳞片上细密的结构，换个角度，蓝会变暗，再转回来，又亮起来。'
  },
  {
    id: '093',
    no: '093',
    nameZh: '白闪蝶',
    nameLatin: 'Morpho polyphemus',
    category: '昆虫',
    rarity: 'legendary',
    origin: '墨西哥至中美洲的山地森林',
    habit: '翅面乳白带珍珠光泽，多在林冠与林缘缓飞',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['白闪蝶', '白色闪蝶', 'White Morpho', 'Morpho polyphemus'],
    essay:
      '闪蝶大多是蓝的，它却是一片带着珍珠光的白。阴天的林子里，它飞过的地方像有一盏灯在慢慢移动。翅缘几枚小小的眼斑，是这片白里唯一的标点。'
  },
  {
    id: '094',
    no: '094',
    nameZh: '蓝凤蝶',
    nameLatin: 'Papilio protenor',
    category: '昆虫',
    rarity: 'common',
    origin: '中国长江以南至日本、朝鲜半岛与喜马拉雅',
    habit: '幼虫取食柑橘类，成虫喜在林荫下穿行',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['swallowtail'],
    aliases: ['蓝凤蝶', '黑凤蝶', 'Spangle', 'Papilio protenor'],
    essay:
      '远看是一只黑凤蝶，走近了，翅面上才浮出一层暗蓝的光。它喜欢在树荫里穿行，光斑落在翅上时，那层蓝会短暂地亮一下。'
  },
  {
    id: '095',
    no: '095',
    nameZh: '白带锯蛱蝶',
    nameLatin: 'Cethosia cyane',
    category: '昆虫',
    rarity: 'common',
    origin: '中国华南、西南至印度与东南亚',
    habit: '翅缘呈锯齿状，幼虫取食西番莲科植物',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['白带锯蛱蝶', '锯蛱蝶', 'Leopard Lacewing', 'Cethosia cyane'],
    essay:
      '翅缘一圈细密的锯齿，像被剪刀仔细修过。前翅的白带横在橙红与黑之间，把颜色分成了两半。它和血漪蛱蝶是近亲，花纹却是另一种安排。'
  },
  {
    id: '096',
    no: '096',
    nameZh: '斐豹蛱蝶',
    nameLatin: 'Argynnis hyperbius',
    category: '昆虫',
    rarity: 'common',
    origin: '中国大部分地区，至东亚、南亚与澳大利亚',
    habit: '幼虫取食堇菜，雌蝶前翅端部黑紫带白斑',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['斐豹蛱蝶', '黑端豹斑蝶', 'Indian Fritillary', 'Argynnis hyperbius'],
    essay:
      '橙黄的翅面上撒满黑色圆点，像一块豹纹。雌蝶的前翅尖却是另一副样子，黑紫色上缀着白斑，学的是有毒的斑蝶。城市花坛的堇菜边，常有它的幼虫。'
  },
  {
    id: '097',
    no: '097',
    nameZh: '绿豹蛱蝶',
    nameLatin: 'Argynnis paphia',
    category: '昆虫',
    rarity: 'common',
    origin: '欧亚大陆温带林缘，中国北方与西南山地',
    habit: '后翅反面带银绿色条纹，夏季常访蓟类花',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['绿豹蛱蝶', '银纹豹蛱蝶', 'Silver-washed Fritillary', 'Argynnis paphia'],
    essay:
      '正面是豹斑，翻过来，后翅反面却是一片带银光的淡绿，像林间被风吹翻的叶背。盛夏的林缘，它常停在紫色的蓟花上，一待很久。'
  },
  {
    id: '098',
    no: '098',
    nameZh: '美眼蛱蝶',
    nameLatin: 'Junonia almana',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方至南亚、东南亚',
    habit: '有明显季节型，旱季型翅反面似枯叶',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['美眼蛱蝶', '孔雀眼蛱蝶', 'Peacock Pansy', 'Junonia almana'],
    essay:
      '后翅上一枚大眼斑，带着金色的圈，像一只一直睁着的眼睛。到了旱季，下一代的翅背会变得像枯叶，同一种蝴蝶，随季节换了一身衣裳。'
  },
  {
    id: '099',
    no: '099',
    nameZh: '翠蓝眼蛱蝶',
    nameLatin: 'Junonia orithya',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方至非洲、南亚与澳大利亚',
    habit: '喜开阔草地，雄蝶后翅翠蓝色',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['翠蓝眼蛱蝶', '青眼蛱蝶', 'Blue Pansy', 'Junonia orithya'],
    essay:
      '雄蝶后翅是一片翠蓝，边上缀着两枚小眼斑，在草地上低低飞过时，像一小片掉下来的天。它喜欢开阔向阳的地方，路边、田埂都能遇见。'
  },
  {
    id: '100',
    no: '100',
    nameZh: '傲白蛱蝶',
    nameLatin: 'Helcyra superba',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国华东、华南与西南山地，台湾',
    habit: '多在林冠活动，偶下到地面吸食树汁',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['傲白蛱蝶', '白蛱蝶', 'Helcyra superba'],
    essay:
      '翅正面几乎全白，只在翅尖留着一点黑，反面则带着银白的光泽。它大多待在高高的树冠上，难得下来一次，下来时也只停在流着树汁的地方。'
  },
  {
    id: '101',
    no: '101',
    nameZh: '宽边黄粉蝶',
    nameLatin: 'Eurema hecabe',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方至亚洲、非洲与澳大利亚的热带亚热带',
    habit: '幼虫取食豆科植物，成虫常在路边低飞',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['宽边黄粉蝶', '黄蝶', 'Common Grass Yellow', 'Eurema hecabe'],
    essay:
      '一枚柠檬黄，外缘镶着一道黑边。它在路旁的草丛上低低地飞，一停一停，像被风吹着走的落叶。南方的冬天，它还在飞。'
  },
  {
    id: '102',
    no: '102',
    nameZh: '黄尖襟粉蝶',
    nameLatin: 'Anthocharis scolymus',
    category: '昆虫',
    rarity: 'common',
    origin: '中国东北、华北至华中，日本与朝鲜半岛',
    habit: '一年一代，早春出现，雄蝶前翅尖橙黄色',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['黄尖襟粉蝶', '襟粉蝶', 'Yellow Tip', 'Anthocharis scolymus'],
    essay:
      '白色的前翅尖上点着一点橙黄，像蘸过颜料的笔尖。它只在早春出现，十字花科的野花一开，它就来了，花谢了，它也就不见了。'
  },
  {
    id: '103',
    no: '103',
    nameZh: '菜粉蝶',
    nameLatin: 'Pieris rapae',
    category: '昆虫',
    rarity: 'common',
    origin: '原产欧亚，现广布北半球温带与澳大利亚',
    habit: '幼虫取食十字花科蔬菜，一年多代',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['meadow'],
    aliases: ['菜粉蝶', '白粉蝶', 'Small White', 'Pieris rapae'],
    essay:
      '菜园里最常见的那只白蝴蝶，前翅上一两枚黑点。它太常见了，常见到很少有人停下来看它。在放大镜下，白色的鳞片像撒了一层细盐。'
  },
  {
    id: '104',
    no: '104',
    nameZh: '苎麻珍蝶',
    nameLatin: 'Acraea issoria',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方至东南亚、喜马拉雅',
    habit: '幼虫取食苎麻等荨麻科植物，体含毒素',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['苎麻珍蝶', '珍蝶', 'Yellow Coster', 'Acraea issoria'],
    essay:
      '翅膀是半透明的橙黄，鳞片稀疏，迎着光能看见翅脉。它飞得懒洋洋的，因为身体里带着苦涩的毒，不必着急。苎麻地边，常常一飞就是一片。'
  },
  {
    id: '105',
    no: '105',
    nameZh: '曲纹紫灰蝶',
    nameLatin: 'Chilades pandava',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方至南亚、东南亚',
    habit: '幼虫取食苏铁嫩叶，城市绿化中常见',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['曲纹紫灰蝶', '苏铁小灰蝶', 'Plains Cupid', 'Chilades pandava'],
    essay:
      '小得只有指甲盖大，正面是带紫光的蓝，反面灰白，缀着曲折的细纹。它的幼虫只吃苏铁的新叶，于是城市里种了苏铁的地方，就有了它。'
  },
  {
    id: '106',
    no: '106',
    nameZh: '扁锹甲',
    nameLatin: 'Dorcus titanus',
    category: '昆虫',
    rarity: 'common',
    origin: '中国大部分地区至东亚、东南亚',
    habit: '幼虫在朽木中发育，成虫夜行，舔食树汁',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['扁锹甲', '扁锹形虫', '扁锹', 'Dorcus titanus'],
    essay:
      '身体扁平，黑得发亮，一对大颚像张开的钳子。夏夜，它会在流着树汁的树干上出现，与别的甲虫争一个位置。白天，它躲进树皮的缝里。'
  },
  {
    id: '107',
    no: '107',
    nameZh: '彩虹锹甲',
    nameLatin: 'Phalacrognathus muelleri',
    category: '昆虫',
    rarity: 'legendary',
    origin: '澳大利亚昆士兰北部与新几内亚的热带雨林',
    habit: '幼虫取食腐朽木材，成虫体表金属光泽随角度变色',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['彩虹锹甲', '彩虹锹形虫', 'Rainbow Stag Beetle', 'Phalacrognathus muelleri'],
    essay:
      '它的甲壳像一块被打磨过的金属，绿、铜、紫随着角度流动。那些颜色不是颜料，是外壳表层的结构把光分开了。转一转，它就换一种颜色。'
  },
  {
    id: '108',
    no: '108',
    nameZh: '双叉犀金龟',
    nameLatin: 'Trypoxylus dichotomus',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国大部分地区至日本、朝鲜半岛与东南亚',
    habit: '幼虫在腐殖土中发育，雄虫头角末端二分叉',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['双叉犀金龟', '独角仙', 'Japanese Rhinoceros Beetle', 'Trypoxylus dichotomus'],
    essay:
      '人们常叫它独角仙，那只角的末端却分成了两叉。盛夏的夜里，它会循着灯光飞来，落地时发出一声闷响。它的力气，能推动比自己重得多的东西。'
  },
  {
    id: '109',
    no: '109',
    nameZh: '白星花金龟',
    nameLatin: 'Protaetia brevitarsis',
    category: '昆虫',
    rarity: 'common',
    origin: '中国大部分地区至东亚',
    habit: '成虫白天活动，取食成熟果实与树汁',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['白星花金龟', '白纹铜花金龟', 'Protaetia brevitarsis'],
    essay:
      '古铜色的鞘翅上，散落着不规则的白色斑点，像落了一层细雪。它白天飞行，飞的时候鞘翅不张开，只从侧面伸出后翅，嗡嗡地落在熟透的果子上。'
  },
  {
    id: '110',
    no: '110',
    nameZh: '七星瓢虫',
    nameLatin: 'Coccinella septempunctata',
    category: '昆虫',
    rarity: 'common',
    origin: '欧亚大陆广布，后引入北美',
    habit: '成虫与幼虫均捕食蚜虫，成虫可群聚越冬',
    collectHint: '拍照识别',
    seriesIds: ['jewel'],
    aliases: ['七星瓢虫', '花大姐', 'Seven-spot Ladybird', 'Coccinella septempunctata'],
    essay:
      '红色的圆壳上七枚黑点，三加三，再加中间一枚。它一生要吃掉成百上千只蚜虫。受了惊，它会从腿节渗出一点黄色的苦液，提醒对方别碰。'
  },
  {
    id: '111',
    no: '111',
    nameZh: '宝石象鼻虫',
    nameLatin: 'Eupholus schoenherrii',
    category: '昆虫',
    rarity: 'rare',
    origin: '新几内亚及邻近岛屿的雨林',
    habit: '体表覆盖蓝绿鳞片，颜色来自鳞片微结构',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['宝石象鼻虫', '蓝宝石象甲', 'Eupholus schoenherrii'],
    essay:
      '蓝与绿一圈一圈地铺在背上，中间夹着黑色的条纹，像一块嵌了珐琅的首饰。它的颜色来自鳞片里细小的结构，在雨林的绿里反而显得很亮。'
  },
  {
    id: '112',
    no: '112',
    nameZh: '圣甲虫',
    nameLatin: 'Scarabaeus sacer',
    category: '昆虫',
    rarity: 'common',
    origin: '地中海沿岸、北非至西亚的干旱地带',
    habit: '把粪便滚成球推回洞中，供自身与幼虫取食',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['圣甲虫', '蜣螂', '屎壳郎', 'Sacred Scarab', 'Scarabaeus sacer'],
    essay:
      '它倒立着，用后腿推着一颗圆球，一路滚过沙地。古埃及人看见这个画面，想到的是推着太阳走过天空的神。几千年后，这颗球依旧是它的口粮。'
  },
  {
    id: '113',
    no: '113',
    nameZh: '中华虎甲',
    nameLatin: 'Cicindela chinensis',
    category: '昆虫',
    rarity: 'common',
    origin: '中国大部分地区至东亚',
    habit: '捕食性，常在山路上贴地疾跑，遇人飞出几步再落下',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['jewel'],
    aliases: ['中华虎甲', '引路虫', 'Cicindela chinensis'],
    essay:
      '红、绿、蓝三色拼在一身，在山路上一闪就跑出去好远。人走近，它飞起几步又落下，总在前面一点点，所以有人叫它引路虫。'
  },
  {
    id: '114',
    no: '114',
    nameZh: '红尾大蚕蛾',
    nameLatin: 'Actias rhodopneuma',
    category: '昆虫',
    rarity: 'legendary',
    origin: '中国南部至越南、老挝的山地森林',
    habit: '成虫口器退化不进食，后翅拖着带红色的长尾',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['nocturne'],
    aliases: ['红尾大蚕蛾', '粉尾大蚕蛾', 'Actias rhodopneuma'],
    essay:
      '淡绿的翅膀，后翅拖着两条长尾，尾端染成了粉红。它羽化之后不再进食，只靠幼虫时攒下的那点力气，活上一周左右，完成一件事就离开。'
  },
  {
    id: '115',
    no: '115',
    nameZh: '柞蚕蛾',
    nameLatin: 'Antheraea pernyi',
    category: '昆虫',
    rarity: 'common',
    origin: '原产中国，东北、山东等地放养历史悠久',
    habit: '幼虫取食柞树叶，茧丝可缫制柞蚕丝',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['nocturne'],
    aliases: ['柞蚕蛾', '柞蚕', 'Chinese Tussah Moth', 'Antheraea pernyi'],
    essay:
      '黄褐色的翅上各有一枚透明的眼斑，像四扇小窗。它的幼虫被放在柞树林里吃叶子，吐出的丝比家蚕的粗一些，织成的绸带着天然的米黄。'
  },
  {
    id: '116',
    no: '116',
    nameZh: '家蚕蛾',
    nameLatin: 'Bombyx mori',
    category: '昆虫',
    rarity: 'common',
    origin: '由野桑蚕在中国驯化而来，驯化史逾五千年',
    habit: '成虫几乎不能飞，幼虫只吃桑叶',
    collectHint: '拍照识别',
    seriesIds: ['nocturne'],
    aliases: ['家蚕蛾', '家蚕', '桑蚕', 'Silkworm Moth', 'Bombyx mori'],
    essay:
      '一身米白，翅膀短小，已经飞不起来了。几千年里，人们只留下那些不乱跑、吐丝多的，于是它离开人就活不下去。一根丝，从这里一直通到长安以西。'
  },
  {
    id: '117',
    no: '117',
    nameZh: '鬼脸天蛾',
    nameLatin: 'Acherontia lachesis',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南方至南亚、东南亚',
    habit: '胸背有似人脸的斑纹，受惊时能发出吱吱声，会潜入蜂巢偷蜜',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['nocturne'],
    aliases: ['鬼脸天蛾', '人面天蛾', 'Greater Death\'s Head Hawkmoth', 'Acherontia lachesis'],
    essay:
      '胸背上的斑纹像一张人脸，传说也因此多了起来。其实它只是爱吃蜜，会悄悄钻进蜂巢里偷吃。被抓住时，它会从口中挤出空气，发出细细的吱吱声。'
  },
  {
    id: '118',
    no: '118',
    nameZh: '黄蜻',
    nameLatin: 'Pantala flavescens',
    category: '昆虫',
    rarity: 'common',
    origin: '全球热带至温带广布，中国各地常见',
    habit: '能跨洋长距离迁飞，常在雨前成群低飞',
    collectHint: '拍照识别',
    seriesIds: ['wings'],
    aliases: ['黄蜻', '小黄', 'Wandering Glider', 'Pantala flavescens'],
    essay:
      '夏天傍晚，雨来之前，成群低飞的往往就是它。它是飞得最远的昆虫之一，一代接一代，能跨过印度洋。那样远的路，靠的只是一对透明的翅膀。'
  },
  {
    id: '119',
    no: '119',
    nameZh: '红蜻',
    nameLatin: 'Crocothemis servilia',
    category: '昆虫',
    rarity: 'common',
    origin: '中国南北各地，至东亚、南亚与东南亚',
    habit: '雄性通体鲜红，常停在水边枝头守着领地',
    collectHint: '拍照识别',
    seriesIds: ['wings'],
    aliases: ['红蜻', '赤卒', '红蜻蜓', 'Scarlet Skimmer', 'Crocothemis servilia'],
    essay:
      '雄性从头到尾一身鲜红，停在水边的芦苇尖上，一动不动。有别的蜻蜓飞过，它就冲出去追一圈，再回到同一根芦苇尖上。'
  },
  {
    id: '120',
    no: '120',
    nameZh: '透顶单脉色蟌',
    nameLatin: 'Matrona basilaris',
    category: '昆虫',
    rarity: 'rare',
    origin: '中国华东、华南与西南的山间溪流',
    habit: '豆娘的一种，雄性翅膀深蓝黑色带金属光泽',
    collectHint: '拍照识别，或收藏馆内对应藏品',
    seriesIds: ['wings'],
    aliases: ['透顶单脉色蟌', '黑翅豆娘', 'Matrona basilaris'],
    essay:
      '它是豆娘，停下时翅膀合起来竖在背上。雄性的翅是深深的蓝黑，身体泛着金属绿，在溪边的树影里，一扇一合，像在打着慢慢的信号。'
  },
  {
    id: '121',
    no: '121',
    nameZh: '三角枫押花',
    nameLatin: 'Acer buergerianum',
    category: '植物',
    rarity: 'common',
    origin: '中国长江流域至华南，日本有栽培',
    habit: '落叶乔木，叶常三浅裂，秋季转为橙红',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['三角枫', '三角槭', 'Trident Maple', 'Acer buergerianum'],
    essay:
      '叶片只分三瓣，像一枚小小的三叉。秋天，它的红比鸡爪槭来得早一些，也更偏橙。压在纸里，那点橙会慢慢沉成铁锈色。'
  },
  {
    id: '122',
    no: '122',
    nameZh: '乌桕叶押花',
    nameLatin: 'Triadica sebifera',
    category: '植物',
    rarity: 'common',
    origin: '中国秦岭淮河以南广布，日本与越南有分布',
    habit: '落叶乔木，叶菱形，秋叶红、黄、紫同在一树',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['乌桕', '乌桕叶', 'Chinese Tallow', 'Triadica sebifera'],
    essay:
      '菱形的叶子，秋天能在同一棵树上同时红、黄、紫。古人说「乌桕赤于枫」。冬天叶落之后，枝头挂着一串串白色的种子，像没化的雪。'
  },
  {
    id: '123',
    no: '123',
    nameZh: '黄栌押花',
    nameLatin: 'Cotinus coggygria',
    category: '植物',
    rarity: 'common',
    origin: '中国华北、西南至南欧，北京香山红叶即以它为主',
    habit: '落叶灌木或小乔木，叶近圆形，秋季变红',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['黄栌', '香山红叶', 'Smoke Tree', 'Cotinus coggygria'],
    essay:
      '北京秋天满山的红叶，大多是它。叶子圆圆的，像一枚枚铜钱，入秋之后由绿转黄再转红。夏天花谢后，花梗上会长出一团团羽毛似的烟。'
  },
  {
    id: '124',
    no: '124',
    nameZh: '鹅掌楸押花',
    nameLatin: 'Liriodendron chinense',
    category: '植物',
    rarity: 'rare',
    origin: '中国长江以南山地，野生种群稀少，馆藏取自栽培',
    habit: '落叶乔木，叶形似马褂，古老的木兰科孑遗种',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['鹅掌楸', '马褂木', 'Chinese Tulip Tree', 'Liriodendron chinense'],
    essay:
      '叶子的轮廓像一件马褂，两侧各收进去一块，顶端平平地截断。它的家族在冰期之前遍布北半球，如今只剩下两种，一种在中国，一种在北美。'
  },
  {
    id: '125',
    no: '125',
    nameZh: '悬铃木叶押花',
    nameLatin: 'Platanus acerifolia',
    category: '植物',
    rarity: 'common',
    origin: '杂交起源，广植于世界各地城市，上海、南京行道树常见',
    habit: '落叶大乔木，树皮片状剥落，球果悬垂如铃',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['悬铃木', '法国梧桐', '二球悬铃木', 'London Plane', 'Platanus acerifolia'],
    essay:
      '人们叫它法国梧桐，它既不来自法国，也不是梧桐。宽大的叶子在秋天落满街道，踩上去是一种很脆的声音。枝头挂着的小球，到冬天还在摇。'
  },
  {
    id: '126',
    no: '126',
    nameZh: '蒲公英标本',
    nameLatin: 'Taraxacum mongolicum',
    category: '植物',
    rarity: 'common',
    origin: '中国南北各地的路边、草地与田野',
    habit: '菊科多年生草本，瘦果带冠毛，随风传播',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['蒲公英', '婆婆丁', 'Dandelion', 'Taraxacum mongolicum'],
    essay:
      '一整颗白色的绒球，每一根绒毛下都挂着一粒种子。风一来，它们各自飞走。封进玻璃罩里的这一颗，把那个将散未散的瞬间留住了。'
  },
  {
    id: '127',
    no: '127',
    nameZh: '满天星',
    nameLatin: 'Gypsophila paniculata',
    category: '植物',
    rarity: 'common',
    origin: '原产欧洲东部至中亚，现广泛栽培',
    habit: '石竹科多年生草本，圆锥花序上开满白色小花',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['满天星', '圆锥石头花', 'Baby\'s Breath', 'Gypsophila paniculata'],
    essay:
      '成百上千朵小白花挤在细枝上，远看像一团雾。它常常被放在花束的边上，衬着别的花。干了以后，形状几乎不变，只是白色里多了一点米黄。'
  },
  {
    id: '128',
    no: '128',
    nameZh: '勿忘我押花',
    nameLatin: 'Myosotis sylvatica',
    category: '植物',
    rarity: 'common',
    origin: '原产欧洲，各地有栽培',
    habit: '紫草科草本，花小，天蓝色，花心一圈黄',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['勿忘我', '森林勿忘草', 'Forget-me-not', 'Myosotis sylvatica'],
    essay:
      '五片天蓝色的小花瓣，中间一圈淡黄。它的名字是一句请求。压进纸里之后，那点蓝会比别的颜色留得更久一些。'
  },
  {
    id: '129',
    no: '129',
    nameZh: '三色堇押花',
    nameLatin: 'Viola tricolor',
    category: '植物',
    rarity: 'common',
    origin: '原产欧洲，园艺品种广泛栽培',
    habit: '堇菜科草本，花瓣常有紫、黄、白三色',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['三色堇', '猫脸花', 'Heartsease', 'Viola tricolor'],
    essay:
      '花瓣上的深色纹路，像一张小小的脸，所以有人叫它猫脸花。它很适合押花，花瓣薄，压平之后，纹路一条不少。'
  },
  {
    id: '130',
    no: '130',
    nameZh: '波斯菊押花',
    nameLatin: 'Cosmos bipinnatus',
    category: '植物',
    rarity: 'common',
    origin: '原产墨西哥，现世界各地广泛栽培与逸生',
    habit: '菊科一年生草本，叶细裂如羽，秋季花开成片',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['波斯菊', '格桑花', '秋英', 'Garden Cosmos', 'Cosmos bipinnatus'],
    essay:
      '细长的茎顶着一朵花，风一吹，满坡都在点头。它来自墨西哥，却在高原上有了另一个名字，格桑花。压平的花瓣，边缘还留着细细的齿。'
  },
  {
    id: '131',
    no: '131',
    nameZh: '千日红',
    nameLatin: 'Gomphrena globosa',
    category: '植物',
    rarity: 'common',
    origin: '原产美洲热带，中国南北常见栽培',
    habit: '苋科一年生草本，球形花序由干膜质苞片组成，久不褪色',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['千日红', '百日红', 'Globe Amaranth', 'Gomphrena globosa'],
    essay:
      '一颗颗紫红色的小圆球，看上去像花，其实是一层层干膜似的苞片。它天生就干燥，剪下来放上很久，颜色也不怎么变，所以叫千日红。'
  },
  {
    id: '132',
    no: '132',
    nameZh: '鼠尾草标本',
    nameLatin: 'Salvia officinalis',
    category: '植物',
    rarity: 'common',
    origin: '原产地中海沿岸，现广泛栽培',
    habit: '唇形科亚灌木，叶灰绿有绒毛，揉之有香气',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['鼠尾草', '药用鼠尾草', 'Common Sage', 'Salvia officinalis'],
    essay:
      '灰绿色的叶子上有一层细绒，摸上去像旧呢子。揉一揉，手指上就留下一股暖暖的草香。干燥之后，香气淡了，那层绒还在。'
  },
  {
    id: '133',
    no: '133',
    nameZh: '狗尾草标本',
    nameLatin: 'Setaria viridis',
    category: '植物',
    rarity: 'common',
    origin: '中国南北各地，广布全球温带',
    habit: '禾本科一年生草本，圆锥花序紧密成穗，带长刚毛',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['狗尾草', '毛毛草', 'Green Foxtail', 'Setaria viridis'],
    essay:
      '路边、墙角、田埂上，一根根毛茸茸的穗子在风里弯着腰。几乎每个人小时候都折过一根。干了以后，它的颜色从绿变成了浅金。'
  },
  {
    id: '134',
    no: '134',
    nameZh: '芦苇标本',
    nameLatin: 'Phragmites australis',
    category: '植物',
    rarity: 'common',
    origin: '全球广布的湿地植物，中国各地水边常见',
    habit: '禾本科多年生高大草本，秋季圆锥花序呈银灰或紫褐',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['芦苇', '蒹葭', 'Common Reed', 'Phragmites australis'],
    essay:
      '《诗经》里写「蒹葭苍苍」，说的就是它。秋天，水边一片银灰色的穗子，被风推着一齐倒向一边。剪下一枝放进瓶里，可以放到第二年。'
  },
  {
    id: '135',
    no: '135',
    nameZh: '兔尾草',
    nameLatin: 'Lagurus ovatus',
    category: '植物',
    rarity: 'common',
    origin: '原产地中海沿岸，现作观赏草栽培',
    habit: '禾本科一年生草本，花序卵圆形，密被柔毛',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['兔尾草', '兔子尾巴草', 'Hare\'s-tail Grass', 'Lagurus ovatus'],
    essay:
      '每一根细茎的顶端，都顶着一团软绒绒的小穗，真像一截兔子尾巴。它干了也不掉毛，常被扎进干花束里，摸一下，指尖是软的。'
  },
  {
    id: '136',
    no: '136',
    nameZh: '尤加利叶标本',
    nameLatin: 'Eucalyptus cinerea',
    category: '植物',
    rarity: 'common',
    origin: '原产澳大利亚东南部，现作切叶广泛栽培',
    habit: '桃金娘科乔木，幼叶圆形，灰蓝色被白粉',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['尤加利', '银元桉', '银叶桉', 'Silver Dollar Gum', 'Eucalyptus cinerea'],
    essay:
      '圆圆的叶子一枚接一枚串在枝上，像一串灰蓝色的硬币。叶面覆着一层白粉，揉开有清凉的气味。干燥后，那层灰蓝会更明显一点。'
  },
  {
    id: '137',
    no: '137',
    nameZh: '棉花标本',
    nameLatin: 'Gossypium hirsutum',
    category: '植物',
    rarity: 'common',
    origin: '原产中美洲，现为世界主要栽培棉种，中国新疆为主产区',
    habit: '锦葵科，蒴果成熟开裂，种子表皮纤维即棉絮',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['棉花', '陆地棉', 'Upland Cotton', 'Gossypium hirsutum'],
    essay:
      '棉桃裂开，里面是一团团雪白的纤维，裹着黑色的种子。我们身上穿的，最初就是这样的一团。秋天的新疆，整片田地都是这种白。'
  },
  {
    id: '138',
    no: '138',
    nameZh: '玉兰押花',
    nameLatin: 'Yulania denudata',
    category: '植物',
    rarity: 'common',
    origin: '中国中部，各地广泛栽培，上海市花',
    habit: '木兰科落叶乔木，先花后叶，早春开花',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['玉兰', '白玉兰', 'Yulan Magnolia', 'Yulania denudata'],
    essay:
      '叶子还没长出来，花就先开了，一树白，像一盏盏点起来的灯。花瓣厚，押花时要多换几次吸水纸，才能留住那一点象牙色。'
  },
  {
    id: '139',
    no: '139',
    nameZh: '山茶押花',
    nameLatin: 'Camellia japonica',
    category: '植物',
    rarity: 'common',
    origin: '中国东部、日本与朝鲜半岛，园艺品种极多',
    habit: '山茶科常绿灌木或小乔木，冬末春初开花，花常整朵落下',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['山茶', '茶花', 'Camellia', 'Camellia japonica'],
    essay:
      '它开在冬末，凋谢时不是一瓣一瓣地落，而是整朵掉下来，落在地上还是完整的一朵。叶子厚而亮，像上过一层蜡。'
  },
  {
    id: '140',
    no: '140',
    nameZh: '紫藤押花',
    nameLatin: 'Wisteria sinensis',
    category: '植物',
    rarity: 'common',
    origin: '中国华北至华南，各地庭院广泛栽培',
    habit: '豆科落叶木质藤本，总状花序下垂，紫色，春季开花',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['紫藤', '藤萝', 'Chinese Wisteria', 'Wisteria sinensis'],
    essay:
      '四月，一串串紫色的花从架子上垂下来，风一吹，整面墙都在晃。走过的时候，能闻到一点淡淡的甜。押平的小花，像一只只停下的蝶。'
  },
  {
    id: '141',
    no: '141',
    nameZh: '鸢尾押花',
    nameLatin: 'Iris tectorum',
    category: '植物',
    rarity: 'common',
    origin: '中国中部、西南，日本与朝鲜半岛有栽培',
    habit: '鸢尾科多年生草本，外花被片带深紫色脉纹与鸡冠状附属物',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['鸢尾', '蓝蝴蝶', 'Roof Iris', 'Iris tectorum'],
    essay:
      '它的花像一只停下的蓝紫色蝴蝶，外面三片向下垂，里面三片向上收。花瓣上的深色脉纹，是给昆虫画的路标，指向藏着花蜜的地方。'
  },
  {
    id: '142',
    no: '142',
    nameZh: '虞美人押花',
    nameLatin: 'Papaver rhoeas',
    category: '植物',
    rarity: 'common',
    origin: '原产欧洲与北非，各地广泛栽培',
    habit: '罂粟科一年生草本，花瓣薄如绉纸，不含成瘾物质',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['虞美人', '丽春花', 'Corn Poppy', 'Papaver rhoeas'],
    essay:
      '花瓣薄得像一张揉过又摊开的绉纸，红得很纯，靠近中心有一块黑斑。它的花期很短，一朵往往只开一两天。押花时，那片薄最难留住。'
  },
  {
    id: '143',
    no: '143',
    nameZh: '王莲叶脉',
    nameLatin: 'Victoria amazonica',
    category: '植物',
    rarity: 'legendary',
    origin: '南美亚马孙河流域的静水湖泊与河湾',
    habit: '睡莲科水生草本，巨叶直径可逾两米，叶背有粗壮的网状叶脉',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['王莲', '亚马孙王莲', 'Giant Water Lily', 'Victoria amazonica'],
    essay:
      '它的叶子大到能托起一个孩子，叶缘翻起，像一只浮在水上的盘子。秘密在叶背，一张粗壮的叶脉网撑着整片叶，有建筑师从这里得到过灵感。'
  },
  {
    id: '144',
    no: '144',
    nameZh: '卷柏标本',
    nameLatin: 'Selaginella tamariscina',
    category: '植物',
    rarity: 'rare',
    origin: '中国南北各地的岩石缝隙中',
    habit: '卷柏科多年生草本，干旱时枝叶卷缩如拳，遇水即舒展',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['卷柏', '九死还魂草', 'Selaginella tamariscina'],
    essay:
      '天旱的时候，它把枝叶向内卷起，缩成一个干枯的拳头，像死了一样。等到一场雨，几个小时之内，它又一点一点舒展开，重新变绿。'
  },
  {
    id: '145',
    no: '145',
    nameZh: '肾蕨标本',
    nameLatin: 'Nephrolepis cordifolia',
    category: '植物',
    rarity: 'common',
    origin: '中国南方至全球热带亚热带',
    habit: '肾蕨科多年生草本，羽片整齐排列，常作观叶与切叶',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['肾蕨', '蜈蚣草', 'Fishbone Fern', 'Nephrolepis cordifolia'],
    essay:
      '一根长长的叶轴，两侧排着整整齐齐的小羽片，像一把细齿的梳子。它不开花，靠叶背的孢子繁衍，这个办法已经用了几亿年。'
  },
  {
    id: '146',
    no: '146',
    nameZh: '鹿角蕨',
    nameLatin: 'Platycerium bifurcatum',
    category: '植物',
    rarity: 'rare',
    origin: '原产澳大利亚东部与新几内亚，现为常见附生观叶植物',
    habit: '附生蕨类，营养叶贴树干，孢子叶分叉如鹿角',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['鹿角蕨', '二歧鹿角蕨', 'Staghorn Fern', 'Platycerium bifurcatum'],
    essay:
      '它不长在土里，而是抱在树干上。贴着树皮的那层叶子负责接住落叶和雨水，向外伸出的叶子分了一叉又一叉，像一对鹿角挂在墙上。'
  },
  {
    id: '147',
    no: '147',
    nameZh: '大灰藓',
    nameLatin: 'Hypnum plumaeforme',
    category: '植物',
    rarity: 'common',
    origin: '中国南北各地的林下、树干与岩面',
    habit: '灰藓科藓类，茎匍匐，羽状分枝，常成片生长',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['大灰藓', '苔藓', 'Hypnum plumaeforme'],
    essay:
      '林子里最安静的那一层绿。它没有根，也没有花，靠一层层细小的叶子留住雾气和雨水。蹲下来细看，每一根小茎都是一枚羽毛的形状。'
  },
  {
    id: '148',
    no: '148',
    nameZh: '红松松塔',
    nameLatin: 'Pinus koraiensis',
    category: '植物',
    rarity: 'common',
    origin: '中国东北长白山、小兴安岭至朝鲜半岛、俄罗斯远东',
    habit: '松科常绿乔木，球果大，种子即松子，可食',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['红松', '松塔', '果松', 'Korean Pine', 'Pinus koraiensis'],
    essay:
      '一枚松塔要在树上长两年才熟。每一片鳞片下面藏着两粒松子，松鼠和星鸦把它们埋起来过冬，忘了取回的那些，就在来年长成小树。'
  },
  {
    id: '149',
    no: '149',
    nameZh: '龙胆标本',
    nameLatin: 'Gentiana scabra',
    category: '植物',
    rarity: 'rare',
    origin: '中国东北至华东、华南的山坡草地',
    habit: '龙胆科多年生草本，秋季开蓝紫色钟形花，根味极苦',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['meadow'],
    aliases: ['龙胆', '龙胆草', 'Japanese Gentian', 'Gentiana scabra'],
    essay:
      '深秋的山坡，草都黄了，它才开出蓝紫色的钟形花。名字里有龙，是因为它的根苦得像胆。阴天它把花合起来，太阳一出又张开。'
  },
  {
    id: '150',
    no: '150',
    nameZh: '水杉枝叶标本',
    nameLatin: 'Metasequoia glyptostroboides',
    category: '植物',
    rarity: 'legendary',
    origin: '野生种群仅见于湖北利川一带，现世界各地广泛栽培，馆藏取自栽培',
    habit: '柏科落叶乔木，线形叶对生成羽状，秋季转为红褐后脱落',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['understory'],
    aliases: ['水杉', 'Dawn Redwood', 'Metasequoia glyptostroboides'],
    essay:
      '它先在化石里被认出来，人们以为它早已灭绝。几年之后，在湖北的山村里找到了活着的树。那一排排羽状的小叶，秋天会一起变成红褐色。'
  },
  {
    id: '151',
    no: '151',
    nameZh: '阿拉伯宝螺',
    nameLatin: 'Mauritia arabica',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带浅海，中国南海与台湾',
    habit: '外套膜包覆壳面使其光亮，壳背有似文字的细纹',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['阿拉伯宝螺', '阿拉伯绶贝', 'Arabian Cowry', 'Mauritia arabica'],
    essay:
      '壳背上布满褐色的细纹，交错得像一行行写下的字，它的名字就从这里来。壳面光亮，是活着时外套膜一遍遍抹出来的，像上过釉的瓷。'
  },
  {
    id: '152',
    no: '152',
    nameZh: '货贝',
    nameLatin: 'Monetaria moneta',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带浅海，马尔代夫一带尤多',
    habit: '小型宝螺，壳淡黄，古代在亚非多地被用作货币',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['货贝', '黄宝螺', '贝币', 'Money Cowry', 'Monetaria moneta'],
    essay:
      '它小得能握一把在手心，淡黄色，光滑。几千年前，它是钱，从印度洋运到中原，「财」「货」「贵」这些字里，都还留着一个贝。'
  },
  {
    id: '153',
    no: '153',
    nameZh: '蝎螺',
    nameLatin: 'Lambis scorpius',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带珊瑚礁浅海，中国南海',
    habit: '壳口外唇伸出多根带节的长棘，似蝎尾',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['蝎螺', '蝎尾螺', 'Scorpion Conch', 'Lambis scorpius'],
    essay:
      '壳口伸出几根长长的棘，每一根上都带着一节一节的疙瘩，像蝎子翘起的尾巴。它和水字螺是近亲，在礁石间慢慢爬，靠那些棘撑住身体。'
  },
  {
    id: '154',
    no: '154',
    nameZh: '篱凤螺',
    nameLatin: 'Conomurex luhuanus',
    category: '海洋',
    rarity: 'common',
    origin: '西太平洋热带浅海砂底，中国南海与台湾',
    habit: '壳口内缘橙红，边缘黑褐，以细长的口盖撑地跳跃前进',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['篱凤螺', '红口凤螺', 'Strawberry Conch', 'Conomurex luhuanus'],
    essay:
      '翻过来，壳口里是一片橙红，边上镶着一道黑。它走路不是爬，而是用一片尖尖的口盖撑住沙地，一下一下地跳着往前。'
  },
  {
    id: '155',
    no: '155',
    nameZh: '金口蝾螺',
    nameLatin: 'Turbo chrysostomus',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带浅海礁石，中国南海',
    habit: '壳口内呈金黄色，有石灰质厚口盖',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['金口蝾螺', '金口螺', 'Gold-mouth Turban', 'Turbo chrysostomus'],
    essay:
      '壳外是粗糙的灰绿，翻过来，壳口里却是一圈亮亮的金黄。它用一块厚厚的石灰质口盖把门关上，那块口盖被人叫作猫眼。'
  },
  {
    id: '156',
    no: '156',
    nameZh: '夜光蝾螺',
    nameLatin: 'Turbo marmoratus',
    category: '海洋',
    rarity: 'rare',
    origin: '印度—西太平洋热带珊瑚礁',
    habit: '大型蝾螺，壳内为厚层珍珠质，历来用于螺钿镶嵌',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['夜光蝾螺', '夜光螺', 'Green Turban', 'Turbo marmoratus'],
    essay:
      '外壳是暗绿色带斑纹的，磨开之后，里面是一层厚厚的珍珠光。古代的螺钿漆器，许多就用它切成薄片，一片片嵌进黑漆里，光在里面流动。'
  },
  {
    id: '157',
    no: '157',
    nameZh: '皱纹盘鲍',
    nameLatin: 'Haliotis discus hannai',
    category: '海洋',
    rarity: 'common',
    origin: '中国黄渤海沿岸，日本与朝鲜半岛，现大量养殖',
    habit: '壳扁平呈耳状，一侧有一列呼吸孔，内壁珍珠层五彩',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['皱纹盘鲍', '鲍鱼', '九孔', 'Haliotis discus hannai'],
    essay:
      '壳像一只摊开的耳朵，沿边一排小孔，是它呼吸和排水的地方。外面粗糙，里面却是一片流动的虹彩，绿、紫、粉都在，转一下就换一种。'
  },
  {
    id: '158',
    no: '158',
    nameZh: '马氏珠母贝',
    nameLatin: 'Pinctada fucata',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋暖水海域，中国广西北海、广东湛江为养殖地',
    habit: '珍珠贝科双壳类，海水珍珠的主要母贝',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['马氏珠母贝', '合浦珠母贝', '珍珠贝', 'Akoya Pearl Oyster', 'Pinctada fucata'],
    essay:
      '一粒沙或一小片植入的核进到壳里，它就一层一层地分泌珍珠质把它包起来。「合浦珠还」说的就是它的故乡。壳的内壁，和珍珠是同一种光。'
  },
  {
    id: '159',
    no: '159',
    nameZh: '栉江珧',
    nameLatin: 'Atrina pectinata',
    category: '海洋',
    rarity: 'common',
    origin: '中国沿海至西太平洋、印度洋的泥沙底',
    habit: '大型双壳类，尖端插入泥沙中直立生活，以足丝固着',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['栉江珧', '江珧', '带子', 'Pen Shell', 'Atrina pectinata'],
    essay:
      '壳是一个细长的三角，尖的那头插在海底的泥沙里，宽的那头朝上张开。它用一束丝固定自己，古时候，有人用这类贝的丝织过布。'
  },
  {
    id: '160',
    no: '160',
    nameZh: '日月贝',
    nameLatin: 'Amusium pleuronectes',
    category: '海洋',
    rarity: 'common',
    origin: '西太平洋热带浅海砂底，中国南海北部湾',
    habit: '扇贝科，两壳颜色不同，一面红褐一面白，能开合双壳游泳',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['日月贝', '海扇', 'Asian Moon Scallop', 'Amusium pleuronectes'],
    essay:
      '一面是红褐，像太阳；一面是乳白，像月亮，所以叫日月贝。它能把两片壳快速开合，喷着水在海里一跳一跳地游，扇贝里它游得最好。'
  },
  {
    id: '161',
    no: '161',
    nameZh: '心鸟蛤',
    nameLatin: 'Corculum cardissa',
    category: '海洋',
    rarity: 'rare',
    origin: '印度—西太平洋热带珊瑚礁浅海',
    habit: '双壳侧扁成心形，体内共生藻类，半透明的壳让光透进去',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['心鸟蛤', '心形贝', 'Heart Cockle', 'Corculum cardissa'],
    essay:
      '从正面看，两片壳合起来，就是一颗心的形状。它的壳有一部分是半透明的，阳光照进去，养活住在它身体里的藻，藻再分给它一点养分。'
  },
  {
    id: '162',
    no: '162',
    nameZh: '船蛸壳',
    nameLatin: 'Argonauta argo',
    category: '海洋',
    rarity: 'legendary',
    origin: '全球热带至温带海域的表层水',
    habit: '章鱼的近亲，雌性以腕分泌出薄如纸的卵壳，携卵漂游',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['船蛸', '纸鹦鹉螺', 'Paper Nautilus', 'Argonauta argo'],
    essay:
      '它不是螺，也不是鹦鹉螺，而是一种章鱼。雌性用两条腕分泌出一只薄得透光的壳，把卵放在里面，抱着它在海面附近漂。那只壳，只为一窝卵而做。'
  },
  {
    id: '163',
    no: '163',
    nameZh: '地纹芋螺',
    nameLatin: 'Conus geographus',
    category: '海洋',
    rarity: 'rare',
    origin: '印度—太平洋热带珊瑚礁',
    habit: '以毒齿舌捕鱼，毒性极强，活体切勿触碰',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['地纹芋螺', '杀手芋螺', 'Geography Cone', 'Conus geographus'],
    essay:
      '壳上褐色的斑纹，像一张画着山川的旧地图。它在夜里张开口，把小鱼整个吞进去，靠的是一枚带毒的齿舌。这里陈列的，是早已空了的壳。'
  },
  {
    id: '164',
    no: '164',
    nameZh: '笔螺',
    nameLatin: 'Mitra mitra',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带浅海砂底',
    habit: '壳细长如笔尖，白底上排列橙红色方斑',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['笔螺', '主教冠螺', 'Episcopal Miter', 'Mitra mitra'],
    essay:
      '壳又细又长，尖得像一支笔，也像主教头上的冠。白色的壳面上，一排排橙红色的方块整整齐齐，仿佛有人用印章一格一格盖上去。'
  },
  {
    id: '165',
    no: '165',
    nameZh: '红口榧螺',
    nameLatin: 'Oliva miniacea',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带浅海砂底',
    habit: '壳呈橄榄形，光滑，壳口内橙红，夜间在沙中觅食',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['红口榧螺', '橄榄螺', 'Red-mouth Olive', 'Oliva miniacea'],
    essay:
      '形状像一颗橄榄，表面光滑得不用打磨。白天它把自己埋进沙里，夜里才出来。翻过来看，壳口里藏着一抹橙红。'
  },
  {
    id: '166',
    no: '166',
    nameZh: '千手螺',
    nameLatin: 'Chicoreus ramosus',
    category: '海洋',
    rarity: 'common',
    origin: '印度—西太平洋热带浅海，中国南海',
    habit: '大型骨螺，壳上生有多列分枝状棘刺，捕食双壳类',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['千手螺', '大千手螺', 'Ramose Murex', 'Chicoreus ramosus'],
    essay:
      '壳上长着一列列分叉的棘，像一只伸出很多只手的螺。它是骨螺家族里块头大的，能撬开别的贝壳。棘的末端，常常还带着一点粉色。'
  },
  {
    id: '167',
    no: '167',
    nameZh: '绮蛳螺',
    nameLatin: 'Epitonium scalare',
    category: '海洋',
    rarity: 'legendary',
    origin: '西太平洋至印度洋，日本、中国台湾与菲律宾',
    habit: '螺层之间不相连，只靠一圈圈纵肋撑起，形如旋梯',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['绮蛳螺', '梯螺', '名贵梯螺', 'Precious Wentletrap', 'Epitonium scalare'],
    essay:
      '它的螺层彼此并不相贴，中间是空的，只靠一圈圈细肋把整座旋梯撑起来。十八世纪的欧洲，一枚这样的壳价值不菲，据说有人用米粉做过仿品。'
  },
  {
    id: '168',
    no: '168',
    nameZh: '紫海胆壳',
    nameLatin: 'Heliocidaris crassispina',
    category: '海洋',
    rarity: 'common',
    origin: '中国东海、南海沿岸岩礁，至日本南部',
    habit: '棘皮动物，壳由石灰质骨板拼成，五辐射对称',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['紫海胆', '海胆', 'Purple Sea Urchin', 'Heliocidaris crassispina'],
    essay:
      '刺褪去之后，留下的是一个圆圆的壳，上面排着一圈圈细小的瘤点，五道纹路从顶上分下来。它和海星是近亲，同样是五的倍数。'
  },
  {
    id: '169',
    no: '169',
    nameZh: '面包海星',
    nameLatin: 'Culcita novaeguineae',
    category: '海洋',
    rarity: 'common',
    origin: '印度—西太平洋热带珊瑚礁',
    habit: '腕极短，身体鼓起成五边形面包状，以珊瑚表面的有机物为食',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['面包海星', '馒头海星', 'Cushion Star', 'Culcita novaeguineae'],
    essay:
      '它的五条腕短得几乎看不出来，整个身体鼓起来，像一块刚出炉的面包。仔细看，背上的纹路仍然能数出五个方向。'
  },
  {
    id: '170',
    no: '170',
    nameZh: '华贵栉孔扇贝',
    nameLatin: 'Mimachlamys nobilis',
    category: '海洋',
    rarity: 'common',
    origin: '中国福建、广东、广西沿海至日本南部',
    habit: '扇贝科，壳色多变，有紫、橙、黄、白等，现多养殖',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['华贵栉孔扇贝', 'Noble Scallop', 'Mimachlamys nobilis'],
    essay:
      '同一种扇贝，壳的颜色却各不相同，紫的、橙的、柠檬黄的，排在一起像一盘色卡。放射状的肋一条一条，从壳顶散开，像扇子的骨。'
  },
  {
    id: '171',
    no: '171',
    nameZh: '文蛤',
    nameLatin: 'Meretrix meretrix',
    category: '海洋',
    rarity: 'common',
    origin: '中国沿海潮间带至浅海砂底，江苏如东一带尤多',
    habit: '帘蛤科双壳类，壳面光滑，花纹因个体而异',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['文蛤', '花蛤', 'Asiatic Hard Clam', 'Meretrix meretrix'],
    essay:
      '壳面光滑，每一只身上的花纹都不一样，有的是细细的折线，有的是一片墨色。潮水退去，人们在沙滩上踩一踩，脚底下鼓起的地方就是它。'
  },
  {
    id: '172',
    no: '172',
    nameZh: '大角贝',
    nameLatin: 'Pictodentalium vernedei',
    category: '海洋',
    rarity: 'common',
    origin: '西太平洋，日本、中国东海与南海的砂泥底',
    habit: '掘足纲软体动物，壳呈两端开口的弯管状',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['大角贝', '象牙贝', 'Tusk Shell', 'Pictodentalium vernedei'],
    essay:
      '它的壳是一根微微弯着的细管，两头都开着口，像一枚小小的象牙。它把宽的一头插进海底的泥沙里，细的一头露出来，用来换水。'
  },
  {
    id: '173',
    no: '173',
    nameZh: '蛇首宝螺',
    nameLatin: 'Monetaria caputserpentis',
    category: '海洋',
    rarity: 'common',
    origin: '印度—太平洋热带浅海岩礁，中国南海与台湾',
    habit: '壳背褐底散布白斑，两侧深褐，形似蛇头',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['tidepool'],
    aliases: ['蛇首宝螺', '蛇首眼球贝', 'Serpent\'s Head Cowry', 'Monetaria caputserpentis'],
    essay:
      '从上往下看，深褐色的壳背缀满白点，两侧颜色更深，整枚贝像一只昂起的蛇头。它住在潮间带的岩缝里，退潮时也能看见。'
  },
  {
    id: '174',
    no: '174',
    nameZh: '黑蝶珍珠贝',
    nameLatin: 'Pinctada margaritifera',
    category: '海洋',
    rarity: 'rare',
    origin: '印度—太平洋热带海域，法属波利尼西亚为主要养殖地',
    habit: '珍珠贝科大型双壳类，壳内缘带黑色珍珠层，出产黑珍珠',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['黑蝶珍珠贝', '珠母贝', '黑蝶贝', 'Black-lip Pearl Oyster', 'Pinctada margaritifera'],
    essay:
      '壳的内壁大部分是银白的珍珠光，靠近边缘却渐渐暗成黑灰。大溪地的黑珍珠就从这里来，那一点墨色，是它边缘这道黑留下的。'
  },
  {
    id: '175',
    no: '175',
    nameZh: '笋螺',
    nameLatin: 'Turritella terebra',
    category: '海洋',
    rarity: 'common',
    origin: '印度—西太平洋，中国东海、南海的泥沙底',
    habit: '壳呈细长塔形，螺层多达二十层以上，滤食为生',
    collectHint: '收藏馆内对应藏品后自动落入',
    seriesIds: ['shellroad'],
    aliases: ['笋螺', '锥螺', '塔螺', 'Screw Shell', 'Turritella terebra'],
    essay:
      '壳细长，一层一层盘上去，像一根剥了皮的笋，又像一座塔。数一数，螺层有二十多圈。它不太爬动，把自己埋在泥沙里，滤着海水过日子。'
  },
  {
    id: '176',
    no: '176',
    nameZh: '冰洲石',
    nameLatin: 'Calcite',
    category: '矿石',
    rarity: 'common',
    origin: '冰岛、墨西哥，中国内蒙古、贵州等地',
    habit: '三方晶系碳酸钙，透明者有显著双折射，菱面体完全解理',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['冰洲石', '方解石', 'Iceland Spar', 'Calcite'],
    essay:
      '把它放在一行字上，透过去看，字会变成两行。这是光进去之后分成了两条路。它敲开时总沿着同一个方向裂开，碎块仍然是一个个小菱面体。'
  },
  {
    id: '177',
    no: '177',
    nameZh: '白水晶',
    nameLatin: 'Rock Crystal',
    category: '矿石',
    rarity: 'common',
    origin: '巴西、马达加斯加、美国阿肯色，中国江苏东海',
    habit: '三方晶系二氧化硅，六方柱状晶体，透明无色',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['白水晶', '石英', '水晶', 'Rock Crystal', 'Quartz'],
    essay:
      '六面的柱子，顶上收成一个尖，透明得像结了冰的水。古人以为它就是千年的冰。东海的水晶矿，曾经出过重达数吨的晶体。'
  },
  {
    id: '178',
    no: '178',
    nameZh: '黄水晶',
    nameLatin: 'Citrine',
    category: '矿石',
    rarity: 'common',
    origin: '巴西、马达加斯加、玻利维亚',
    habit: '含微量铁的石英，天然者色淡，市售多为紫晶加热所得',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['黄水晶', 'Citrine'],
    essay:
      '颜色像一杯淡淡的茶，又像秋天下午的光。天然的黄水晶并不多，许多是紫水晶加热后褪成的黄。同一种石头，火给了它另一种颜色。'
  },
  {
    id: '179',
    no: '179',
    nameZh: '烟晶',
    nameLatin: 'Smoky Quartz',
    category: '矿石',
    rarity: 'common',
    origin: '瑞士阿尔卑斯山、巴西，中国新疆与福建',
    habit: '石英晶体受天然辐射后呈烟褐色',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['烟晶', '茶晶', '墨晶', 'Smoky Quartz'],
    essay:
      '它的颜色像一缕烟停在了晶体里，从浅褐到近乎黑。那层烟是岩石里微弱的天然辐射，在漫长的时间里一点点染上去的。'
  },
  {
    id: '180',
    no: '180',
    nameZh: '绿松石',
    nameLatin: 'Turquoise',
    category: '矿石',
    rarity: 'rare',
    origin: '中国湖北十堰竹山、安徽马鞍山，伊朗与美国西南部',
    habit: '含铜的磷酸盐矿物，常带褐色铁线，质软怕油污',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['绿松石', '松石', 'Turquoise'],
    essay:
      '它的蓝里带一点绿，像远处的湖。褐色的铁线在上面弯弯曲曲，像一张网。湖北竹山出产的松石，已经有几千年开采的历史，二里头的绿松石龙就是它。'
  },
  {
    id: '181',
    no: '181',
    nameZh: '青金石',
    nameLatin: 'Lapis Lazuli',
    category: '矿石',
    rarity: 'rare',
    origin: '阿富汗巴达赫尚，智利与俄罗斯贝加尔湖一带',
    habit: '以青金石矿物为主的岩石，深蓝色中常夹黄铁矿金点',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['青金石', 'Lapis Lazuli'],
    essay:
      '深沉的蓝里，撒着一粒粒金色的黄铁矿，像夜空里的星。它被磨成粉，就是古代最贵的颜料「群青」。敦煌壁画里的蓝，许多是它。'
  },
  {
    id: '182',
    no: '182',
    nameZh: '蓝铜矿',
    nameLatin: 'Azurite',
    category: '矿石',
    rarity: 'rare',
    origin: '中国湖北大冶、安徽铜陵，摩洛哥、纳米比亚',
    habit: '含铜碳酸盐矿物，深蓝色，常与孔雀石共生',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['蓝铜矿', '石青', 'Azurite'],
    essay:
      '它的蓝比天空更深，常和绿色的孔雀石长在一起，一蓝一绿。古人把它研成颜料，叫作石青。时间久了，它会慢慢变成孔雀石，蓝退成绿。'
  },
  {
    id: '183',
    no: '183',
    nameZh: '菱锰矿',
    nameLatin: 'Rhodochrosite',
    category: '矿石',
    rarity: 'rare',
    origin: '阿根廷卡塔马卡、美国科罗拉多，中国广西梧州',
    habit: '碳酸锰矿物，玫瑰红色，块状者常有同心环带',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['菱锰矿', '红纹石', 'Rhodochrosite'],
    essay:
      '切开它，里面是一圈一圈玫瑰色的环，深浅相间，像一朵被剖开的花。这些环是一层层沉淀下来的，每一圈都记着一段不一样的水。'
  },
  {
    id: '184',
    no: '184',
    nameZh: '石榴石',
    nameLatin: 'Garnet',
    category: '矿石',
    rarity: 'common',
    origin: '印度、斯里兰卡、马达加斯加，中国江苏、新疆',
    habit: '等轴晶系硅酸盐矿物族，常呈菱形十二面体，以暗红色最常见',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['石榴石', '紫牙乌', 'Garnet'],
    essay:
      '它的晶体常常长成十二个菱面的小球，深红色的，像一粒熟透的石榴籽。它的名字就是从石榴来的。石榴石是一个家族，颜色其实不止红色。'
  },
  {
    id: '185',
    no: '185',
    nameZh: '月光石',
    nameLatin: 'Moonstone',
    category: '矿石',
    rarity: 'common',
    origin: '斯里兰卡、印度、缅甸',
    habit: '长石族矿物，内部层状结构使表面浮出蓝白色游彩',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['月光石', 'Moonstone'],
    essay:
      '转动它的时候，表面会浮起一层蓝白色的光，像月亮从云后面移出来。这层光不是颜色，是石头里极薄的层状结构把光散开了。'
  },
  {
    id: '186',
    no: '186',
    nameZh: '黑曜石',
    nameLatin: 'Obsidian',
    category: '矿石',
    rarity: 'common',
    origin: '墨西哥、美国、冰岛与日本等火山地区',
    habit: '火山玻璃，熔岩急速冷却来不及结晶而成，断口呈贝壳状',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['黑曜石', '火山玻璃', 'Obsidian'],
    essay:
      '岩浆流出来，冷得太快，来不及长成晶体，就凝成了一块黑色的玻璃。它的断口锋利，古人用它做刀和箭头。对着光，有的边缘会透出一点烟色。'
  },
  {
    id: '187',
    no: '187',
    nameZh: '琥珀',
    nameLatin: 'Amber',
    category: '矿石',
    rarity: 'rare',
    origin: '波罗的海沿岸、缅甸、多米尼加，中国辽宁抚顺',
    habit: '远古树脂经地质作用石化而成，质轻，可浮于饱和盐水',
    collectHint: '拍照识别',
    seriesIds: ['deeptime'],
    aliases: ['琥珀', '蜜蜡', 'Amber'],
    essay:
      '几千万年前，一滴树脂从树上流下来，把路过的一只小虫裹了进去。树早就没了，那滴树脂慢慢硬成了石头。光从里面透过来，还是蜂蜜的颜色。'
  },
  {
    id: '188',
    no: '188',
    nameZh: '菊石',
    nameLatin: 'Ammonite',
    category: '矿石',
    rarity: 'rare',
    origin: '世界各地中生代海相地层，中国西藏、马达加斯加、摩洛哥常见',
    habit: '已灭绝的头足类软体动物化石，壳内有复杂缝合线',
    collectHint: '拍照识别',
    seriesIds: ['deeptime'],
    aliases: ['菊石', '鹦鹉螺化石', 'Ammonite'],
    essay:
      '它和鹦鹉螺是远亲，在海里游了三亿多年，和恐龙一起在白垩纪末消失。切开来，壳里一道道弯曲的缝合线，像菊花的花瓣，名字就是这么来的。'
  },
  {
    id: '189',
    no: '189',
    nameZh: '三叶虫',
    nameLatin: 'Trilobite',
    category: '矿石',
    rarity: 'legendary',
    origin: '世界各地古生代海相地层，中国山东、云南澄江，摩洛哥',
    habit: '已灭绝的海洋节肢动物化石，身体纵分为三叶',
    collectHint: '拍照识别',
    seriesIds: ['deeptime'],
    aliases: ['三叶虫', '蝙蝠石', 'Trilobite'],
    essay:
      '它的身体从中间到两侧分成三条，所以叫三叶虫。它在海底爬了将近三亿年，眼睛由方解石的晶体组成。山东的人把它叫作蝙蝠石。'
  },
  {
    id: '190',
    no: '190',
    nameZh: '硅化木',
    nameLatin: 'Petrified Wood',
    category: '矿石',
    rarity: 'common',
    origin: '美国亚利桑那、中国新疆奇台与辽宁朝阳',
    habit: '树木被掩埋后，组织逐渐被二氧化硅置换而成的化石',
    collectHint: '拍照识别',
    seriesIds: ['deeptime'],
    aliases: ['硅化木', '木化石', 'Petrified Wood'],
    essay:
      '一棵树被埋进泥沙里，地下的水带着硅一点点渗进去，替换了木头本身。千万年后，它变成了石头，年轮和木纹却一圈不少地留了下来。'
  },
  {
    id: '191',
    no: '191',
    nameZh: '天河石',
    nameLatin: 'Amazonite',
    category: '矿石',
    rarity: 'common',
    origin: '巴西、马达加斯加、美国科罗拉多',
    habit: '微斜长石的蓝绿色变种，常有白色格子状纹理',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['天河石', '亚马逊石', 'Amazonite'],
    essay:
      '蓝绿色，像浅海的水，里面交织着白色的细格。它是长石的一种，颜色来自极微量的铅。名字叫亚马逊石，河边却并不出产。'
  },
  {
    id: '192',
    no: '192',
    nameZh: '海蓝宝',
    nameLatin: 'Aquamarine',
    category: '矿石',
    rarity: 'rare',
    origin: '巴西、巴基斯坦、马达加斯加，中国新疆阿勒泰',
    habit: '绿柱石的浅蓝色变种，六方柱状晶体，含微量铁',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['海蓝宝', '海蓝宝石', 'Aquamarine', 'Beryl'],
    essay:
      '六方柱形的晶体，颜色像退潮后浅滩上的水。它和祖母绿是同一种矿物，只是里面带进去的元素不同，一个成了蓝，一个成了绿。'
  },
  {
    id: '193',
    no: '193',
    nameZh: '磷灰石',
    nameLatin: 'Apatite',
    category: '矿石',
    rarity: 'common',
    origin: '墨西哥、马达加斯加、巴西，中国云南',
    habit: '磷酸钙矿物，六方柱状，颜色多样，与骨骼牙齿成分相近',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['磷灰石', 'Apatite'],
    essay:
      '它的颜色很多，蓝的、绿的、黄的都有，常常被认错，名字的原意就是「欺骗」。我们的骨头和牙齿里，也有和它很接近的成分。'
  },
  {
    id: '194',
    no: '194',
    nameZh: '重晶石',
    nameLatin: 'Baryte',
    category: '矿石',
    rarity: 'common',
    origin: '中国湖南、贵州，英国与摩洛哥',
    habit: '硫酸钡矿物，比重大，板状晶体常聚成玫瑰花状',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['重晶石', '沙漠玫瑰', 'Baryte'],
    essay:
      '拿起来比看上去重得多，名字就是这么来的。它的板状晶体有时一片片叠在一起，长成一朵石头玫瑰。医院里拍消化道的造影剂，就是它的成分。'
  },
  {
    id: '195',
    no: '195',
    nameZh: '雄黄',
    nameLatin: 'Realgar',
    category: '矿石',
    rarity: 'rare',
    origin: '中国湖南石门、贵州，美国与罗马尼亚',
    habit: '硫化砷矿物，橙红色，含砷有毒，久晒会粉化变黄',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['雄黄', '鸡冠石', 'Realgar'],
    essay:
      '橙红的颜色像一枚鸡冠，端午时人们说起的雄黄酒，就跟它有关。它含砷，有毒，光照久了会碎成黄色的粉末，所以要避光收着，不可入口。'
  },
  {
    id: '196',
    no: '196',
    nameZh: '辉锑矿',
    nameLatin: 'Stibnite',
    category: '矿石',
    rarity: 'legendary',
    origin: '中国湖南冷水江锡矿山、江西，日本与罗马尼亚',
    habit: '硫化锑矿物，铅灰色长柱状晶体，具强金属光泽',
    collectHint: '拍照识别',
    seriesIds: ['lode'],
    aliases: ['辉锑矿', 'Stibnite'],
    essay:
      '一束束铅灰色的长柱，像剑一样伸出来，表面亮得能映出人影。湖南的锡矿山是世界上最大的锑矿之一，那里出产的辉锑矿晶簇，被许多博物馆收藏。'
  },
  {
    id: '197',
    no: '197',
    nameZh: '白钨矿',
    nameLatin: 'Scheelite',
    category: '矿石',
    rarity: 'rare',
    origin: '中国江西、湖南，奥地利与澳大利亚',
    habit: '钨酸钙矿物，短波紫外线下发出明亮的蓝白色荧光',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['白钨矿', 'Scheelite'],
    essay:
      '白天看，它只是一块不起眼的米黄色晶体。关上灯，用紫外线一照，它会发出蓝白色的光。找矿的人，曾经在夜里提着灯沿着矿洞找它。'
  },
  {
    id: '198',
    no: '198',
    nameZh: '文石',
    nameLatin: 'Aragonite',
    category: '矿石',
    rarity: 'common',
    origin: '西班牙阿拉贡、摩洛哥，中国湖北',
    habit: '斜方晶系碳酸钙，与方解石成分相同而结构不同，常呈放射状或珊瑚状',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['文石', '霰石', 'Aragonite'],
    essay:
      '它和方解石是同一种成分，只是原子排列不同，长出来的样子也就不同。贝壳的珍珠层、珍珠本身，都是由它一层层叠成的。'
  },
  {
    id: '199',
    no: '199',
    nameZh: '绿帘石',
    nameLatin: 'Epidote',
    category: '矿石',
    rarity: 'common',
    origin: '奥地利、巴基斯坦、秘鲁，中国新疆',
    habit: '单斜晶系硅酸盐矿物，开心果绿至墨绿，柱状晶体带纵纹',
    collectHint: '拍照识别',
    seriesIds: ['refraction'],
    aliases: ['绿帘石', 'Epidote'],
    essay:
      '它的颜色像开心果，深的地方几乎是墨绿。柱状的晶体上刻着一条条纵纹，从不同方向看，颜色会在黄绿和褐绿之间变换。'
  },
  {
    id: '200',
    no: '200',
    nameZh: '铁陨石',
    nameLatin: 'Iron Meteorite',
    category: '矿石',
    rarity: 'legendary',
    origin: '来自小行星内核的铁镍合金，纳米比亚吉贝恩、中国新疆青河等地有发现',
    habit: '主要由铁镍矿物组成，切面酸蚀后显出维斯台登纹',
    collectHint: '拍照识别',
    seriesIds: ['deeptime'],
    aliases: ['铁陨石', '陨铁', '陨石', 'Iron Meteorite'],
    essay:
      '它来自比地球还古老的地方，是一颗小行星碎掉的内核。切开、抛光，再用酸轻轻一蚀，表面会浮出交叉的纹路，那是它在太空里冷却了几百万年才长出来的。'
  }
]

function getSpeciesById(id) {
  return ATLAS_SPECIES.find((s) => s.id === String(id)) || null
}

function getSpotById(id) {
  return ATLAS_SPOTS.find((s) => s.id === String(id)) || null
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·．.]/g, '')
}

function matchSpeciesByNames(names) {
  const list = (Array.isArray(names) ? names : [names])
    .map(normalizeName)
    .filter(Boolean)
  if (!list.length) return null
  let best = null
  let bestScore = 0
  ATLAS_SPECIES.forEach((sp) => {
    const aliases = (sp.aliases || []).map(normalizeName)
    list.forEach((n) => {
      aliases.forEach((a) => {
        if (!n || !a) return
        let score = 0
        if (n === a) score = 3
        else if (n.indexOf(a) !== -1 || a.indexOf(n) !== -1) score = 2
        if (score > bestScore) {
          bestScore = score
          best = sp
        }
      })
    })
  })
  return bestScore >= 2 ? best : null
}

function parseSpotCode(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  let m = s.match(/ATLAS[:/_-]?([a-z0-9]+)/i)
  if (m) return m[1].toLowerCase()
  m = s.match(/[?&]spot=([a-z0-9]+)/i)
  if (m) return m[1].toLowerCase()
  m = s.match(/^a[_-]?([a-z0-9]+)$/i)
  if (m) return m[1].toLowerCase()
  if (/^s[1-9]\d*$/i.test(s)) return s.toLowerCase()
  return ''
}

function seriesNamesOf(sp) {
  const ids = sp.seriesIds || []
  return ATLAS_SERIES.filter((s) => ids.indexOf(s.id) !== -1).map((s) => s.name)
}

/** 某物种对应的馆内导览印记（可多点） */
function spotsOfSpecies(speciesId) {
  const sid = String(speciesId || '')
  return ATLAS_SPOTS.filter((s) => s.speciesId === sid).map((s) => ({
    id: s.id,
    code: `ATLAS:${s.id}`,
    hint: s.hint || '',
    storeId: s.storeId || ''
  }))
}

const CATEGORY_TONE = {
  昆虫: 'insecta',
  植物: 'plantae',
  矿石: 'minerals',
  海洋: 'marine'
}

function publicSpecies(sp, unlocked) {
  if (!sp) return null
  const rarity = RARITY[sp.rarity] || RARITY.common
  const spots = spotsOfSpecies(sp.id)
  const base = {
    id: sp.id,
    no: sp.no,
    category: sp.category,
    categoryTone: CATEGORY_TONE[sp.category] || '',
    rarity: sp.rarity,
    rarityLabel: rarity.label,
    rarityDots: rarity.dots,
    card: rarity.card,
    seriesIds: sp.seriesIds || [],
    seriesNames: seriesNamesOf(sp),
    unlocked: !!unlocked,
    hasSpot: spots.length > 0
  }
  if (!unlocked) {
    return Object.assign(base, {
      nameZh: '未记录',
      nameLatin: '',
      collectHint: '它在馆里，等被看见。'
    })
  }
  return Object.assign(base, {
    nameZh: sp.nameZh,
    nameLatin: sp.nameLatin,
    origin: sp.origin || '',
    habit: sp.habit || '',
    collectHint: sp.collectHint || '',
    essay: sp.essay || '',
    numbered: sp.numbered || null,
    spots,
    spotHint: spots
      .map((s) => s.hint)
      .filter(Boolean)
      .join(' · '),
    imprintCodes: spots.map((s) => s.code),
    imprintCode: spots[0] ? spots[0].code : ''
  })
}

module.exports = {
  RARITY,
  METHODS,
  ATLAS_SERIES,
  ATLAS_SPOTS,
  ATLAS_SPECIES,
  CATEGORY_TONE,
  getSpeciesById,
  getSpotById,
  spotsOfSpecies,
  matchSpeciesByNames,
  parseSpotCode,
  publicSpecies,
  isFrostDescent,
  toCst
}
