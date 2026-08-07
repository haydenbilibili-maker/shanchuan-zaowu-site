export interface ConsumptionGeneration {
  id: number;
  name: string;
  main: string;
  period: string;
  medium: string;
  value: string;
  decision: string;
  brand: string;
  failure: string;
}

export const consumptionGenerations: ConsumptionGeneration[] = [
  {
    id: 1,
    name: '第一代',
    main: '物物代换',
    period: '远古-农业',
    medium: '实物',
    value: '使用价值',
    decision: '直接交换',
    brand: '（无品牌）',
    failure: '交换效率低 · 难以匹配双方需求',
  },
  {
    id: 2,
    name: '第二代',
    main: '货币购买',
    period: '工业革命起',
    medium: '货币',
    value: '交换价值',
    decision: '性价比',
    brand: '早期工业品 · 大规模生产',
    failure: '同质化竞争 · 难以区分品质',
  },
  {
    id: 3,
    name: '第三代',
    main: '品牌购买',
    period: '1950s-90s',
    medium: '货币+符号',
    value: '身份价值',
    decision: '品牌认同',
    brand: 'LV · 可口可乐 · 麦当劳',
    failure: '缺体验感 · 拥有 ≠ 享受',
  },
  {
    id: 4,
    name: '第四代',
    main: '服务体验',
    period: '2000s-10s',
    medium: '物+服务',
    value: '体验价值',
    decision: '体验质量',
    brand: '星巴克 · 海底捞 · Apple Store',
    failure: '体验同质化 · 选择疲劳',
  },
  {
    id: 5,
    name: '第五代',
    main: '流量算法',
    period: '2010s-20s',
    medium: '算法推送',
    value: '注意力价值',
    decision: '被动接受',
    brand: '抖音 · 小红书 · 完美日记 · 钟薛高',
    failure: '信息茧房 · 推送疲劳 · 短期满足',
  },
];

export const consumptionGen6: ConsumptionGeneration = {
  id: 6,
  name: '第六代',
  main: '文化精神',
  period: '2020s-未来',
  medium: '认同+关系+故事',
  value: '价值观共鸣',
  decision: '主动选择',
  brand: '山海造物 · 中川政七 · 蔦屋',
  failure: '尚在演进 · 规模化是关键挑战',
};

export const timelineNodes = [
  { x: 55, gen: '第一代', main: '物物代换', period: '远古-农业', core: '使用价值', example: '粮换布' },
  { x: 165, gen: '第二代', main: '货币购买', period: '工业革命起', core: '交换价值', example: '买米买油' },
  { x: 275, gen: '第三代', main: '品牌购买', period: '1950s-90s', core: '身份价值', example: '名牌名表' },
  { x: 385, gen: '第四代', main: '服务体验', period: '2000s-10s', core: '体验价值', example: '星巴克' },
  { x: 495, gen: '第五代', main: '流量算法', period: '2010s-20s', core: '注意力价值', example: '抖音种草' },
];

export const timelineDrivers = [
  { x: 110, label: '货币发明' },
  { x: 220, label: '物质过剩' },
  { x: 330, label: '体验觉醒' },
  { x: 440, label: '算法兴起' },
  { x: 550, label: '算法疲劳' },
];

export const gen5Symptoms = [
  '打开短视频刷不停 · 合上后什么都没记住',
  '「算法懂我」——但每次推送都让人空虚',
  '冲动下单 · 拆完包后悔',
  '收藏夹里大量种草 · 真正买的很少',
  '直播间冲动下单 · 醒来发现都是冲动',
  '「我是谁」被算法定义',
  '关键词：被动 · 短期 · 热闹',
];

export const gen6Choices = [
  '卸载短视频 / 关闭推送',
  '主动取关大 V · 只留有真东西的人',
  '慢决策 + 长持有',
  '找小品牌 · 独立创作者 · 有故事的物',
  '愿为故事 / 价值观付溢价',
  '线下书店 · 博物馆 · 独立工作室',
  '「我」重新定义自己买什么',
  '关键词：主动 · 长期 · 安静',
];

export const consumptionDimensions = [
  {
    num: '01',
    title: '物质载体',
    gen6: '多为非物质：播客订阅 · 公众号付费 · 线下读书会 · 心理咨询',
    shanhai: '提供可触摸的标本 · 自然小匣 · 矿石 · 化石——给精神消费的人一个「实体」',
  },
  {
    num: '02',
    title: '手段与真诚',
    gen6: '主动卸载抖音 · 关闭推送 · 取关大 V · 远离种草',
    shanhai:
      '种草、直播与 KOL 都只是手段 · 不能因噎废食——不做流俗的套路，回归产品与内容的真诚',
  },
  {
    num: '03',
    title: '被主动找到',
    gen6: '通过深度内容 · 朋友推荐 · 一次到访的记忆找到品牌',
    shanhai: '慢增长 · 不强求曝光 · 让真心想找我们的人找到',
  },
  {
    num: '04',
    title: '价值观共鸣',
    gen6: '买的不是功能或符号 · 是品牌「代表了什么」',
    shanhai: '六观体系 · 1% 营收捐赠 · 合规红线——价值观写明白 · 顾客对齐后再来',
  },
  {
    num: '05',
    title: '时间感',
    gen6: '愿为长期持有的物付溢价 · 拒绝快销 · 追求「用 10 年」',
    shanhai: '30 年品牌目标而非 5 年百倍——产品本身也是时间的物（标本可传家 · 化石跨越亿年）',
  },
  {
    num: '06',
    title: '关系而非交易',
    gen6: '寻找「长期关系」 · 进店不只是买东西',
    shanhai: '店是博物馆 · 应急服务 · 公共客厅——常客可以来坐一会儿 · 不消费也欢迎',
  },
];

export interface BenchmarkEntry {
  name: string;
  role: string;
  gen: string;
  learn: string;
  notlearn: string;
  highlight?: 'warning' | 'default';
}

export const consumptionBenchmarks: BenchmarkEntry[] = [
  {
    name: '中川政七商店',
    role: '灵魂模板 · 同代标杆',
    gen: '第六代物质载体',
    learn: '不装的规模化 · 三百年的耐心 · 把传统包装成现代生活方式',
    notlearn: '日本资本结构 · 本土供应链 · 工艺立场（我们走自然博物路）',
  },
  {
    name: '蔦屋书店',
    role: '形态模板 · 跨代借鉴',
    gen: '第四代体验 + 第六代价值观共鸣',
    learn: '空间即叙事 · 商品分类按情境 · 体验大于交易',
    notlearn: '连锁化空间标准化（我们走在地化路）',
  },
  {
    name: '泡泡玛特',
    role: '反面镜子 · 上一代品牌',
    gen: '第五代流量驱动',
    learn: 'IP 化的杠杆 · 情绪价值的定价 · 全球化经验',
    notlearn: '盲盒机制 · 短期变现 · 收割粉丝心理',
    highlight: 'warning',
  },
];
