/** /how/operations · v0.4 经营模式页数据 · 对齐《经营模式页文案 v0.4》 */

export interface StoreParams {
  area: string;
  venueType: string;
  investment: string;
  staff: string;
  mainContent: string;
  monthlyRevenue: string;
  payback: string;
  role: string;
}

export interface StoreDetail {
  id: 'lite' | 'pro' | 'max';
  name: string;
  sectionEyebrow: string;
  headline: string;
  tagline: string;
  params: StoreParams;
  has: string[];
  notHas: string[];
  venues: string[];
  contentRhythm: string[];
  diffBullets?: string[];
  /** Max · §4.5 等补充块 */
  extraBlocks?: { title: string; body: string[] }[];
}

export const operationsStoreDetails: StoreDetail[] = [
  {
    id: 'lite',
    name: 'Lite',
    sectionEyebrow: 'Store tier · Lite',
    headline: 'Lite · 品牌的轻盈入口 —— 让自然博物美学在小空间里发光。',
    tagline: '品牌的轻盈入口',
    params: {
      area: '30 - 80㎡',
      venueType: '文创园区 / 高校周边 / 文化街区 / 独立小铺',
      investment: '25 - 50 万人民币',
      staff: '2 - 3 人（店长 1 + 店员 1-2）',
      mainContent: '自然小匣 + 标本小件 + 文创周边 + 基础零售',
      monthlyRevenue: '5 - 15 万人民币',
      payback: '18 - 24 个月',
      role: '新城市试水 / 高校周边获客 / 主理人轻起步',
    },
    has: [
      '标本展示墙（10-20 件代表性标本 · 不出售）',
      '自然小匣销售区（30-50 个 SKU · 价位 200-2000）',
      '矿石/化石/贝壳小件零售（200-1000 价位）',
      '文创周边（明信片 / 笔记本 / 帆布袋 / 海报）',
      '一桌一椅的座位区（让访客可以停 5 分钟）',
      '一个茶水台（自助柠檬水 / 茶）',
    ],
    notHas: [
      '没有标本工坊（不做现场制作）',
      '没有餐饮模块（场地限制 + 团队规模不够）',
      '没有讲解员（店员兼任轻讲解）',
      '没有完整教育模块（仅做「小型主题展」）',
      '没有大型工作坊空间（仅周末偶尔小活动）',
    ],
    venues: [
      '文创园区：北京 798 / 上海 M50 / 长沙后湖 / 成都东郊记忆',
      '高校周边：清华美院附近 / 鲁美 / 央美 / 国美',
      '文化街区：苏州平江路 / 厦门沙坡尾 / 大理人民路',
      '独立小铺：城市次中心的有故事的老房子',
    ],
    contentRhythm: [
      '公众号文章：每店每月不强制 · 总部统一发',
      '小红书内容：每店每周 1 条（轻量上新 / 店内日常）',
      '线下活动：每月 1 次小型主题日（「今天讲蝴蝶」）',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    sectionEyebrow: 'Store tier · Pro',
    headline: 'Pro · 品牌的主力模型 —— 一个完整的自然博物美学体验。',
    tagline: '品牌的主力模型',
    params: {
      area: '80 - 300㎡',
      venueType: '商场文化空间 / 城市核心商圈 / 文化综合体',
      investment: '80 - 180 万人民币',
      staff: '6 - 8 人（店长 1 + 店员 3-4 + 标本师 1-2）',
      mainContent: '完整商品线 + 工坊体验 + 教育 + 应急服务',
      monthlyRevenue: '30 - 60 万人民币',
      payback: '18 - 30 个月',
      role: '主要营收来源 / 加盟标准模板 / 城市旗舰',
    },
    has: [
      '完整标本展示区（30-60 件 · 部分可购）',
      '自然小匣 + 标本零售（150-200 个 SKU）',
      '工坊体验区（小型 · 5-8 人 · 可预约）',
      '教育模块（季节性主题课 · 门槛收费）',
      '应急服务（避雨/避雪/休息/借电话/AED）',
      '茶水座位区（10-20 个座位 · 不强制消费）',
      '公共博物馆功能（部分时段免费参观）',
    ],
    notHas: [],
    venues: [
      '城市核心商场：万象城 / IFS / 太古里 / SKP / 来福士',
      '文化综合体：北京三里屯 / 上海新天地 / 成都远洋太古里',
      '长春这有山（已在营 2 家 Pro 门店 · 同城双店模型）',
      '二线核心商圈：杭州湖滨 / 武汉江汉路 / 西安大唐西市',
    ],
    contentRhythm: [
      '公众号文章：每月 1 篇店内深度故事（店长视角）',
      '小红书内容：每周 2-3 条（深度 + 日常 + 上新）',
      '工坊视频：每月 1 个工坊视频（用 B 站 + 视频号）',
      '线下活动：每月 2-3 场（教育课 + 主题展 + 工坊体验）',
    ],
    diffBullets: [
      '完整的「非拍照价值七件套」全部部署',
      '教育模块按月运行（不是偶尔活动）',
      '工坊体验可预约（而非偶发）',
      '是「小型自然博物馆」的完整形态',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    sectionEyebrow: 'Store tier · Max',
    headline: 'Max · 品牌的灯塔 —— 一个城市的自然博物美学地标。',
    tagline: '品牌的灯塔',
    params: {
      area: '300 - 600㎡（600 为硬上限）',
      venueType: '城市文化地标 / 重点物业旗舰位 / 文旅核心区',
      investment: '250 - 500 万人民币',
      staff: '12 - 18 人（含 concierge / 全职讲解员 / 工坊师 2-3 人）',
      mainContent: '全品类 + 工坊学院 + 公共博物馆 + 高端定制',
      monthlyRevenue: '80 - 180 万人民币',
      payback: '30 - 48 个月',
      role: '品牌灯塔 / 投资人参观点 / 文化合作枢纽 / 媒体来访',
    },
    has: [
      '工坊学院（独立空间 · 可容纳 30-50 人 · 季节性课程）',
      '全职讲解员 1-2 人（每日 2-3 场定时讲解）',
      'Concierge 区（白手套服务 / 高端定制咨询）',
      '高端定制工作室（私人订制标本与自然小匣）',
      '公共博物馆开放时段（每周固定半天 · 免费向公众开放）',
      '文化合作空间（与博物馆 / 学校 / 出版社 / 摄影师合作）',
      '完整咖啡区（早午餐 + 下午茶 · 不只是茶水台）',
      '应急医疗（AED + 持证员工 · 不只是设备）',
      '媒体接待区（带 LED 屏的会客厅）',
    ],
    notHas: [],
    venues: [
      '城市文化地标：北京 798 旗舰 / 上海西岸 / 杭州天目里',
      '文旅核心：杭州西湖边 / 苏州姑苏区 / 大理古城外围',
      '与博物馆 / 美术馆 / 大学的物理邻接位置',
      '重点物业的旗舰位（招商首要锚定品牌）',
    ],
    contentRhythm: [
      '公众号文章：每月 1-2 篇（创始人长文 + 店长故事 + 工坊师叙述）',
      '小红书内容：每周 4-5 条（涵盖所有动作维度）',
      '视频内容：每月 2-3 个（工坊纪录 + 标本制作 + 公共活动）',
      '媒体接待：每月 2-3 次（媒体来访 + 行业拜访 + 投资人参观）',
      '学术合作：每季度 1 个项目（与博物馆 / 大学的策展或讲座）',
    ],
    diffBullets: [
      '是品牌的「灯塔」——是其他店学习的对象',
      '是投资人 / 媒体 / 合作方的「参观目的地」',
      '承担「公共博物馆」的社会角色（一个城市的文化基础设施）',
      '是 1% 承诺最完整的体现（与本地动植物保护机构深度合作）',
    ],
    extraBlocks: [
      {
        title: '为什么 Max 上限是 600㎡',
        body: [
          '600㎡ 是经过 3 个维度验证的硬上限：',
          '维度 1 · 运营效率 —— 超过 600㎡ → 单店人员配置超过 20 人 → 管理半径超出「小作坊」哲学',
          '维度 2 · 内容密度 —— 超过 600㎡ → 需要「填满」的展品压力剧增 → 牺牲质感',
          '维度 3 · 投资回报 —— 超过 600㎡ → 投资门槛超过 500 万 → 回本周期超过 4 年 → 风险陡升',
          '更大的店不是「更好」——是「另一种品类」。我们不做。',
        ],
      },
    ],
  },
];

export interface CompareRow {
  label: string;
  lite: string;
  pro: string;
  max: string;
}

/** §5.1 对照表 */
export const operationsCompareRows: CompareRow[] = [
  { label: '面积', lite: '30-80㎡', pro: '80-300㎡', max: '300-600㎡' },
  { label: '人员', lite: '2-3 人', pro: '6-8 人', max: '12-18 人' },
  { label: '投资', lite: '25-50 万', pro: '80-180 万', max: '250-500 万' },
  { label: '月营收', lite: '5-15 万', pro: '30-60 万', max: '80-180 万' },
  { label: '回本', lite: '18-24 月', pro: '18-30 月', max: '30-48 月' },
  { label: '商品', lite: '基础零售', pro: '完整商品线', max: '全品类' },
  { label: '工坊体验', lite: '✗', pro: '☑ 小型', max: '☑ 工坊学院' },
  { label: '教育模块', lite: '✗', pro: '☑ 月度', max: '☑ 季度课程' },
  { label: '讲解员', lite: '✗', pro: '兼职', max: '全职' },
  { label: 'Concierge', lite: '✗', pro: '✗', max: '☑ 高端定制' },
  { label: '公共博物馆', lite: '✗', pro: '部分开放', max: '周开放' },
  { label: '媒体接待', lite: '✗', pro: '✗', max: '☑ 媒体区' },
  { label: '适用场所', lite: '文创园 / 高校', pro: '商场 / 商圈', max: '文化地标' },
  { label: '品牌角色', lite: '入口', pro: '主力', max: '灯塔' },
  { label: '1% 承诺', lite: '☑ 同款', pro: '☑ 同款', max: '☑ 加深' },
];

export interface MatrixRow {
  label: string;
  lite: string;
  pro: string;
  max: string;
}

export const operationsSevenValuesRows: MatrixRow[] = [
  { label: '教育', lite: '偶发主题日', pro: '月度课程', max: '季度学院' },
  { label: '本地客社群', lite: '基础（会员卡）', pro: '完整（活动）', max: '深度（核心圈）' },
  { label: '复购机制', lite: '季节性陈列', pro: '完整会员体系', max: '高端会员制' },
  { label: '内容生产', lite: '总部统一', pro: '店长产出', max: '全维度产出' },
  { label: 'Concierge', lite: '✗', pro: '轻量', max: '完整白手套' },
  { label: '博物馆功能', lite: '✗', pro: '部分时段', max: '每周固定开放' },
  { label: '公共客厅', lite: '基础避雨', pro: '完整（含应急）', max: '完整（含医疗）' },
];

export interface TimelineColumn {
  year: number;
  theme: string;
  milestones: string[];
  revenue: string;
  staff: string;
  stores: string;
}

export const operationsTimelineColumns: TimelineColumn[] = [
  {
    year: 2026,
    theme: '双店扎根',
    milestones: [
      '这有山双店在营（Pro）',
      '双店模型验证与 SOP 闭环 Q3-Q4',
      '公司化挂牌（约 8 月）',
      '第三店选址 + 年度复盘 Q4',
    ],
    revenue: '80-150 万',
    staff: '10-18 人',
    stores: '2',
  },
  {
    year: 2027,
    theme: '扩张校准',
    milestones: [
      '第三店开业 Q1',
      '1% 报告首发 Q2',
      'Max 旗舰开业 Q4',
      '首批加盟启动 Q4',
    ],
    revenue: '300-600 万',
    staff: '25-30 人',
    stores: '3',
  },
  {
    year: 2028,
    theme: '规模化成形',
    milestones: [
      'Series A 资金到位 Q1',
      '加盟正式开放 上半年',
      '8-10 家店达成 Q4',
      '品牌国际化 Q3-Q4',
    ],
    revenue: '1500-2500 万',
    staff: '60-80 人',
    stores: '8-10',
  },
];

export interface QuarterPlan {
  title: string;
  items: { text: string; done?: boolean }[];
}

export interface YearPlanDetail {
  year: number;
  theme: string;
  thesis: string;
  quarters: QuarterPlan[];
  metrics: { label: string; value: string }[];
  avoid: string[];
}

export const operationsYearPlans: YearPlanDetail[] = [
  {
    year: 2026,
    theme: '双店扎根',
    thesis: '让「山海造物」在长春这有山扎稳根——双店跑通、数据清楚，再谈下一步扩张。',
    quarters: [
      {
        title: 'Q1（2026.01-03）· 已完成',
        items: [
          { text: '品牌核心文档体系建立（vision / 六观 / 治理）', done: true },
          { text: '廉澍 + 李贺合伙关系确认', done: true },
          { text: '长春这有山首家 Pro 门店签约并完成开业', done: true },
          { text: '长春这有山第二家 Pro 门店开业 · 这有山双店布局完成', done: true },
          { text: '双店空间方案与工坊动线落地', done: true },
        ],
      },
      {
        title: 'Q2（2026.04-06）· 进行中',
        items: [
          { text: '山海造物商标核查（委托代理）+ 7-8 类目注册推进' },
          { text: 'shanhaizaowu.com 上线与迭代 + 公众号持续运营' },
          { text: '双店日常运营稳定（人货场、峰谷客流与排班）' },
          { text: '公司化改制筹备（个体工商户 → 有限责任公司 · 材料 / 股权 / 章程）' },
          { text: '合规自查表完成 + 缺口处理' },
          { text: '双店员工梯队招聘、培训与轮岗' },
        ],
      },
      {
        title: 'Q3（2026.07-09）',
        items: [
          { text: '公司化升级完成 · 山海造物文化创意有限公司挂牌（约 2026 年 8 月）' },
          { text: '双店协同运营 + 模型验证（数据与复购结构）' },
          { text: '公共客厅服务 SOP 落地测试（这有山 Pro 双店）' },
          { text: '非拍照价值七件套在双店的部署完整化' },
          { text: '1% 承诺与首批合作机构对话（山水自然保护中心等）' },
          { text: '内部 SOP 文档化（店长手册 v0.1 · 店员手册 v0.1）' },
        ],
      },
      {
        title: 'Q4（2026.10-12）',
        items: [
          { text: '双店运营数据全面复盘' },
          { text: '2026 全年数据 + 模型校准' },
          { text: '第三家店选址（Pro 试水 · 长春同城第二点位或沈阳 / 大连等）' },
          { text: '有限责任公司挂牌后的治理、财税与合同主体对齐复盘' },
          { text: '2026 年度报告（含 1% 承诺执行）' },
        ],
      },
    ],
    metrics: [
      { label: '在营直营（长春这有山）', value: '2 家（Pro）' },
      { label: '公司主体', value: '山海造物文化创意有限公司挂牌（约 2026 年 8 月）' },
      { label: '全年营收目标（双店合计）', value: '80 - 150 万人民币' },
      { label: '全年到访人次（双店合计）', value: '6000 - 16000 人次' },
      { label: '内容产出', value: '公众号 4-6 篇 / 小红书 50-80 条' },
      { label: '1% 承诺金额', value: '8000 - 15000 元（首年捐赠 · 双店口径）' },
    ],
    avoid: [
      '不在双店模型未跑通前开第三家',
      '不在数据未稳定前盲目找投资',
      '不在文档未完整前启动加盟',
      '不为流量牺牲品牌调性',
      '不在公共客厅服务模块成熟前过度宣传',
    ],
  },
  {
    year: 2027,
    theme: '扩张校准',
    thesis: '让「山海造物」从同城双店走向区域化与加盟体系化。',
    quarters: [
      {
        title: 'Q1（2027.01-03）',
        items: [
          { text: '第三家店开业（Pro · 长春同城第二点位或沈阳 / 大连等）' },
          { text: '加盟体系 v1.0 文档化（不公开发布 · 内部使用）' },
          { text: '投资人初步接触（不正式 pitch · 信号传递）' },
          { text: '挂牌主体下第三店资产、劳动与采购合同口径统一复核' },
        ],
      },
      {
        title: 'Q2（2027.04-06）',
        items: [
          { text: '首份《1% 承诺年度透明报告》发布' },
          { text: '第三家店运营满 3 个月数据校准' },
          { text: '加盟体系 v1.1 修订（基于第三店与双店复盘）' },
          { text: '首批种子加盟意向方筛选（2-3 家 · 不签约 · 只锁定）' },
        ],
      },
      {
        title: 'Q3（2027.07-09）',
        items: [
          { text: 'Max 旗舰或第四店选址（北上深一线 · 视第三店数据而定）' },
          { text: '投资人正式 Pitch 启动（Pre-A / Series A）' },
          { text: '加盟体系 v1.5 finalize · 准备小范围加盟启动' },
          { text: '教育模块从店内延伸到城市内（与本地学校 / 博物馆合作）' },
        ],
      },
      {
        title: 'Q4（2027.10-12）',
        items: [
          { text: 'Max 旗舰开业（或第四店 Pro 落地 · 以选址结果为准）' },
          { text: '投资人轮次 finalize（Series A 落地或延后）' },
          { text: '首批 2 家种子加盟店启动（不超过 2 家）' },
          { text: '2027 年度报告 + 三年规划 mid-term 复盘' },
        ],
      },
    ],
    metrics: [
      { label: '店铺数量', value: '2 → 3 家（含 1 Max 旗舰）' },
      { label: '全年营收目标', value: '300 - 600 万人民币' },
      { label: '员工人数', value: '约 15-25 人 → 25-30 人（随第三店与 Max 落地）' },
      { label: '投资人接触', value: '5-10 家深度沟通 → 2-3 家 termsheet' },
      { label: '1% 承诺金额', value: '30000 - 60000 元' },
      { label: '首份年度报告', value: '2027 年 4 月' },
    ],
    avoid: [
      '不为了投资人加快扩张节奏',
      '不在加盟体系成熟前开放招商',
      '不接受要求超过 20% 股权的早期投资',
      '不为了估值放弃 1% 承诺',
      '不为了「市场教育」做不像我们的内容',
    ],
  },
  {
    year: 2028,
    theme: '规模化成形',
    thesis: '让「山海造物」成为一个让别人看了说「哦原来还可以这样做品牌」的品牌。',
    quarters: [
      {
        title: '上半年（2028.01-06）',
        items: [
          { text: 'Series A 资金到位 + 团队扩张完成' },
          { text: '加盟体系正式对外开放（年度限额 3-5 家）' },
          { text: '第四 / 第五家店开业（含 Pro 类型）' },
          { text: '数字化系统 v2.0 上线（ERP + 小程序 + AI 中心）' },
          { text: '与 1-2 家国家级自然保护机构建立深度合作' },
        ],
      },
      {
        title: '下半年（2028.07-12）',
        items: [
          { text: '加盟扩张到 5-8 家（含直营 + 加盟）' },
          { text: '英文官网上线（开始品牌国际化）' },
          { text: '海外社交媒体启动（Instagram + Substack 通讯）' },
          { text: '首场国际媒体露出（适当节奏 · 不主动求 PR）' },
          { text: '第二份《1% 承诺年度透明报告》发布（含合作机构反馈）' },
          { text: '2028 年度报告 + 五年规划草案' },
        ],
      },
    ],
    metrics: [
      { label: '店铺数量', value: '3 → 8-10 家（含直营 + 加盟）' },
      { label: '全年营收目标', value: '1500 - 2500 万人民币' },
      { label: '员工人数', value: '25-30 → 60-80 人' },
      { label: '加盟店', value: '0 → 3-5 家' },
      { label: '1% 承诺金额', value: '150000 - 250000 元' },
      { label: '国际化启动', value: '英文 web + 海外社交' },
    ],
    avoid: [
      '不为了快速规模化放低加盟门槛',
      '不接受要求 IPO 时间表的资本条件',
      '不去做「出海」概念营销（实在出去就低调出去）',
      '不做与品牌不符的代言 / 联名 / 合作',
      '不在团队没准备好前开新城市',
    ],
  },
];

export const operationsNotDoing: string[] = [
  '不做超过 600㎡ 的店（规模化哲学的硬上限）',
  '不接受要求 5 年内 IPO 的投资条件',
  '不开放加盟超过年度限额（避免品牌质量下滑）',
  '不在团队没准备好前开新城市',
  '不为了流量做「快速营销」',
  '不放弃 1% 承诺（即使财务压力大）',
  '不让公共客厅服务成为营销手段',
  '不为了估值「美化」经营数据',
  '不做与品牌定位不符的联名 / 代言 / 合作',
  '不让任何一家加盟店成为「赚短期钱」的工具',
];
