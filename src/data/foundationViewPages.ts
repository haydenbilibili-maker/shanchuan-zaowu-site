export type FoundationViewNav = { slug: string; label: string } | null;
export type FoundationViewRelated = { href: string; label: string } | null;

export type FoundationViewPage = {
  num: string;
  name: string;
  en: string;
  subtitle: string;
  statement: string;
  boundary: string[];
  action: string[];
  related: FoundationViewRelated;
  prev: FoundationViewNav;
  next: FoundationViewNav;
};

export const foundationViewPages: Record<string, FoundationViewPage> = {
  nature: {
    num: '01', name: '自然观', en: 'On Nature', subtitle: '向自然学习',
    statement: '我们不教育自然 · 让它进入日常。\n家里多一颗矿石、案头多一只蝴蝶——\n这不是装饰主义 · 是生活方式的选择。',
    boundary: [
      '不做"猎奇"自然',
      '不夸"稀有"',
      '不用"濒危"作为卖点',
    ],
    action: [
      '标本来源：自然死亡 / 合法养殖副产品',
      '不参与野外大规模采集 · 不做保护物种 · 不做来源不明的标本',
      '违反这条 · 主动下架 · 不计成本',
    ],
    related: null,
    prev: null,
    next: { slug: 'space', label: '02 · 空间观' },
  },
  space: {
    num: '02', name: '空间观', en: 'On Space', subtitle: '店即博物馆',
    statement: '商店让人快速买东西。博物馆让人慢下来。\n山海造物开的是后者——\n一座小型自然博物馆 · 不是一家"卖标本的店"。',
    boundary: [
      '不做"打卡式"空间',
      '不做"扫码送礼"引流装置',
      '不为拍照而设计角落',
    ],
    action: [
      '首店空间三铁律：不超 4 主色 / 背景音不超 50 dB / 每平米至少 60 cm 留白',
      '任何一处破坏铁律 · 重新做',
    ],
    related: null,
    prev: { slug: 'nature', label: '← 01 · 自然观' },
    next: { slug: 'content', label: '03 · 内容观' },
  },
  content: {
    num: '03', name: '内容观', en: 'On Content', subtitle: '走过问题',
    statement: '我们写问题 · 不写答案。\n有些事真的在想、真的在做、真的有体会——\n把过程写出来 · 比写答案更诚实。',
    boundary: [
      '不蹭热点',
      '不做震惊体标题',
      '不做"5 分钟教你 X 个 Y"',
      '不做"为了流量而存在"的内容',
    ],
    action: [
      '公众号不定期发布 · 每篇 3000-8000 字',
      '只在"真有话说"时发 · 宁可一个月不发',
    ],
    related: null,
    prev: { slug: 'space', label: '← 02 · 空间观' },
    next: { slug: 'talent', label: '04 · 人才观' },
  },
  talent: {
    num: '04', name: '人才观', en: 'On Talent', subtitle: '青年优先',
    statement: '青年不是年龄 · 是状态——\n愿意从头学一件事 · 不怕做不熟悉的事 · 对未来还有期待。\n工作室对青年永远开门。',
    boundary: [
      '不卷加班（工作时间 9:30-18:30）',
      '不画大饼',
      '不搞奇怪的团建',
      '不省工资',
    ],
    action: [
      '招聘原则：同等条件下 · 优先选青年',
      '工资标准：同地区中等偏上 + 季度奖金 + 长期跟随的期权（公司化之后）',
      '2026 Q3 启动校园招聘 · 长春当地高校优先（吉林大学 / 东北师大 / 长春大学等）',
    ],
    related: null,
    prev: { slug: 'content', label: '← 03 · 内容观' },
    next: { slug: 'pledge', label: '05 · 承诺观' },
  },
  pledge: {
    num: '05', name: '承诺观', en: 'On Commitment', subtitle: '会被违反时主动赔偿的事',
    statement: '承诺不是宣传。\n承诺是：写下来、有数字、可查证、违反时主动赔偿。\n不能被这四条检验的 · 不叫承诺。',
    boundary: [
      '不做"做最好的"/"做第一的"/"改变行业的"——无法检验',
      '不做"营销式公益"——具体怎么做、做多少、说不清',
      '不承诺任何无法被时间检验的事',
    ],
    action: [
      '当下三个承诺：1% 营收捐赠 · AED 设备 · 应急求助服务',
      '每年 4 月发布《承诺年度透明报告》',
      '违反时：主动公开 → 主动赔偿 → 修订流程',
    ],
    related: { href: '/foundation/conservation', label: '1% 承诺完整执行细则 →' },
    prev: { slug: 'talent', label: '← 04 · 人才观' },
    next: { slug: 'compliance', label: '06 · 合规观' },
  },
  compliance: {
    num: '06', name: '合规观', en: 'On Compliance', subtitle: '30 年的护身符',
    statement: '合规不是限制——是让我们能心安做这件事 30 年的护身符。\n红线一条触碰 · 其他五观全部失效。\n这就是它在六观顶端的位置。',
    boundary: [
      '不做任何中国国家一级保护动物的标本（任何形式）',
      '不做任何二级保护动物的标本（除非有完整许可证）',
      '不做任何 CITES 附录 I 物种',
      '不做活体动物交易（任何品类）',
      '不做来源不明的标本',
      '不参与"洗源"交易',
    ],
    action: [
      '每件标本入库登记完整来源信息（物种学名 / 来源类型 / 供应商 / 入库日期 / 凭证编号）',
      '每件展示/销售标本附"博物档案卡"',
      '每 6 个月做一次完整内部合规自查（覆盖 7 大类 70+ 项）',
      '触碰任一红线：立即下架 · 立即律师咨询 · 必要时公开说明',
    ],
    related: null,
    prev: { slug: 'pledge', label: '← 05 · 承诺观' },
    next: null,
  },
};

export const foundationViewSlugs = Object.keys(foundationViewPages);
