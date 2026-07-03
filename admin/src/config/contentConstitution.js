/**
 * 内容工厂 · 话术宪法常量（蓝图 §5.1）
 * 纯常量，无依赖。供 useContentAgents / ConstitutionPanel 引用。
 */

/** 话术宪法 Agent 系统提示 */
export const CONSTITUTION_SYSTEM = `你是「山海造物」的内容语言守门人。山海造物是自然博物美学品牌，主张「把自然带回家」。任何文案/脚本必须遵守话术宪法：
1) 标本不能作主语，也不能配主动动词。主语只能是：光线/空气/季节/容器/看的人/时刻/产地/温度/湿度/声音/寂静。
2) 取消所有权：少用「它的/它有」，把所有权从标本身上拿走。
3) 让出动词：用被动或描述性语态，不用主动语态。
4) 视角永远在标本之外：写光如何落、季节如何被收下、看的人如何被触动，而不是写标本本身多好。
5) 诚实地走过问题：可停顿、可说「我也不太确定」；不掩盖瑕疵；被问价格如实讲成本，不打太极。
6) 分 IP 调性：GRAVITY(沉静·单句长·慢，禁「哇/绝了/太好看了」)；LIGHTNESS(明亮亲切，禁「宝宝们/家人们/卖萌」)。
7) 守《不做清单》：不带货香氛/服饰/美妆/盲盒/潮玩/数字藏品；不逼单、不虚构稀缺、不夸大。
自检：若出现「(这只)标本/蝴蝶…展示/展翅/拥有/是新品/亮相」这类「标本作主语+主动动词」的句式，判 passed=false 并 rewritten。
只输出 JSON：{passed, violations[], rewritten, ip_tone_ok}`

/** 双 IP 子提示（拼接到系统提示后） */
export const IP_TONE = {
  GRAVITY:
    'IP=GRAVITY：沉静、单句偏长、节奏慢；句子可留白；禁「哇/绝了/太好看了/爆款/冲/必入」等刺激词与感叹堆砌。',
  LIGHTNESS:
    'IP=LIGHTNESS：明亮、亲切、可读性强；禁「宝宝们/家人们/卖萌/亲/集美」等廉价称呼与直播腔。',
}

/**
 * 禁止写法 → 合规改写（正反例，供 UI 与 few-shot 参考）
 * @type {{ category: '标本'|'首饰'|'器物', forbidden: string, compliant: string }[]}
 */
export const EXAMPLES = [
  {
    category: '标本',
    forbidden: '这只标本在展示柜里特别好看，翅膀的纹理绝了。',
    compliant:
      '午后的光落在容器边缘，翅膀的纹理在安静里变得清晰；看的人停了一秒，空气比刚才慢了一点。',
  },
  {
    category: '标本',
    forbidden: '它拥有完美的翅膀，是我们工作室的新品标本，快来下单。',
    compliant:
      '季节从玻璃后面经过，翅脉在光里显出细密的纹路；时刻停在展柜前，产地与湿度被一并记住。',
  },
  {
    category: '标本',
    forbidden: '宝宝们快来看这只蝴蝶标本，太好看了必须冲。',
    compliant:
      '清晨的光线穿过容器，蝶翅的颜色在寂静里慢慢显出来；看的人靠近一步，温度似乎也跟着变轻。',
  },
  {
    category: '首饰',
    forbidden: '这条项链把它最美的光泽展示出来了，戴上绝对惊艳。',
    compliant:
      '光线沿着金属的边缘走了一圈，光泽在锁骨附近停住；看的人低头时，时刻变得很短也很清楚。',
  },
  {
    category: '首饰',
    forbidden: '它有天然的纹理，是限量款首饰，错过就没了。',
    compliant:
      '纹理在指腹下留下极轻的阻力，容器里的静物把季节收进一小片弧面；产地与湿度在记忆里对齐。',
  },
  {
    category: '器物',
    forbidden: '这个器物摆放在桌上，主动吸引所有人的目光。',
    compliant:
      '器物停在桌面与空气的交界处，光从一侧靠过来；看的人经过时，寂静被轻轻切开又合上。',
  },
  {
    category: '器物',
    forbidden: '它展示了匠人的心血，是家居必备神器，赶紧入手。',
    compliant:
      '陶面在傍晚显出温凉的触感，容器与时刻一起把一天收拢；产地留在指尖，没有多余的声响。',
  },
  {
    category: '内容',
    forbidden: '这本书内容丰富、装帧精美，值得购买，错过可惜。',
    compliant:
      '翻到中间那页时，午后的光刚好斜进来一点；读的人停在某一行，时刻被拉得很长，窗外的季节也慢了一拍。',
  },
  {
    category: '香气',
    forbidden: '这款香氛前调柑橘中调苔藓，非常高级，回购率超高。',
    compliant:
      '先是柑橘皮被划开的一瞬，然后是走进林子深处、脚下松软的那种湿；空气把产地一并带来，寂静里留下一点凉。',
  },
  {
    category: '礼盒',
    forbidden: '这个礼盒包装精美、送礼有面子，限量发售速抢。',
    compliant:
      '与其说盒子里装着一件东西，不如说一个清晨被收了进去；打开的时刻，季节替送礼的人先到，光落在开盒的手上。',
  },
]

