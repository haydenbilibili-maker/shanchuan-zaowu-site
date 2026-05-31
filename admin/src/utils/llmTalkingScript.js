/**
 * 用户沟通锦囊 — LLM 服务
 * 输入：用户画像 profile
 * 输出：结构化的「一句话画像 / 触达时机 / 话术 / 推荐 / 风险提示」
 *
 * 公共底层：复用 src/utils/aiHelper.js 的 callGeminiAPI（含 key 轮询/降级）
 */
import { callGeminiAPI, extractJSON } from './aiHelper'
import { MODULE_META } from './analyticsSchema'

const SYSTEM_PROMPT = `你是「山海造物」品牌的高级用户运营专家。
品牌定位：自然标本 / 矿石 / 手作的轻奢博物品牌（产品有蝴蝶标本、矿石晶体、宠物纪念定制等）。
客户群：博物爱好者、家长、收藏家、礼品采购、宠物主人。

请根据下方用户画像，输出 JSON 格式的沟通锦囊。要求：
1. 不要客套话、不要重复用户的数据，直接给可执行建议
2. 语气基于品牌调性：典雅、克制、专业、有温度
3. 字段必须严格符合给定结构`

const OUTPUT_SCHEMA = `{
  "headline": "12-20 字以内的一句话画像（如：高频鉴定狂热者，定制潜力客户）",
  "timing": "最佳触达时机（2-3 句话，说明时段 / 触发条件 / 频次）",
  "scripts": [
    { "channel": "微信", "content": "可直接发送的话术，60-100 字，第二人称" },
    { "channel": "电话", "content": "电话开场白与重点，50-80 字" }
  ],
  "recommendations": [
    "推荐 1 — 商品/活动/权益的具体建议（含理由）",
    "推荐 2",
    "推荐 3"
  ],
  "risks": ["需要注意的风险点 1", "风险点 2"],
  "expectedAction": "希望客户做出的下一步（如：复购 / 到店核销 / 推荐朋友）"
}`

function buildContext(profile) {
  const moduleTagNames = (profile.tags || [])
    .filter(t => t.type === 'module')
    .map(t => t.label).join('、') || '暂无显著偏好'
  const behaviorTagNames = (profile.tags || [])
    .filter(t => t.type === 'behavior')
    .map(t => t.label).join('、') || '暂无显著行为'
  const recencyText = profile.recencyDays === Infinity ? '从未购买'
    : (profile.recencyDays === 0 ? '今天' : profile.recencyDays + ' 天前')

  return `# 用户画像

- 昵称：${profile.nickName || '匿名'}
- 分群：${profile.segmentMeta?.name || '未知'}（${profile.segmentMeta?.desc || ''}）
- RFM 评分：R=${profile.R || 0} / F=${profile.F || 0} / M=${profile.M || 0}（满分 5）
- 最近一次消费：${recencyText}
- 订单数：${profile.frequency || 0}
- 累计消费：¥${(profile.monetary || 0).toLocaleString()}
- 当前积分：${profile.points || 0}
- 偏好模块：${moduleTagNames}
- 行为标签：${behaviorTagNames}
- 注册时长：${profile.createTime ? Math.floor((Date.now() - new Date(profile.createTime).getTime()) / 86400000) + ' 天' : '未知'}`
}

/**
 * 生成沟通锦囊
 * @param {Object} profile 来自 buildProfile 的用户画像
 * @param {Object} options { language: 'zh', timeout, scenario }
 * @returns {Promise<{ ok: boolean, data?: Object, error?: string, raw?: string }>}
 */
export async function generateTalkingScript(profile, options = {}) {
  if (!profile) return { ok: false, error: '缺少用户画像' }

  const scenario = options.scenario || 'general'
  const scenarioHint = {
    general: '通用场景：常规运营触达',
    support_ticket: '客服场景：用户当前在山海有信提交了工单，需要先解决问题再推动复购',
    inactive: '召回场景：用户已经较长时间未活跃',
    new_user: '新客场景：用户刚完成首单 / 首次到店'
  }[scenario] || ''

  const prompt = `${SYSTEM_PROMPT}

【触达场景】${scenarioHint}

${buildContext(profile)}

# 输出 JSON

严格按照以下 schema 输出（只输出 JSON，不要 markdown 代码块、不要解释）：
${OUTPUT_SCHEMA}`

  try {
    const text = await callGeminiAPI(prompt, {
      temperature: 0.75,
      maxTokens: 1024,
      timeout: options.timeout || 30000
    })
    const json = extractJSON(text)
    if (!json) {
      return { ok: false, error: '模型未返回合法 JSON', raw: text }
    }
    return { ok: true, data: json, raw: text }
  } catch (e) {
    return { ok: false, error: e?.message || '调用失败' }
  }
}

/**
 * 批量生成（最多 5 个用户一次）
 */
export async function generateBatchTalkingScripts(profiles, options = {}) {
  const list = profiles.slice(0, 5)
  return Promise.all(list.map(p => generateTalkingScript(p, options)))
}
