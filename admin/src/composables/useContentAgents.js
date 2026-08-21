/**
 * 内容工厂 · Agent 封装（蓝图 §5）
 * 统一：组装 prompt → callGeminiAPI → extractJSON
 */
import { callGeminiAPI, extractJSON } from '../utils/aiHelper'
import { buildConstitutionPrompt, precheckBanned } from '../config/contentConstitution'
import {
  contentTopics,
  contentAnalytics,
  defaultTopic,
  defaultAnalytics,
} from '../utils/contentDb'
import { currentContentPeriod } from '../utils/contentMetrics'

/** 内容合规检查走默认 AI 通道（环境变量 VITE_AI_DEFAULT_PROVIDER，通常为 deepseek） */
const CONSTITUTION_AI_OPTS = { temperature: 0.4 }

/** extractJSON 失败或调用异常时的统一兜底 */
function constitutionFail(reason) {
  return {
    passed: false,
    violations: [reason],
    rewritten: '',
    ip_tone_ok: false,
  }
}

function normalizeConstitutionResult(raw = {}) {
  return {
    passed: raw.passed === true,
    violations: Array.isArray(raw.violations) ? raw.violations.filter(Boolean) : [],
    rewritten: typeof raw.rewritten === 'string' ? raw.rewritten : String(raw.rewritten ?? ''),
    ip_tone_ok: raw.ip_tone_ok !== false,
  }
}

function safeExtractJSON(text) {
  try {
    return { ok: true, data: extractJSON(text) }
  } catch (e) {
    return { ok: false, error: e.message || 'JSON 解析失败' }
  }
}

function normalizeTopicRow(t = {}) {
  return defaultTopic({
    title: t.title || '未命名选题',
    ip: t.ip === 'LIGHTNESS' ? 'LIGHTNESS' : 'GRAVITY',
    platform: ['xhs', 'douyin', 'shipinhao', 'bilibili'].includes(t.platform) ? t.platform : 'xhs',
    category: t.category || '标本',
    angle: t.angle || '',
    hook: t.hook || t.title || '',
    rationale: t.rationale || '',
    source: 'agent',
    status: 'candidate',
    score: Number(t.score) || 50,
  })
}

