/**
 * 内容工厂 · 看板 CRUD + 状态机（蓝图 §6）
 * 数据层统一走 contentDb.js
 */
import {
  contentTopics,
  contentAssets,
  contentPieces,
  contentReviews,
  contentAnalytics,
  defaultPiece,
  defaultTopic,
  defaultReview,
  getContentOpenid,
} from '../utils/contentDb'

/** @deprecated 请用 contentDb.COLLECTIONS */
export const CONTENT_COLLECTIONS = {
  topics: 'content_topics',
  assets: 'content_assets',
  pieces: 'content_pieces',
  reviews: 'content_reviews',
  analytics: 'content_analytics',
}

export const BOARD_STATES = [
  'topic',
  'drafting',
  'review',
  'approved',
  'scheduled',
  'published',
  'archived',
]

const ALLOWED_TRANSITIONS = {
  topic: ['drafting'],
  drafting: ['review'],
  review: ['drafting', 'approved'],
  approved: ['scheduled', 'published'],
  scheduled: ['published'],
  published: ['archived'],
  archived: [],
}

const ts = () => Date.now()

function assertAllowedTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from] || []
  if (!allowed.includes(to)) {
    throw new Error(`不允许从「${from}」流转到「${to}」`)
  }
}

function mapReviewDecision(from, to) {
  if (from === 'review' && to === 'approved') return 'approve'
  if (from === 'review' && to === 'drafting') return 'rewrite'
  if (to === 'archived') return 'reject'
  return 'transition'
}

