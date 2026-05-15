/** 六观之下的「经营第一原则」——摘自品牌共识稿，托管于 /foundation/strategy */

export type StrategicPrinciple = {
  number: string;
  title: string;
  description: string;
  practices?: string[];
};

export const foundationStrategicPrinciples: StrategicPrinciple[] = [
  {
    number: 'I',
    title: '不装的规模化',
    description:
      '不为追求规模而牺牲品牌核心，不为追求规模而装高深、装稀缺；也不因为坚持品质而拒绝规模化（不做「小确幸式自我满足」）。中道——既扩张又克制。',
    practices: ['加盟开放但门槛严', '价格中位数定位', '内容输出有标准'],
  },
  {
    number: 'II',
    title: 'Vision 51% : 利益 49%',
    description:
      '任何商业决策中，「是否贡献 Vision」权重 51%，「是否带来利润」权重 49%。51 对 49 不是 50/50，是 Vision 微弱占优。',
    practices: [
      '接合作时优先看是否符合 Vision，再看赚不赚钱',
      '招人时先看是否认同 Vision，再看专业能力',
      'KPI 设计：店长考核必须包含 Vision 维度',
    ],
  },
  {
    number: 'III',
    title: '多 format 而非单一店型',
    description:
      '不追求一种「完美店型」复制 100 家，接受不同场景需要不同 format。format 之间共享 DNA，但允许独立演化。',
    practices: [
      'Lite / Pro / Max 三档场景化定位',
      '每个 format 都有自己的「非拍照价值」七件套',
      '加盟方根据物业 / 客群 / 城市选档',
    ],
  },
  {
    number: 'IV',
    title: '「非拍照价值」永远先于「拍照价值」',
    description:
      '「山海造物」天然上镜，进入网红打卡热潮是大概率事件。但颜值是入口，不是商业模型。必须 Day 1 就有「非拍照价值」七件套。',
    practices: [
      '每一家新店开业前必须把七件套的初版跑起来',
      '永远不接「纯网红打卡店」性质的商场招商邀请',
    ],
  },
  {
    number: 'V',
    title: '失败的容许 + 自我感动的警惕',
    description:
      '容许新尝试失败，但同时警惕「被自己感动」的产物。失败 + 验证机制 = 真正的成长。',
    practices: [
      '每份新文档附带「自我感动检查」标签',
      '季度做一次 v0.x 验证 review',
      '重要决策低容错，新尝试高容错',
    ],
  },
  {
    number: 'VI',
    title: '公共承诺与 1% 营收',
    description:
      '每一家直营店与加盟店每年营业收入的 1% 无条件捐赠给环保 / 自然博物 / 野生动植物保护 / 护林员相关公益。每一家店同时承担作为城市公共客厅的基础公共服务（AED、应急充电、应急雨伞、饮用水等）。「山海造物」的店不只是商业空间，是城市公共生活的一部分。',
    practices: [
      '1% 营收捐赠（不是利润）',
      '门店即博物馆 + 门店即公共客厅',
      'AED / 应急充电 / 应急雨伞 / 饮用水',
      '一线护林员 / 巡护员定向支持',
    ],
  },
];

export const foundationThirtyYearVisionIntro =
  '我们做这件事的时间表是 30 年——而不是 5 年。下列区间为方向性表述，用于内部对齐与对外说明「尺度感」；最终以当年公开披露为准。';

export const foundationThirtyYearVisionMilestones = [
  {
    title: '2036 年 · 第一个十年',
    body:
      '「山海造物」应当是 30+ 家直营店 + 加盟店、3–5 个子品牌、稳定的认证店长体系，与 5–10 家自然博物馆 / 国家公园 / 自然教育机构有稳定合作；累计向自然保护方向捐赠超过 1000 万元。',
  },
  {
    title: '2056 年 · 第一个三十年',
    body:
      '「山海造物」应当成为中国当代自然博物美学的代表品牌之一，进入「百年老铺」早期阶段；累计捐赠超过 1 亿元。',
  },
];

export const foundationThirtyYearVisionQuote =
  '我和廉澍今年都三十多岁。如果一切顺利，我们会用未来 30 年做这件事。三十多年后，如果有一个城市的少年，因为某天偶然进了我们的店、看到一只蝴蝶，回家的那个晚上对自然多了一点点好奇——我们就算赢了。';
