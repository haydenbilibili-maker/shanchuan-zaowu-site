/**
 * 需求 28：「马上有」祈福墙 · 第一批基础内容（AI 创作）
 *
 * 为什么要有这个文件（而不是「开了开关等用户来写」）：
 *   祈福墙是**空墙悖论**最重的场景 —— 第一个进来的人看到一片空白，就不会写；
 *   没人写，墙就一直空。所以上线第一天墙上必须有内容。
 *
 * 第一批内容怎么来：用 AI（DashScope qwen-plus）按品牌调性生成「马上有XX」句式，
 * 但**同时**固化一份人工审校过的基线文案，原因有三：
 *   1. 云函数未必配了 `DASHSCOPE_API_KEY`；没有 key 时不能连"第一批内容"都拿不出来；
 *   2. AI 会跑偏（写成"祝你暴富""家人们冲"），需要一条不依赖网络的确定性兜底；
 *   3. 基线文案是 AI 提示词里的**风格样本**（few-shot），让生成结果收敛在同一口气里。
 *
 * 所以本模块 = 基线文案（数据）+ 生成/解析/筛选纯函数（可测）。
 * 网络调用在 `qwenText.js`，落库在 `index.js` —— 这样"AI 挂了"与"内容有问题"是两件事。
 *
 * 约束（与 index.js / utils/wishWall.js 同口径）：2–30 字、单行、无 emoji、无零宽字符。
 * 与 index.js 不能跨目录 require，故此文件自持一份归一化；测试里有「两份归一化必须同口径」的断言。
 */

/**
 * 批次号：写进每行的 `seedBatch`。
 * 用途：日后要替换/回收某一批基础内容，按批次筛选即可，不必逐条认。
 */
const SEED_BATCH = 'mashangyou-base-2026-09'

/** 基础内容的作者署名（不是任何真实用户，不要写成 openid 归属） */
const SEED_AUTHOR = '山海造物'

/** 单次生成/落库上限：一次铺满一屏即可，铺太多会盖掉真实用户的心愿 */
const SEED_MAX = 12

/**
 * 第一批基础内容（AI 创作 + 人工审校）。
 *
 * 句式的统一约定：`马上有 + 具体名词/状态`。
 * 刻意不写"马上暴富""马上脱单"这类——它们把心愿变成对结果的索取；
 * 品牌要的是"日子里的具体处"，所以是闲、光、眠、热汤、回音、归处。
 */
const SEED_WISHES = [
  { text: '马上有钱', theme: '生计' },
  { text: '马上有闲', theme: '生计' },
  { text: '马上有余地', theme: '生计' },
  { text: '马上有底气', theme: '生计' },
  { text: '马上有缘', theme: '相遇' },
  { text: '马上有伴', theme: '相遇' },
  { text: '马上有人念', theme: '相遇' },
  { text: '马上有回音', theme: '相遇' },
  { text: '马上有光', theme: '心境' },
  { text: '马上有晴', theme: '心境' },
  { text: '马上有风', theme: '心境' },
  { text: '马上有暖', theme: '心境' },
  { text: '马上有眠', theme: '身体' },
  { text: '马上有劲', theme: '身体' },
  { text: '马上有胃口', theme: '身体' },
  { text: '马上有热汤', theme: '身体' },
  { text: '马上有胆', theme: '行事' },
  { text: '马上有解', theme: '行事' },
  { text: '马上有成', theme: '行事' },
  { text: '马上有下一程', theme: '行事' },
  { text: '马上有信', theme: '念想' },
  { text: '马上有花看', theme: '念想' },
  { text: '马上有归处', theme: '念想' },
  { text: '马上有好事', theme: '念想' }
]

/**
 * 句式前缀：基础内容默认是「马上有XX」。
 *
 * ⚠️ 多面墙（2026-09-17）：祈福墙不止一面，第二面墙的句式前缀不一定是「马上有」。
 * 所以前缀是**参数**（`normalizePrefix` + 各处 `prefix`），默认值才走「马上有」——
 * 否则给「月兔」那面墙生成的会是「马上有XX」，那是别的墙的话。
 */
const SEED_PREFIX = '马上有'
/** 前缀长度上限：前缀太长，句式就只剩前缀了（正文至少要有 2 个字） */
const PREFIX_MAX = 6
const TEXT_MIN = 2
const TEXT_MAX = 30