export function useContentBoard() {
  /** 按 state 拉取看板列 */
  async function fetchPiecesByState(state, limit = 200) {
    if (!BOARD_STATES.includes(state)) {
      throw new Error(`未知状态：${state}`)
    }
    return contentPieces.list({ where: { state }, limit })
  }

  /** 拉取全部工单（看板多列客户端分组） */
  async function fetchPieces(limit = 200) {
    return contentPieces.list({ limit })
  }

  /** 按 state 分组返回看板数据 */
  async function fetchKanban(limit = 200) {
    const rows = await fetchPieces(limit)
    const board = Object.fromEntries(BOARD_STATES.map((s) => [s, []]))
    for (const p of rows) {
      const st = p.state || 'drafting'
      if (board[st]) board[st].push(p)
      else board.drafting.push(p)
    }
    return board
  }

  async function fetchTopics(status = null, limit = 200) {
    const where = status ? { status } : null
    const rows = await contentTopics.list({ where, limit })
    return rows.sort((a, b) => (b.score || 0) - (a.score || 0))
  }

  async function fetchAssets(limit = 100) {
    return contentAssets.list({ limit })
  }

  async function fetchAnalytics(limit = 20) {
    return contentAnalytics.list({ limit })
  }

  async function addTopic(topic) {
    const { id } = await contentTopics.add(
      defaultTopic({
        ...topic,
        source: topic.source || 'agent',
        status: topic.status || 'candidate',
        score: topic.score ?? 0,
      })
    )
    return id
  }

  async function pickTopic(topicId) {
    await contentTopics.update(topicId, { status: 'picked' })
  }

  async function addAsset(asset) {
    const { id } = await contentAssets.add({
      type: asset.type || 'video',
      fileRefs: asset.fileRefs || [],
      ipTags: asset.ipTags || [],
      ...asset,
    })
    return id
  }

  async function createPieceFromTopic(topic, extra = {}) {
    const { id } = await contentPieces.add(
      defaultPiece({
        topicId: topic._id,
        assetId: extra.assetId || '',
        ip: topic.ip || 'GRAVITY',
        platform: topic.platform || 'xhs',
        title: topic.title || '未命名',
        body: extra.body || topic.hook || '',
        tags: extra.tags || [],
        coverCopy: extra.coverCopy || '',
        clipSuggestions: extra.clipSuggestions || [],
        compliance: extra.compliance || defaultPiece().compliance,
        state: 'topic',
        agentMeta: extra.agentMeta || {},
        stateHistory: [{ state: 'topic', at: ts(), by: 'human' }],
      })
    )
    return id
  }

  async function createPiece(piece) {
    const { id } = await contentPieces.add(
      defaultPiece({
        stateHistory: [{ state: piece.state || 'drafting', at: ts(), by: 'human' }],
        ...piece,
      })
    )
    return id
  }

  async function updatePiece(pieceId, patch) {
    await contentPieces.update(pieceId, patch)
  }

  async function getPiece(pieceId) {
    return contentPieces.get(pieceId)
  }

  /** 每次流转写入 content_reviews 审计日志 */
  async function writeTransitionReview({
    pieceId,
    piece,
    fromState,
    toState,
    reviewer,
    comment = '',
    decision,
    constitutionCheck,
  }) {
    const rev = reviewer?.trim() || (await getContentOpenid())
    await contentReviews.add(
      defaultReview({
        pieceId,
        reviewer: rev,
        decision: decision || mapReviewDecision(fromState, toState),
        comment: comment || `${fromState} → ${toState}`,
        constitutionCheck: constitutionCheck ?? {
          passed: piece?.compliance?.passed === true,
          notes: '',
        },
        reviewedAt: ts(),
      })
    )
    return rev
  }

  /**
   * 状态流转（§6）
   * review→approved 禁止直接调用，须走 submitReview 闸口
   */
  async function transitionPiece(pieceId, piece, nextState, options = {}) {
    const cur = piece.state
    assertAllowedTransition(cur, nextState)

    if (nextState === 'approved') {
      throw new Error('进入「已通过」须走人工终审闸口（submitReview）')
    }

    const by = await writeTransitionReview({
      pieceId,
      piece,
      fromState: cur,
      toState: nextState,
      reviewer: options.reviewer,
      comment: options.comment,
    })

    const history = [...(piece.stateHistory || []), { state: nextState, at: ts(), by }]
    await contentPieces.update(pieceId, { state: nextState, stateHistory: history })
  }

  /**
   * 人工终审闸口：review → approved | drafting
   * review→approved 必须 reviewer 且 piece.compliance.passed===true
   */
  async function submitReview({
    pieceId,
    piece,
    decision,
    comment = '',
    constitutionCheck = {},
    reviewer,
  }) {
    if (!reviewer?.trim()) {
      throw new Error('须指定终审人 reviewer')
    }

    if (decision === 'approve') {
      if (piece.state !== 'review') {
        throw new Error('仅「待终审」状态可通过')
      }
      if (piece.compliance?.passed !== true) {
        throw new Error('合规未通过，无法批准。请先重写或修正文案。')
      }
      if (constitutionCheck.passed === false) {
        throw new Error('话术宪法校验未通过，无法批准。')
      }

      await writeTransitionReview({
        pieceId,
        piece,
        fromState: 'review',
        toState: 'approved',
        reviewer,
        comment,
        decision: 'approve',
        constitutionCheck: {
          passed: true,
          notes: constitutionCheck.notes || '',
        },
      })

      const history = [...(piece.stateHistory || []), { state: 'approved', at: ts(), by: reviewer }]
      await contentPieces.update(pieceId, { state: 'approved', stateHistory: history })
      return
    }

    if (decision === 'reject' || decision === 'rewrite') {
      if (piece.state !== 'review') {
        throw new Error('仅「待终审」状态可打回')
      }

      await writeTransitionReview({
        pieceId,
        piece,
        fromState: 'review',
        toState: 'drafting',
        reviewer,
        comment,
        decision,
        constitutionCheck: { passed: false, notes: comment },
      })

      const history = [...(piece.stateHistory || []), { state: 'drafting', at: ts(), by: reviewer }]
      await contentPieces.update(pieceId, { state: 'drafting', stateHistory: history })
    }
  }

  async function registerPublish(pieceId, piece, { externalUrl = '', publishedAt = null, reviewer } = {}) {
    if (!['approved', 'scheduled'].includes(piece.state)) {
      throw new Error('仅已通过或待发布状态可登记发布')
    }

    const by = await writeTransitionReview({
      pieceId,
      piece,
      fromState: piece.state,
      toState: 'published',
      reviewer,
      comment: externalUrl ? `发布登记：${externalUrl}` : '发布登记',
      decision: 'transition',
    })

    const history = [...(piece.stateHistory || []), { state: 'published', at: ts(), by }]
    await contentPieces.update(pieceId, {
      state: 'published',
      publishMeta: {
        publishedAt: publishedAt || ts(),
        externalUrl,
      },
      stateHistory: history,
    })
  }

  async function saveAnalytics(record) {
    const { id } = await contentAnalytics.add(record)
    return id
  }

  async function flywheelTopics(nextTopics = []) {
    for (const title of nextTopics) {
      if (!title?.trim()) continue
      await addTopic({
        title: title.trim(),
        ip: 'GRAVITY',
        platform: 'xhs',
        category: '内容',
        angle: '复盘回灌',
        hook: title.trim(),
        rationale: '复盘 Agent 飞轮回灌',
        source: 'flywheel',
        status: 'candidate',
        score: 50,
      })
    }
  }

  return {
    BOARD_STATES,
    fetchPiecesByState,
    fetchPieces,
    fetchKanban,
    fetchTopics,
    fetchAssets,
    fetchAnalytics,
    addTopic,
    pickTopic,
    addAsset,
    createPieceFromTopic,
    createPiece,
    updatePiece,
    getPiece,
    transitionPiece,
    submitReview,
    registerPublish,
    saveAnalytics,
    flywheelTopics,
  }
}
