/**
 * 与 subpackages/feature/config/atlasCatalog.js 保持同步（云函数无法引用小程序根目录）。
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
    speciesIds: ['055', '056', '057', '058', '059', '060'],
    blurb: '灯一亮，它们从黑里落下来，翅上带着一层粉。'
  },
  {
    id: 'tidepool',
    name: '潮间带',
    speciesIds: ['038', '039', '069', '073'],
    blurb: '水退下去的那几个小时，海把一些形状留在礁石上。'
  }
]

const ATLAS_SPOTS = [
  { id: 's1', speciesId: '001', storeId: 'store_shanhaizaowu', hint: '主店一层，蝴蝶昆虫柜深处' },
  { id: 's2', speciesId: '018', storeId: 'store_shanhaizaowu', hint: '主店走廊尽头' },
  { id: 's3', speciesId: '041', storeId: 'store_shanhaizaowu', hint: '矿石标本柜' },
  { id: 's4', speciesId: '031', storeId: 'store_xingchen', hint: '工坊角落的工作台' },
  { id: 's5', speciesId: '033', storeId: 'store_shanhaizaowu', hint: '海洋标本柜下层' }
]

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
    collectHint: '矿石标本柜，或收藏对应矿物标本',
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
    seriesIds: [],
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
    seriesIds: [],
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
      '砖红不是节日的红。翅缘有一圈碎白点，像秋天把路走完后留下的记号。它不急着停，也不急着被写成标本。'
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
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
    seriesIds: [],
    aliases: ['拉长石', '光谱石', 'Labradorite', '月光石'],
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
    seriesIds: [],
    aliases: ['辰砂', '朱砂', '丹砂', 'Cinnabar'],
    essay:
      '它的名字来自湖南的辰州，那里出的晶体红得最透。小小的菱面体伏在白色的白云石上，像一滴凝住的血。古人拿它作颜料与印泥，也拿它炼丹，后者伤了不少人。'
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
