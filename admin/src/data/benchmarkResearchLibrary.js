/**
 * 山海造物 · 对标研究资料库
 * 来源：桌面归档 `山海造物-归档/03_对标研究`
 * （宪章 / 方法论 / 山川造物期 & 山海造物期品牌报告目录）
 */

export const BENCHMARK_META = {
  title: '对标研究体系',
  source: '山海造物-归档/03_对标研究',
  charter: '对标研究宪章 v0.2',
  methodology: '对标品牌研究方法论 v0.2',
  updatedAt: '2026-05',
  principle: '研究产出是决策输入，不是自我感动的终点。每份报告必须落到绿/黄/红三区可执行判断。',
}

/** 世界观三轴（宪章 §2.1） */
export const BENCHMARK_AXES = [
  {
    id: 'philosophy',
    name: '品牌哲学轴',
    short: '魂',
    desc: '我们是谁：长期主义、不装的规模化、vision 优先于短利',
    question: '这家对标教会我们怎样做「有灵魂的规模化」？',
  },
  {
    id: 'merchandising',
    name: '商品化轴',
    short: '血肉',
    desc: '我们怎么活：IP / SKU / 订阅 / 渠道机制如何把文化变成可卖的货',
    question: '商品与 IP 如何规模化，而不稀释品类严肃性？',
  },
  {
    id: 'space',
    name: '空间机构轴',
    short: '骨架',
    desc: '我们长成什么样：提案型零售、准博物馆、多店复制边界',
    question: '门店与机构形态如何承载叙事，又可控扩张？',
  },
]

/** 三群（宪章 §2.3） */
export const BENCHMARK_GROUPS = [
  {
    id: 'A',
    name: '群 A · 品牌哲学与精神祖谱',
    axisId: 'philosophy',
    role: '魂',
    color: '#2f6b4f',
    summary: '决定我们是谁。工艺品类现代化、自然/文化严肃性如何规模化。',
  },
  {
    id: 'B',
    name: '群 B · 商业机制与商品化路径',
    axisId: 'merchandising',
    role: '血肉',
    color: '#c45c26',
    summary: '决定我们怎么生存。IP 矩阵、订阅慢生活、文创零售机制的两极样本。',
  },
  {
    id: 'C',
    name: '群 C · 空间与机构形态',
    axisId: 'space',
    role: '骨架',
    color: '#3d6b8c',
    summary: '决定形态与边界。提案型书店、博物机构零售、户外/生活方式空间。',
  },
]

/** 方法论：报告统一骨架（方法论 §三） */
export const BENCHMARK_REPORT_OUTLINE = [
  { step: '01', title: '启动卡', desc: '三个研究问题 + 明确不做什么' },
  { step: '02', title: '全景还原', desc: '定位 / 关键数据 / 业务结构' },
  { step: '03', title: '发展阶段', desc: '关键转折点与对山海造物的提示' },
  { step: '04', title: '经验提炼', desc: '可迁移机制，忌口号化' },
  { step: '05', title: '暗角与风险', desc: '失败案例 / 跨文化陷阱（必有）' },
  { step: '06', title: '三区判断', desc: '绿可执行 · 黄改写 · 红禁区' },
  { step: '07', title: '合并坐标系', desc: '与已有对标互证，避免单点研究' },
  { step: '08', title: '即时动作', desc: '按时间分层的可执行清单' },
]

/** 三区框架（方法论 §2.2 动作3） */
export const BENCHMARK_ZONES = [
  {
    id: 'green',
    name: '绿区',
    tone: 'green',
    meaning: '可直接借鉴并落地',
    rule: '每条必须回答：在哪个项目、哪个时点、由谁开始做',
    samples: [
      '中川政七「愿景 51% : 利益 49%」考核 → 纳入年度复盘 vision 项',
      '准博物馆叙事作为商业化护栏 → 门店讲解与价签话术统一',
      '物种→熟语命名方法论 → 每城一标本一熟语的收集体系',
    ],
  },
  {
    id: 'yellow',
    name: '黄区',
    tone: 'yellow',
    meaning: '可借鉴但必须改写',
    rule: '每条写清：原版是什么 / 我们改成什么 / 为什么改',
    samples: [
      '泡泡玛特盲盒博彩机制 → 改为「自然收集图鉴」低刺激收集玩法',
      'Felissimo 订阅慢生活 → 保留社群共创，弱化纯邮购依赖',
      '蔦屋提案型选品 → 保留策展逻辑，控制 SKU 复杂度',
    ],
  },
  {
    id: 'red',
    name: '红区',
    tone: 'red',
    meaning: '明确不做 / 诱惑场景要挡',
    rule: '每条写清诱惑场景 + 对内话术',
    samples: [
      '为冲规模牺牲标本合规与证据链',
      '快时尚式联名导致 IP 廉价化',
      '无决策对象的「先看看再说」研究扩写',
    ],
  },
]

