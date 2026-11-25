/**
 * 首页「博物君口播」（2026-11-23，产品负责人点名：原馆员问候行升级为博物君口播，体现藏家昵称，
 * 文案可动态展示馆内通知 / 博物知识 / 趣味提示，更有温度、可拓展）。
 *
 * 纯函数：不碰 wx、不发请求；守卫 test:home-broadcast 直接调。
 * 口播条目顺序：馆内通知（超管「博物君」页配置，最多 3 条）→ 今日开馆（homeGreeting 的门店状态）
 *              → 博物一知 ×2（按日期轮换）→ 小提示 ×1（按时段 + 日期轮换）。
 * 新加一类口播：在 buildBroadcast 里追加一种 kind 即可（页面只认 tag / text / q / store）。
 */
const { timeWord } = require('./homeGreeting');

const NICK_MAX = 8;

/** 博物一知：每条带一个点了之后预填给博物君的问题（只预填、不自动提问，不占次数） */
const FACTS = [
  { t: '大蓝闪蝶的蓝来自鳞片结构，不是色素', q: '大蓝闪蝶的蓝色是怎么来的？' },
  { t: '蝶翅上铺满细小鳞片，鳞翅目由此得名', q: '蝴蝶翅膀上的鳞片有什么用？' },
  { t: '鹦鹉螺靠壳内一格格气室调节浮力', q: '鹦鹉螺为什么被叫作活化石？' },
  { t: '银杏是现存最古老的种子植物之一', q: '银杏为什么被称为植物界的活化石？' },
  { t: '已描述的甲虫约 40 万种，冠绝动物界', q: '为什么甲虫的种类这么多？' },
  { t: '周期蝉若虫要在地下蛰伏 13 或 17 年', q: '周期蝉为什么要在地下待那么久？' },
  { t: '枯叶蛱蝶合起翅膀，像一片带脉的枯叶', q: '枯叶蛱蝶是怎么伪装的？' },
  { t: '蒲公英的种子靠冠毛乘风，能飘出很远', q: '蒲公英的种子是怎么飞起来的？' },
  { t: '拉丁学名用双名法：属名 + 种加词', q: '物种的拉丁学名是怎么命名的？' },
  { t: '宝贝螺的亮壳，是外套膜一层层裹出的', q: '宝贝螺的壳为什么这么光亮？' },
  { t: '蜻蜓的复眼由上万只小眼组成', q: '蜻蜓的复眼有什么特别之处？' },
  { t: '蛾停歇时翅多平摊，蝶多合拢竖起', q: '怎么区分蝴蝶和蛾子？' },
  { t: '蜜蜂用「八」字舞告诉同伴蜜源的方向', q: '蜜蜂的八字舞是怎么传递信息的？' },
  { t: '蝴蝶的味觉感受器长在脚上', q: '蝴蝶是用什么感知味道的？' },
  { t: '萤火虫的光几乎不发热，被称作冷光', q: '萤火虫为什么会发光？' },
  { t: '蜂鸟是唯一能真正悬停与倒飞的鸟', q: '蜂鸟为什么能悬停？' },
  { t: '珊瑚是动物，靠体内的虫黄藻供给养分', q: '珊瑚是动物还是植物？' },
  { t: '巨杉的种子只有芝麻大小，树却能长到近百米', q: '巨杉为什么能长这么高？' },
  { t: '竹节虫靠拟态与假死躲过天敌', q: '竹节虫是怎么伪装的？' },
  { t: '琥珀是树脂化石，常把远古昆虫封在里面', q: '琥珀里的昆虫是怎么保存下来的？' },
  { t: '蜻蜓点水，其实是在水面上产卵', q: '蜻蜓为什么要点水？' },
  { t: '蚂蚁能搬动超过自身体重许多倍的东西', q: '蚂蚁为什么能搬动比自己重的东西？' },
  { t: '蝉鸣是雄蝉的求偶声，靠腹部鼓膜发声', q: '蝉是怎么发出声音的？' },
  { t: '蝴蝶的翅色既来自色素，也来自鳞片结构', q: '蝴蝶翅膀的颜色是怎么来的？' },
  { t: '螳螂的前足特化成捕捉足，收放极快', q: '螳螂是怎么捕食的？' },
  { t: '萤火虫的幼虫也会发光，多是警戒信号', q: '萤火虫幼虫为什么也发光？' },
  { t: '仙人掌的刺是退化的叶，能减少水分蒸发', q: '仙人掌的刺是叶子吗？' },
  { t: '向日葵幼株会追着太阳转，开花后基本固定', q: '向日葵为什么跟着太阳转？' },
  { t: '苔藓没有真正的根，只靠假根附着', q: '苔藓为什么没有真正的根？' },
  { t: '松树的球果不是果实，种子是裸露的', q: '松树的球果算果实吗？' },
  { t: '猪笼草的捕虫笼里装着消化液，能分解昆虫', q: '猪笼草是怎么捕虫的？' },
  { t: '含羞草被碰后小叶合拢，是膨压变化所致', q: '含羞草为什么会害羞？' },
  { t: '萤石在紫外线下会发出荧光，「荧光」由此得名', q: '萤石为什么会发光？' },
  { t: '云母能一层层剥成极薄的透明片', q: '云母为什么能一层层剥开？' },
  { t: '方解石敲碎了，碎片仍是规则菱面体', q: '方解石敲碎为什么还是方块？' },
  { t: '石英比玻璃硬，能划伤玻璃', q: '石英为什么能划伤玻璃？' },
  { t: '孔雀石的绿色来自其中的铜', q: '孔雀石为什么是绿色的？' },
  { t: '珊瑚礁只占海底很小面积，却养育大量海洋生物', q: '珊瑚礁为什么养得起这么多生物？' },
  { t: '红树林的根泡在海水里也能活', q: '红树林为什么能在海水里生长？' },
  { t: '真菌与树根结成菌根，帮树吸收水分和矿物', q: '菌根是什么？' },
  { t: '蜜蜂有 5 只眼：2 只复眼加 3 只单眼', q: '蜜蜂为什么有 5 只眼睛？' },
  { t: '蚂蚁用触角互相辨认，也靠气味标记路线', q: '蚂蚁是怎么认出同伴的？' },
  { t: '蜻蜓的幼虫叫水虿，在水里捕食小虫', q: '蜻蜓的幼虫生活在哪里？' },
  { t: '蝉的若虫在地下吸食树根的汁液', q: '蝉的幼虫在地下吃什么？' },
  { t: '甲虫的前翅硬化成鞘翅，像一层护甲', q: '甲虫背上的硬壳是什么？' },
  { t: '帝王蝶能迁徙数千公里，跨代完成往返', q: '帝王蝶为什么要迁徙？' },
  { t: '蚂蚁会「放牧」蚜虫，取它们分泌的蜜露', q: '蚂蚁为什么要养蚜虫？' },
  { t: '蜂巢用六边形，同样的蜡能围出更大空间', q: '蜂巢为什么是六边形的？' },
  { t: '只有雌蚊吸血，是为了繁殖所需的蛋白', q: '为什么只有雌蚊子吸血？' },
  { t: '蟋蟀靠双翅摩擦发声，不是用嘴叫', q: '蟋蟀是怎么叫的？' },
  { t: '蜘蛛不是昆虫：8 条腿、身体分两节', q: '蜘蛛是昆虫吗？' },
  { t: '毛毛虫几乎一直在吃，为化蛹攒足能量', q: '毛毛虫为什么一直在吃？' },
  { t: '竹子是草不是树，茎里没有年轮', q: '竹子是树还是草？' },
  { t: '草莓表面的「籽」才是果实，吃的是花托', q: '草莓是浆果吗？' },
  { t: '秋天叶子变黄，是叶绿素先分解了', q: '树叶秋天为什么会变黄？' },
  { t: '树的年轮一年一圈，宽窄记录当年气候', q: '树的年轮能看出什么？' },
  { t: '睡莲的气孔长在朝上的叶面，叶背没有', q: '睡莲的叶子为什么能浮在水面？' },
  { t: '兰花种子极小，没有胚乳，要靠菌根萌发', q: '兰花的种子为什么这么小？' },
  { t: '仙人掌夜里才开气孔，白天关门少失水', q: '仙人掌为什么晚上才呼吸？' },
  { t: '苔藓靠孢子繁殖，不开花也不结果', q: '苔藓为什么不开花？' },
  { t: '蕨类叶背的点点是孢子囊群', q: '蕨类叶子背面的点点是什么？' },
  { t: '多数果实由花的子房发育而来', q: '果实是怎么长出来的？' },
  { t: '气孔能开合，帮植物调节水分散失', q: '树叶上的气孔有什么用？' },
  { t: '植物朝光生长，与生长素分布不均有关', q: '植物为什么会朝着光长？' },
  { t: '石墨和钻石都是碳，只是排列方式不同', q: '钻石和石墨为什么不一样？' },
  { t: '食盐晶体是立方体，颗粒常呈小方块', q: '盐粒为什么是方的？' },
  { t: '水晶常长成六棱柱，是石英的结晶习性', q: '水晶为什么是六棱柱？' },
  { t: '磁铁矿能被磁铁吸住，是少数天然磁性矿物', q: '什么石头能被磁铁吸住？' },
  { t: '黄铁矿泛金属光，常被误认作黄金', q: '「愚人金」是什么？' },
  { t: '滑石是莫氏硬度最低的矿物之一，一划就白', q: '滑石为什么这么软？' },
  { t: '石膏加热脱水后变成熟石膏，遇水又会凝固', q: '石膏是怎么凝固的？' },
  { t: '玛瑙的条纹来自一层层沉积的硅质', q: '玛瑙的纹路是怎么来的？' },
  { t: '黑曜石是火山玻璃，冷得太快来不及结晶', q: '黑曜石为什么是黑色的？' },
  { t: '矿物的条痕色比表面颜色更可靠', q: '怎么用条痕辨别矿物？' },
  { t: '食物链每往上一级，能量大约只剩十分之一', q: '为什么食物链越往上动物越少？' },
  { t: '湿地能蓄水、净水，被称作地球之肾', q: '湿地为什么被称为地球之肾？' },
  { t: '多数开花植物要靠昆虫传粉才能结果', q: '没有蜜蜂会怎样？' },
  { t: '落叶被分解者拆成养分，再回到土壤', q: '落叶最后去了哪里？' },
  { t: '珊瑚白化，是共生藻离开后只剩白色骨骼', q: '珊瑚为什么会白化？' },
  { t: '海草床是许多幼鱼的育幼场', q: '海草床有什么用？' },
  { t: '树冠蒸腾会带走热量，所以林子里更凉', q: '为什么树林里更凉快？' },
  { t: '蚯蚓翻土、打通孔隙，让土壤更透气', q: '蚯蚓对土壤有什么好处？' },
  { t: '候鸟靠地磁、太阳和地形一起定位', q: '候鸟怎么认路？' },
  { t: '潮间带的生物要同时耐干、耐盐、耐浪', q: '潮间带的生物怎么活下来？' },
  { t: '蘑菇是真菌的子实体，不是植物', q: '蘑菇是植物吗？' },
  { t: '不少昆虫以卵或蛹的形态越冬', q: '冬天昆虫都去哪了？' },
  { t: '水草白天光合作用，会往水里放氧', q: '水草为什么会冒泡？' },
  { t: '雨林分乔木层、林下层与地被层', q: '雨林为什么分层？' },
  { t: '河流的源头多是泉水、融雪或高山湖泊', q: '河流的源头是怎么来的？' },
  { t: '化石是遗骸或痕迹被矿物替换后保存下来的', q: '化石是怎么形成的？' },
  { t: '恐龙蛋化石常成窝出现，说明会集中产蛋', q: '恐龙是怎么产蛋的？' },
  { t: '菊石有螺旋壳，是已灭绝的头足类', q: '菊石是什么动物？' },
  { t: '三叶虫是古生代海洋里的节肢动物', q: '三叶虫是什么？' },
  { t: '一般情况下，地层越深年代越古老', q: '怎么判断地层的年龄？' },
  { t: '煤来自远古植物，被埋压后慢慢变质', q: '煤是怎么形成的？' },
  { t: '石灰岩多由海洋生物的钙质遗骸堆积而成', q: '石灰岩是怎么来的？' },
  { t: '煤来自陆地植物，石油多来自海洋浮游生物', q: '煤和石油有什么区别？' },
  { t: '冰芯里的气泡封存着古代大气的样本', q: '冰芯能告诉我们什么？' },
  { t: '蜣螂把粪便滚成球运走，也在帮土壤除粪', q: '屎壳郎为什么要滚粪球？' },
  { t: '蝌蚪用鳃呼吸，长成蛙后改用肺和皮肤', q: '青蛙小时候为什么生活在水里？' }
];