/**
 * 归一化句式前缀。
 * 折叠空白/控制字符（弹幕是单行），截到 6 字；空则回落默认前缀。
 */
function normalizePrefix(raw) {
  const t = normalizeSeedText(raw).replace(/\s+/g, '')
  if (!t) return SEED_PREFIX
  return t.slice(0, PREFIX_MAX)
}

/**
 * 归一化：与 index.js `normalizeWishText` / utils/wishWall.js **必须同口径**。
 * 弹幕是单行滚动（换行会撑破轨道），零宽字符能让同一条文案在管理视图里"看起来不一样"。
 */
function normalizeSeedText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 剥掉 AI 常带回来的装饰：markdown 列表符、编号、引号、句末标点 */
function stripDecoration(text) {
  return String(text || '')
    .replace(/^\s*(?:[-*•·—]|\d+[.、)]|["'“”‘’「」『』])\s*/, '')
    .replace(/[。；;，,、]+$/, '')
    .trim()
}

/**
 * 是否是合法的「<prefix>XX」基础内容。
 * @param {string} text
 * @param {string} [prefix] 句式前缀，默认「马上有」
 * @returns {boolean}
 */
function isSeedPhrase(text, prefix) {
  const p = normalizePrefix(prefix)
  const t = normalizeSeedText(text)
  if (!t) return false
  if (t.length < TEXT_MIN || t.length > TEXT_MAX) return false
  if (t.indexOf(p) !== 0) return false
  if (t.length <= p.length) return false
  return true
}

/**
 * 解析 AI 返回文本 → 候选文案数组。
 *
 * 不假设模型一定吐纯 JSON：实测同一提示词会返回裸数组、`{"list":[...]}`、
 * 围栏代码块、或干脆一行一条。能认的都认，认不出的丢给 selectNewSeeds 过滤，
 * **绝不因为格式就抛错**（抛错等于整批内容拿不回来）。
 */
function parseSeedTexts(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return []

  // 去掉 ```json ... ``` 围栏
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()

  const pushFromValue = (value, out) => {
    if (value == null) return
    if (typeof value === 'string') {
      out.push(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v) => pushFromValue(v, out))
      return
    }
    if (typeof value === 'object') {
      const inner = value.text != null ? value.text : value.wish != null ? value.wish : value.content
      if (typeof inner === 'string') out.push(inner)
    }
  }

  // 1) 优先按 JSON 解析（数组 / {list|wishes|items|data: [...]} / 单对象）
  const start = body.search(/[[{]/)
  if (start !== -1) {
    const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'))
    if (end > start) {
      try {
        const parsed = JSON.parse(body.slice(start, end + 1))
        const out = []
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const arr = parsed.list || parsed.wishes || parsed.items || parsed.data
          pushFromValue(arr != null ? arr : parsed, out)
        } else {
          pushFromValue(parsed, out)
        }
        if (out.length) return out.map(stripDecoration).filter(Boolean)
      } catch (e) {
        // 落到按行解析
      }
    }
  }

  // 2) 按行解析
  return body
    .split(/\r?\n/)
    .map(stripDecoration)
    .map((line) => line.split(/\s*[|｜]\s*/)[0])
    .map(stripDecoration)
    .filter(Boolean)
}

/**
 * 从候选里筛出**可上墙的新内容**。
 *
 * 四道闸，每一道都对应一种真实缺陷：
 *   ① 句式闸：不是「<prefix>XX」直接丢（否则 AI 写"祝你幸福"也上墙，整面墙不成句式）；
 *   ② 长度闸：与 index.js 同口径（2–30 字）；
 *   ③ 已存在闸：与墙上**全部**状态（含 hidden）比对 —— 只比 visible 的话，
 *      被隐藏的内容会被重新种一遍，等于绕过人工治理；
 *   ④ 批内闸：同一批里 AI 自我重复。
 *
 * @param {{candidates?:string[], existing?:string[], limit?:number, normalize?:Function,
 *          requirePrefix?:boolean, prefix?:string}} opts
 * @returns {string[]}
 */
function selectNewSeeds(opts) {
  const o = opts || {}
  const normalize = typeof o.normalize === 'function' ? o.normalize : normalizeSeedText
  const requirePrefix = o.requirePrefix !== false
  const prefix = normalizePrefix(o.prefix)
  const limit = Math.max(0, parseInt(o.limit, 10) || 0)

  const taken = Object.create(null)
  ;(o.existing || []).forEach((t) => {
    const key = normalize(t)
    if (key) taken[key] = true
  })

  const out = []
  for (const candidate of o.candidates || []) {
    if (out.length >= limit) break
    const text = normalize(stripDecoration(candidate))
    if (!text) continue
    if (text.length < TEXT_MIN || text.length > TEXT_MAX) continue
    if (requirePrefix && (text.indexOf(prefix) !== 0 || text.length <= prefix.length)) continue
    if (taken[text]) continue
    taken[text] = true
    out.push(text)
  }
  return out
}

/**
 * 灵感轮换：按「上海自然日」确定性取 N 条，作为输入框上方的灵感 chip。
 *
 * 不用随机数：同一天进两次页面必须看到同一组灵感（否则用户会以为内容在乱跳），
 * 也才能在测试里断言。跨天自动换一组，给出"墙在生长"的感觉。
 *
 * @param {string[]} list
 * @param {{dayKey?:string, count?:number}} [opts]
 * @returns {string[]}
 */
function pickInspiration(list, opts) {
  const o = opts || {}
  const all = (Array.isArray(list) ? list : []).map(normalizeSeedText).filter(Boolean)
  const count = Math.max(1, parseInt(o.count, 10) || 4)
  if (!all.length) return []
  if (all.length <= count) return all.slice()

  const key = String(o.dayKey || '')
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const start = hash % all.length
  const out = []
  for (let i = 0; i < count; i += 1) out.push(all[(start + i) % all.length])
  return out
}

/** 基线文案池（提示词里的风格样本 + 无 key 时的兜底） */
function baselineTexts() {
  return SEED_WISHES.map((s) => s.text)
}

/**
 * 构造生成提示词。
 *
 * 关键三件事：
 *   1. 给足**风格样本**（基线文案）—— 只说"有仪式感"模型会写成语录体；
 *      ⚠️ 样本只在**默认前缀**下给：它们都是「马上有XX」，套到别的墙上会把句式带偏；
 *   2. 给**已存在清单**并要求不得重复 —— 否则每批都在产出"马上有钱"；
 *   3. 明确**禁止项**（emoji / 推销话术 / 长句 / 解释），并要求只输出 JSON。
 *
 * @param {{count?:number, avoid?:string[], prefix?:string}} [opts]
 */
function buildSeedPrompt(opts) {
  const o = opts || {}
  const count = Math.max(1, parseInt(o.count, 10) || SEED_MAX)
  const prefix = normalizePrefix(o.prefix)
  const isDefault = prefix === SEED_PREFIX
  const avoid = (o.avoid || []).map(normalizeSeedText).filter(Boolean).slice(0, 60)

  const wallLine = isDefault
    ? '你是「山海造物 Nature\'s Creations」的祈福文案助手。这面墙叫「马上有」，藏品是一匹黑马标本。'
    : `你是「山海造物 Nature\'s Creations」的祈福文案助手。这面墙的句式前缀是「${prefix}」。`
  const sampleBlock = isDefault
    ? `\n【风格样本】${baselineTexts().slice(0, 12).join('、')}`
    : ''

  return `${wallLine}
品牌调性：朋友式分享，克制、具体、有感官细节，句子短；把心愿落在日子里的具体处（闲、光、眠、热汤、回音），
而不是对结果的索取。

【句式】必须是「${prefix} + 2–6 个字的具象名词或状态」，总长 4–12 字。每一条都必须以「${prefix}」开头。${sampleBlock}
【必须避免】${avoid.length ? avoid.join('、') : '（无）'}
【禁止】emoji、感叹号堆叠、促销与直播话术（家人们/秒杀/冲鸭/暴富/躺赢）、英文、标点结尾、任何解释文字。

生成 ${count} 条**不与样本和避免清单重复**的新句子。
只输出 JSON 数组，形如：["${prefix}X","${prefix}Y"]`
}

module.exports = {
  SEED_BATCH,
  SEED_AUTHOR,
  SEED_MAX,
  SEED_PREFIX,
  PREFIX_MAX,
  SEED_WISHES,
  TEXT_MIN,
  TEXT_MAX,
  normalizePrefix,
  normalizeSeedText,
  stripDecoration,
  isSeedPhrase,
  parseSeedTexts,
  selectNewSeeds,
  pickInspiration,
  baselineTexts,
  buildSeedPrompt
}
