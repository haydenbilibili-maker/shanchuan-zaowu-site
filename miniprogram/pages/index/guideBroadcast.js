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
  { t: '蛾停歇时翅多平摊，蝶多合拢竖起', q: '怎么区分蝴蝶和蛾子？' }
];

/** 小提示：按时段挑一组，再按日期轮换 */
const TIPS = {
  morning: [
    { t: '早上光线柔，最适合给标本柜拍照', q: '' },
    { t: '还没点亮的物种，先去博物小测认一认', q: '' }
  ],
  day: [
    { t: '标本怕潮也怕晒，避开直射颜色更久', q: '标本平时要怎么养护？' },
    { t: '拿不准是哪一种？拍张照去鉴定认一认', q: '' }
  ],
  night: [
    { t: '夜里把柜灯调暗些，强光会让颜色变淡', q: '为什么强光会让标本褪色？' },
    { t: '睡前问博物君：萤火虫为什么会发光', q: '萤火虫为什么会发光？' }
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
function buildBroadcast(o) {
  const opt = o || {};
  const now = opt.now instanceof Date ? opt.now : new Date();
  const open = opt.guideOpen !== false;
  const nick = cleanNick(opt.nick);
  const hello = `${timeWord(now.getHours())}，${nick || '欢迎来馆'}`;
  const items = [];
  const push = (kind, tag, text, q, store) => {
    if (!text) return;
    items.push({ key: `${kind}-${items.length}`, kind, tag, text, q: open && q ? q : '', store: !!store });
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
  push('tip', '趣味提示', tip.t, tip.q, false);

  return { hello, items };
}

/** 点口播去博物君：只预填问题（from=home），不自动提问 */
function guideUrl(q) {
  return `/subpackages/feature/museum-guide/index?from=home&q=${encodeURIComponent(q)}`;
}

module.exports = { buildBroadcast, guideUrl, cleanNick, FACTS, TIPS, NICK_MAX, LINE_MAX };