/** 小提示：按时段挑一组，再按日期轮换 */
const TIPS = {
  morning: [
    { t: '早上光线柔，最适合给标本柜拍照', q: '' },
    { t: '还没点亮的物种，先去博物小测认一认', q: '' },
    { t: '券包里有快过期的代金券，顺手看看', q: '', path: '/subpackages/business/coupons/index' },
    { t: '本月积分到账了吗？去积分页对一对', q: '', path: '/subpackages/business/points/index' }
  ],
  day: [
    { t: '标本怕潮也怕晒，避开直射颜色更久', q: '标本平时要怎么养护？' },
    { t: '拿不准是哪一种？拍张照去鉴定认一认', q: '' },
    { t: '钱包的余额与抵扣规则，在钱包页能看全', q: '', path: '/subpackages/business/wallet-hub/index' },
    { t: '每笔订单的 1% 会进公益池，去捐赠页看进度', q: '', path: '/subpackages/business/donations/index' }
  ],
  night: [
    { t: '夜里把柜灯调暗些，强光会让颜色变淡', q: '为什么强光会让标本褪色？' },
    { t: '睡前问博物君：萤火虫为什么会发光', q: '萤火虫为什么会发光？' },
    { t: '睡前看一眼积分与券，别让它们过期', q: '', path: '/subpackages/business/points/index' },
    { t: '今天买的东西，1% 已经记进捐赠页', q: '', path: '/subpackages/business/donations/index' }
  ]
};