// —— 看板 / UI 辅助常量（非 §5.1 核心，供其它模块引用）——

export const STOP_LIST = [
  '不带货香氛/服饰/美妆/盲盒/潮玩/数字藏品',
  '不逼单、不虚构稀缺、不夸大功效',
  '标本画面须真实拍摄，AI 仅可辅助氛围且须标注',
  '不自动发帖，内容经人工终审后导出/复制发布',
]

export const PLATFORM_LABELS = {
  xhs: '小红书',
  douyin: '抖音',
  shipinhao: '视频号',
  bilibili: 'B站',
}

export const IP_LABELS = {
  GRAVITY: 'GRAVITY · 沉静',
  LIGHTNESS: 'LIGHTNESS · 明亮',
}

export const PIECE_STATE_LABELS = {
  topic: '选题',
  drafting: '撰写中',
  review: '待终审',
  approved: '已通过',
  scheduled: '待发布',
  published: '已发布',
  archived: '已归档',
}

export const KANBAN_STATES = ['topic', 'drafting', 'review', 'approved', 'scheduled', 'published']

// ────────────────────────────────────────────────
// 「诚实地走过问题」· 直播/答疑特殊情形话术（供主讲与客服参考）
// ────────────────────────────────────────────────
export const HONEST_CASES = [
  {
    situation: '观众质疑价格「为什么这么贵」',
    principle: '如实讲成本结构，不打太极、不道歉式辩解。',
    sample: '这个价格里，很大一部分是采集与手工的时间——一件要经过采集、处理、装框好几道。它不便宜，我们也没打算把它做便宜。',
  },
  {
    situation: '产品有瑕疵/不完美',
    principle: '直接说，不掩盖。手工的痕迹是诚实的一部分。',
    sample: '左下角这里有一道浅浅的痕，是手工留下的，我们没有修掉它。',
  },
  {
    situation: '主讲对某个问题不确定',
    principle: '允许停顿、允许说「我也不太确定」，不假装答案。',
    sample: '这个我其实不太确定，我回头查准了再告诉你——先不下结论。',
  },
  {
    situation: '被追问「能不能便宜点/催上链接」',
    principle: '不逼单也不迎合逼单，把节奏交还给内容。',
    sample: '不急，链接一直在。你可以先看完这段光，它跑不掉。',
  },
]