export function useContentAgents() {
  /**
   * 话术宪法 Agent（§5.1）
   */
  async function constitutionCheck({
    mode = 'check',
    text = '',
    ip = 'GRAVITY',
    platform = 'xhs',
    category = '标本',
  }) {
    const input = String(text ?? '').trim()
    if (!input) return constitutionFail('文案内容为空')

    const prompt = buildConstitutionPrompt({ mode, text: input, ip, platform, category })

    let rawResponse
    try {
      rawResponse = await callGeminiAPI(prompt, CONSTITUTION_AI_OPTS)
    } catch (e) {
      return constitutionFail(`模型调用失败：${e.message || '未知错误'}`)
    }

    let parsed
    try {
      parsed = extractJSON(rawResponse)
    } catch (e) {
      return constitutionFail(`JSON 解析失败：${e.message || '无法解析模型输出'}`)
    }

    const result = normalizeConstitutionResult(parsed)

    const checkTarget = result.passed ? input : result.rewritten || input
    const hits = precheckBanned(checkTarget, ip)
    if (hits.length) {
      result.passed = false
      result.violations = [
        ...result.violations,
        ...hits.map((h) => `[确定性校验] ${h.type}：${h.hit}`),
      ]
    }

    return result
  }

  /**
   * 选题 Agent（§5.2）
   * @param {object} ctx - brandAssetsBrief / platformTrends / recentPerfSummary / ipBalanceNeeded
   * @param {{ persist?: boolean }} [options] - persist 默认 true，写入 content_topics(status:candidate)
   * @returns {Promise<{ ok: boolean, data?: { topics: object[] }, error?: string }>}
   */
  async function suggestTopics(ctx = {}, options = {}) {
    const { persist = true } = options
    const {
      brandAssetsBrief = '山海造物：自然标本、矿石、手作轻奢博物',
      platformTrends = '暂无',
      recentPerfSummary = '暂无',
      ipBalanceNeeded = 'GRAVITY/LIGHTNESS 各半',
    } = ctx

    const prompt = `你是山海造物内容选题策划。根据品牌资产、平台趋势与近期表现，产出 5-8 条选题候选。
品牌：${brandAssetsBrief}
平台趋势：${platformTrends}
近期表现：${recentPerfSummary}
IP 平衡需求：${ipBalanceNeeded}
每条须含：title, ip(GRAVITY|LIGHTNESS), platform(xhs|douyin|shipinhao|bilibili), category(标本|首饰|器物|内容|香气|礼盒), angle, hook, rationale, score(0-100)
须遵守话术宪法：标本不作主语；钩子避免逼单与夸大。
只输出 JSON：{ "topics": [ { "title","ip","platform","category","angle","hook","rationale","score" } ] }`

    const res = await callGeminiAPI(prompt, { temperature: 0.9 })
    const parsed = safeExtractJSON(res)
    if (!parsed.ok) return { ok: false, error: parsed.error, raw: res }

    const rawList = parsed.data?.topics || []
    const topics = []

    for (const t of rawList) {
      const doc = normalizeTopicRow(t)
      if (persist) {
        const { id, doc: saved } = await contentTopics.add(doc)
        topics.push({ ...saved, _id: id })
      } else {
        topics.push(doc)
      }
    }

    return { ok: true, data: { topics } }
  }

  /**
   * 改写分发 Agent（§5.3）
   * @param {object|string} mother - 母素材对象或描述文本
   * @param {string[]} [targetPlatforms] - 目标平台，默认 xhs/douyin/shipinhao
   * @param {{ ip?: string }} [opts] - 可选 IP
   */
  async function repurpose(mother, targetPlatforms = ['xhs', 'douyin', 'shipinhao'], opts = {}) {
    let asset = mother
    let platforms = targetPlatforms
    let ip = opts.ip || 'GRAVITY'

    if (mother && typeof mother === 'object' && !Array.isArray(mother) && mother.mother !== undefined) {
      asset = mother.mother
      platforms = mother.targetPlatforms || targetPlatforms
      ip = mother.ip || ip
    } else if (mother && typeof mother === 'object' && !Array.isArray(mother)) {
      asset = mother
      ip = mother.ipTags?.[0] || mother.ip || ip
      if (Array.isArray(targetPlatforms) && targetPlatforms.length && typeof targetPlatforms[0] === 'string') {
        platforms = targetPlatforms
      }
    }

    const desc = typeof asset === 'string' ? asset : asset?.desc || asset?.title || ''
    const transcript = typeof asset === 'object' ? asset?.transcript : ''

    const prompt = `你是山海造物多平台内容改写专家。根据母素材描述，为各平台生成成品（标题/正文/标签/封面文案/切片建议）。
须遵守：标本不作主语；主语只能是光/空气/季节/容器/看的人/时刻等。
母素材：${desc}
${transcript ? `口播/字幕：${transcript}` : ''}
${asset?.specimenRef ? `关联藏品档案 id：${asset.specimenRef}` : ''}
IP：${ip}
目标平台：${platforms.join(', ')}
每个平台一条，platform 字段须与目标一致。
只输出 JSON：{ "pieces": [ { "platform","title","body","tags":[],"coverCopy","clipSuggestions":[] } ] }`

    const res = await callGeminiAPI(prompt, { temperature: 0.7 })
    const parsed = safeExtractJSON(res)
    if (!parsed.ok) return { ok: false, error: parsed.error, raw: res }

    const pieces = parsed.data?.pieces || []
    const withCompliance = []

    for (const p of pieces) {
      const body = p.body || p.title || ''
      const platform = p.platform || platforms[0] || 'xhs'
      const check = await constitutionCheck({
        mode: 'check',
        text: body,
        ip,
        platform,
        category: '标本',
      })
      withCompliance.push({
        ...p,
        platform,
        ip,
        compliance: {
          passed: check.passed,
          violations: check.violations,
          checkedBy: 'agent',
          checkedAt: Date.now(),
        },
        rewritten: check.rewritten,
        ip_tone_ok: check.ip_tone_ok,
        /** 合规不通过 → 进 review 待人工终审（标红） */
        suggestedState: check.passed ? 'drafting' : 'review',
      })
    }

    return { ok: true, data: { pieces: withCompliance, assetId: asset?._id || '' } }
  }

  /**
   * 复盘 Agent（§5.4）
   * @param {object} metrics - assembleContentMetrics 产出
   * @param {{ persist?: boolean, period?: string }} [options]
   * @returns {Promise<{ ok: boolean, data?: { insights, nextTopics, stopList, analyticsId?, flywheelTopicIds? }, error?: string }>}
   */
  async function retrospect(metrics = {}, options = {}) {
    const { persist = true, period = metrics.period || currentContentPeriod() } = options

    const prompt = `你是山海造物内容复盘分析师。山海造物是自然博物美学品牌，内容须遵守「标本不作主语」话术宪法。

【复盘周期】${period}

【内容指标摘要】
${JSON.stringify(metrics, null, 2)}

${metrics.behaviorSnippet ? `【C端行为参考】\n${JSON.stringify(metrics.behaviorSnippet, null, 2)}` : ''}

请基于已发布内容的 metrics（播放/完播/收藏/评论质量/引流私域）与平台/IP 分布：
1. insights：3-6 条可执行洞察（数据依据 + 建议动作）
2. nextTopics：3-6 条下一轮选题标题（钩子句，标本不作主语，适合 GRAVITY/LIGHTNESS 调性）
3. stopList：建议停做或降频的内容类型/句式

只输出 JSON：{ "insights": string[], "nextTopics": string[], "stopList": string[] }`

    const res = await callGeminiAPI(prompt, { temperature: 0.6 })
    const parsed = safeExtractJSON(res)
    if (!parsed.ok) return { ok: false, error: parsed.error, raw: res }

    const insights = Array.isArray(parsed.data?.insights) ? parsed.data.insights : []
    const nextTopics = Array.isArray(parsed.data?.nextTopics) ? parsed.data.nextTopics : []
    const stopList = Array.isArray(parsed.data?.stopList) ? parsed.data.stopList : []

    if (!persist) {
      return { ok: true, data: { insights, nextTopics, stopList } }
    }

    const { id: analyticsId } = await contentAnalytics.add(
      defaultAnalytics({
        period,
        inputMetricsSummary: metrics,
        insights,
        nextTopics,
        stopList,
        generatedBy: '复盘Agent',
      })
    )

    const flywheelTopicIds = []
    for (const title of nextTopics) {
      const t = String(title ?? '').trim()
      if (!t) continue
      const { id } = await contentTopics.add(
        defaultTopic({
          title: t,
          hook: t,
          angle: '复盘飞轮回灌',
          rationale: `复盘周期 ${period} · Agent 回灌`,
          source: 'flywheel',
          status: 'candidate',
          score: 55,
          category: '内容',
        })
      )
      flywheelTopicIds.push(id)
    }

    return {
      ok: true,
      data: { insights, nextTopics, stopList, analyticsId, flywheelTopicIds },
    }
  }

  return { constitutionCheck, suggestTopics, repurpose, retrospect }
}