/** 每条口播一行放得下的上限（首页单行，不折行） */
const LINE_MAX = 22;

function dayIndex(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function tipBand(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 19) return 'day';
  return 'night';
}

/** 昵称：去空白、过长截断；没有 / 是占位名 → ''（问候改为「欢迎来馆」） */
function cleanNick(nick) {
  const s = String(nick || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '未登录用户' || s === '微信用户') return '';
  return s.length > NICK_MAX ? s.slice(0, NICK_MAX) + '…' : s;
}

/**
 * @param {object} o
 * @param {string} [o.nick]         藏家昵称（profileHelper.resolvePrefillNickName）
 * @param {Date}   [o.now]
 * @param {{line:string}} [o.greeting]  homeGreeting.buildHomeGreeting 的结果（门店状态行）
 * @param {string[]} [o.notices]    馆内通知（getContentDisplayFlags.museumGuideNotices）
 * @param {boolean} [o.guideOpen]   博物君是否开馆；闭馆时不带去博物君的问题、不播通知
 * @returns {{ hello: string, items: Array<{key:string, kind:string, tag:string, text:string, q:string, store:boolean}> }}
 */
/**
 * 信号灯口径（2026-11-25 产品负责人：口播这一个类型不够，升级成红绿灯）
 *   open  → 开馆（绿）：今天在营业   notice → 通知（琥珀）：馆内要事
 *   fact  → 知识（铜金）：博物一知   tip    → 提示（灰）：趣味小知识
 * 灯色只表达「这条是什么性质」，不改文案；文案仍在 tag + text 里。
 */