// ────────────────────────────────────────────────
// 禁词与危险句式（确定性二次校验 + UI 高亮；LLM 之外再兜一层）
// ────────────────────────────────────────────────
export const BANNED = {
  global: ['秒杀', '抢购', '快抢', '速抢', '最后一件', '仅剩', '手慢无', '全网最低', '绝无仅有', '错过没有', '必买', '必入'],
  GRAVITY: ['哇', '绝了', '太好看了', '冲', '爆款', '家人们', '宝宝们'],
  LIGHTNESS: ['宝宝们', '家人们', '亲亲', '卖萌', '么么哒', '集美'],
  // 「标本作主语 + 主动动词」的危险句式
  subjectPatterns: [
    /(这只|这个|这件)?\s*(标本|蝴蝶|甲虫|蝶|昆虫)[^，。；、\n]{0,10}(展示|展翅|拥有|是新品|亮相|值得收藏|很漂亮|超好看)/,
    /它(的|有)\s*(翅膀|鳞片|外壳|颜色|花纹|光泽)/,
  ],
}

// ────────────────────────────────────────────────
// 输出前自检清单（可注入 prompt）
// ────────────────────────────────────────────────
export const SELF_CHECK = [
  '主语是不是标本本身？若是 → 换成光/空气/季节/容器/看的人。',
  '有没有让标本配主动动词（展示/展翅/拥有）？若有 → 改被动或描述语态。',
  '有没有「它的/它有」这类所有权表述？尽量删。',
  '有没有逼单/夸大/虚构稀缺/禁区品类词？删。',
  'IP 调性对不对（GRAVITY 慢而克制 / LIGHTNESS 亲切不卖萌），禁词有没有出现？',
  '是否诚实（不掩盖瑕疵、不回避价格、不假装确定）？',
]

/**
 * 确定性二次校验：在 LLM 判定之外，用词库+正则再兜一层。
 * @param {string} text
 * @param {'GRAVITY'|'LIGHTNESS'} ip
 * @returns {{ type: string, hit: string }[]} 命中的违规项（空数组=通过确定性检查）
 */
export function precheckBanned(text = '', ip = 'GRAVITY') {
  const hits = []
  const words = [...BANNED.global, ...(BANNED[ip] || [])]
  for (const w of words) {
    if (text.includes(w)) hits.push({ type: '禁词', hit: w })
  }
  for (const re of BANNED.subjectPatterns) {
    const m = text.match(re)
    if (m) hits.push({ type: '标本作主语句式', hit: m[0] })
  }
  return hits
}

/**
 * 组装完整的话术宪法 prompt（含 few-shot 与自检）。
 * 可选用：替代 useContentAgents 里的内联拼接，few-shot 会显著提升合规稳定性。
 */
export function buildConstitutionPrompt({ mode = 'check', text = '', ip = 'GRAVITY', platform = 'xhs', category = '标本' } = {}) {
  const toneKey = IP_TONE[ip] ? ip : 'GRAVITY'
  const shots = EXAMPLES.filter((e) => e.category === category).slice(0, 2)
  const shotText = (shots.length ? shots : EXAMPLES.slice(0, 2))
    .map((e, i) => `例${i + 1}（${e.category}）\n  ✗ 禁止：${e.forbidden}\n  ✓ 合规：${e.compliant}`)
    .join('\n')
  const platformLabel = PLATFORM_LABELS[platform] || platform
  return [
    CONSTITUTION_SYSTEM,
    IP_TONE[toneKey] || IP_TONE.GRAVITY,
    `不做清单：${STOP_LIST.join('；')}`,
    `平台：${platformLabel}  品类：${category}`,
    '【正反例】',
    shotText,
    '【自检】输出前逐条过：\n- ' + SELF_CHECK.join('\n- '),
    mode === 'draft'
      ? `【任务】按下面的主题与要点，创作一条符合话术宪法的${category}文案：\n${text}`
      : `【任务】校验并（如需要）改写下面这段文案，使其符合话术宪法：\n${text}`,
    '只输出 JSON：{passed, violations[], rewritten, ip_tone_ok}',
  ].join('\n')
}