/**
 * 对标品牌库（山海造物期目录为主，辅以山川造物期已完成报告）
 * status: done | draft | queued
 */
export const BENCHMARK_BRANDS = [
  // 群 A
  {
    id: 'nakagawa',
    name: '中川政七商店',
    nameEn: 'Nakagawa Masashichi Shoten',
    group: 'A',
    era: 'both',
    status: 'done',
    role: '工艺品类现代化重组者',
    oneLiner: '有灵魂的工坊如何长成可复制系统，而不装地规模化。',
    learn: '愿景优先考核、品类舵手定位、长期主义组织语言',
    risk: '中国供应链与「工艺叙事」容易变成空话',
    docs: ['山川造物期调研', '山海造物期报告'],
  },
  {
    id: 'aesop',
    name: 'Aesop',
    nameEn: 'Aesop',
    group: 'A',
    era: 'shanhai',
    status: 'done',
    role: '空间即品牌哲学',
    oneLiner: '极克制的产品线 + 强空间叙事，把零售做成可感知的世界观。',
    learn: '少 SKU 深体验、门店即媒介',
    risk: '过度设计导致成本失控与可复制性下降',
    docs: ['山海造物期报告'],
  },
  {
    id: 'patagonia',
    name: 'Patagonia',
    nameEn: 'Patagonia',
    group: 'A',
    era: 'shanhai',
    status: 'done',
    role: '使命驱动的商业护城河',
    oneLiner: '把价值观写成经营约束，而不是营销口号。',
    learn: '使命即筛选器、维修/循环延长信任',
    risk: '口号化「可持续」而无供应链证据',
    docs: ['山海造物期报告'],
  },
  {
    id: 'palace',
    name: '故宫文创',
    nameEn: 'Palace Museum Cultural Creative',
    group: 'A',
    era: 'shanhai',
    status: 'done',
    role: '文化资产零售化',
    oneLiner: '把不可复制的文化母体转成可售卖的情绪与日用品。',
    learn: 'IP 母体深度、系列化衍生',
    risk: '文创同质化与「贴图周边」陷阱',
    docs: ['山海造物期报告'],
  },
  // 群 B
  {
    id: 'popmart',
    name: '泡泡玛特',
    nameEn: 'POP MART',
    group: 'B',
    era: 'both',
    status: 'done',
    role: 'IP 矩阵 + 收集机制',
    oneLiner: '群 B 的「快」极：情绪价值商品化与渠道爆款机器。',
    learn: 'IP 矩阵、收集欲、线下机器触点',
    risk: '博彩化刺激、内容空心、潮品周期',
    docs: ['调研+可研'],
  },
  {
    id: 'felissimo',
    name: 'Felissimo',
    nameEn: 'Felissimo',
    group: 'B',
    era: 'both',
    status: 'done',
    role: '主题部门制 / 订阅慢路径',
    oneLiner: '群 B 的「慢」极：内部兴趣孵化 × 社群共创；亦是转型挣扎样本。',
    learn: '部活孵化机制、社群共创',
    risk: '订阅老化、数字化补位失败',
    docs: ['山川造物期+山海造物期'],
  },
  {
    id: 'muji',
    name: 'MUJI',
    nameEn: 'MUJI',
    group: 'B',
    era: 'shanhai',
    status: 'done',
    role: '去品牌化的商品系统',
    oneLiner: '用克制美学与生活提案，把「无印」做成可扩张的商品操作系统。',
    learn: '生活提案选品、标准化复制',
    risk: '提案空心化与价格带挤压',
    docs: ['山海造物期报告'],
  },
  {
    id: 'guanxia',
    name: '观夏',
    nameEn: 'To Summer',
    group: 'B',
    era: 'shanhai',
    status: 'done',
    role: '东方香氛生活方式',
    oneLiner: '文化情绪商品的当代样本：气味记忆 × 空间零售。',
    learn: '感官记忆商品化、门店氛围',
    risk: '品类过窄与季节波动',
    docs: ['山海造物期报告'],
  },
  {
    id: 'documents',
    name: '闻献',
    nameEn: 'Documents',
    group: 'B',
    era: 'shanhai',
    status: 'done',
    role: '高端香氛叙事零售',
    oneLiner: '用强叙事与稀缺感抬升客单，对标本礼赠有启发。',
    learn: '叙事溢价、礼赠场景',
    risk: '过度奢侈化脱离日常复购',
    docs: ['山海造物期报告'],
  },
  // 群 C
  {
    id: 'tsutaya',
    name: '蔦屋書店',
    nameEn: 'TSUTAYA / Share Lounge',
    group: 'C',
    era: 'both',
    status: 'done',
    role: '提案型零售空间',
    oneLiner: '用选品提案重新定义空间；含关店暗角研究。',
    learn: '策展式动线、生活方式提案',
    risk: '重资产复制、选址失败（如西安样本）',
    docs: ['可研'],
  },
  {
    id: 'va',
    name: 'V&A',
    nameEn: 'Victoria and Albert Museum',
    group: 'C',
    era: 'both',
    status: 'done',
    role: '机构严肃性 × 商业化',
    oneLiner: '准博物馆路径的全球样本：藏品→零售与 IP 授权张力结构。',
    learn: '严肃性护栏、商业子公司隔离',
    risk: '分馆亏损、联名廉价化',
    docs: ['研究报告'],
  },
  {
    id: 'disney',
    name: 'Disney',
    nameEn: 'Disney',
    group: 'C',
    era: 'shanhai',
    status: 'done',
    role: 'IP 宇宙与体验零售',
    oneLiner: 'IP 母体如何驱动乐园、零售与内容的飞轮。',
    learn: 'IP 宇宙、体验溢价',
    risk: '重资本与本地文化适配',
    docs: ['可研报告'],
  },
  {
    id: 'natgeo',
    name: 'National Geographic',
    nameEn: 'National Geographic',
    group: 'C',
    era: 'shanhai',
    status: 'done',
    role: '自然内容机构品牌',
    oneLiner: '自然叙事机构如何商业化，而不丢掉信任资本。',
    learn: '内容即信任、教育延伸',
    risk: '内容娱乐化侵蚀权威',
    docs: ['研究报告'],
  },
  {
    id: 'skansen',
    name: 'Skansen',
    nameEn: 'Skansen',
    group: 'C',
    era: 'shanhai',
    status: 'done',
    role: '露天博物 / 活态展示',
    oneLiner: '自然与民俗的活态展示如何变成可持续到访机构。',
    learn: '活态展览、教育门票结构',
    risk: '季节性与运营成本',
    docs: ['调研报告'],
  },
  {
    id: 'kew',
    name: 'Kew',
    nameEn: 'Royal Botanic Gardens, Kew',
    group: 'C',
    era: 'shanhai',
    status: 'done',
    role: '植物园机构零售',
    oneLiner: '科学机构如何做会员、零售与公共教育。',
    learn: '会员制、科学传播零售',
    risk: '机构官僚与商业冲突',
    docs: ['研究报告'],
  },
  {
    id: 'mariage',
    name: 'Mariage Frères',
    nameEn: 'Mariage Frères',
    group: 'C',
    era: 'shanhai',
    status: 'done',
    role: '精品茶空间零售',
    oneLiner: '品类专精 + 空间仪式感抬高客单与礼赠。',
    learn: '专精品类、仪式化陈列',
    risk: '过度精致导致日常复购弱',
    docs: ['研究报告'],
  },
  {
    id: 'oneway',
    name: '单向街',
    nameEn: 'One Way Street',
    group: 'C',
    era: 'shanhai',
    status: 'done',
    role: '文化空间社区',
    oneLiner: '中国本土文化空间运营与社群连接样本。',
    learn: '活动策展、社群黏性',
    risk: '商业闭环弱、依赖活动',
    docs: ['调研报告'],
  },
]

export const BENCHMARK_SPECIAL_TOPICS = [
  { id: 'store-expand', title: '门店扩张模式专题', era: 'shanhai', desc: '多店复制边界、选址与组织能力' },
  { id: 'specimen-chain', title: '标本艺术品产业链调研', era: 'shanchuan', desc: '产区、加工、合规与证据链' },
  { id: 'public-coop', title: '公共合作机会调研', era: 'shanchuan', desc: '馆校企合作与公共项目接口' },
]

export const BENCHMARK_COORDINATE_COLUMNS = [
  '品牌类型',
  '创立年代',
  '当前规模',
  '增长速度',
  '核心方法论',
  '对山海造物的角色',
  '风险信号',
  '当下状态',
]

export function getBrandsByGroup(groupId) {
  return BENCHMARK_BRANDS.filter((b) => b.group === groupId)
}

export function getBenchmarkStats() {
  const total = BENCHMARK_BRANDS.length
  const done = BENCHMARK_BRANDS.filter((b) => b.status === 'done').length
  const byGroup = BENCHMARK_GROUPS.map((g) => ({
    ...g,
    count: getBrandsByGroup(g.id).length,
  }))
  return { total, done, byGroup, topics: BENCHMARK_SPECIAL_TOPICS.length }
}