const TONE_META = {
  open: { tone: 'open', label: '开馆' },
  notice: { tone: 'notice', label: '通知' },
  fact: { tone: 'fact', label: '博物' },
  tip: { tone: 'tip', label: '提示' }
}
const TONE_OF_KIND = { store: 'open', notice: 'notice', fact: 'fact', tip: 'tip' }

function toneOfKind(kind) {
  return TONE_OF_KIND[String(kind || '')] || 'tip'
}

/** 当前条目的信号灯（列表为空时给一个中性「口播」） */
function signalOf(items, index) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return { tone: 'idle', label: '口播' }
  const i = Math.max(0, Math.min(list.length - 1, Number(index) || 0))
  const tone = toneOfKind(list[i] && list[i].kind)
  return TONE_META[tone] || TONE_META.tip
}

function buildBroadcast(o) {
  const opt = o || {};
  const now = opt.now instanceof Date ? opt.now : new Date();
  const open = opt.guideOpen !== false;
  const nick = cleanNick(opt.nick);
  const hello = `${timeWord(now.getHours())}，${nick || '欢迎来馆'}`;
  const items = [];
  // 2026-11-25：口播升级为「信号灯」——每条带 tone（开馆 / 通知 / 知识 / 提示），灯色与右侧短标随条目切换
  const push = (kind, tag, text, q, store, path) => {
    if (!text) return;
    items.push({
      key: `${kind}-${items.length}`, kind, tag, text,
      q: open && q ? q : '',
      store: !!store,
      path: String(path || ''),
      tone: toneOfKind(kind)
    });
  };

  if (open) {
    (Array.isArray(opt.notices) ? opt.notices : []).slice(0, 3).forEach((t) => push('notice', '馆内通知', String(t || '').trim(), '', false));
  }
  const line = opt.greeting && opt.greeting.line;
  if (line) push('store', '今日开馆', line, '', true);

  const di = dayIndex(now);
  const a = FACTS[di % FACTS.length];
  const b = FACTS[(di + 5) % FACTS.length];
  push('fact', '博物一知', a.t, a.q, false);
  push('fact', '博物一知', b.t, b.q, false);

  const band = TIPS[tipBand(now.getHours())];
  const tip = band[di % band.length];
  push('tip', '趣味提示', tip.t, tip.q, false, tip && tip.path);

  return { hello, items };
}

/** 点口播去博物君：只预填问题（from=home），不自动提问 */
function guideUrl(q) {
  return `/subpackages/feature/museum-guide/index?from=home&q=${encodeURIComponent(q)}`;
}

module.exports = { buildBroadcast, guideUrl, cleanNick, signalOf, toneOfKind, TONE_META, FACTS, TIPS, NICK_MAX, LINE_MAX };
