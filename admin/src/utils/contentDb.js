/**
 * 内容工厂 · CloudBase CRUD 封装
 * 基于 cloudbaseCdnDb.js，不修改其源码。
 * 集合：content_topics / content_assets / content_pieces / content_reviews / content_analytics
 */
import {
  ENV_ID,
  REGION,
  fetchCollectionLimit,
  fetchCollectionWhere,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  cdnDocGet,
  getCdnDatabase,
} from './cloudbaseCdnDb'

export const COLLECTIONS = {
  topics: 'content_topics',
  assets: 'content_assets',
  pieces: 'content_pieces',
  reviews: 'content_reviews',
  analytics: 'content_analytics',
}

const ts = () => Date.now()

function assertCdnOk(res, action = 'write') {
  if (res?.code) {
    const err = new Error(res.message || res.code)
    err.code = res.code
    throw err
  }
}

/** 获取当前登录 openid（匿名登录亦可；浏览器 CDN SDK） */
export async function getContentOpenid() {
  try {
    if (typeof window === 'undefined') return 'admin'
    await getCdnDatabase()
    if (!window.__cloudbaseCDN) return 'admin'
    const app = window.__cloudbaseCDN.init({ env: ENV_ID, region: REGION, persistence: 'local' })
    const state = await app.auth().getLoginState()
    if (!state) return 'admin'
    return state.user?.customUserId || state.credential?.openid || state.user?.uid || 'admin'
  } catch {
    return 'admin'
  }
}

/** 新建文档时补全时间戳（_openid 由 CloudBase 登录态自动写入，勿手动 set） */
export async function stampCreate(data = {}) {
  const now = ts()
  return {
    ...data,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    _createTime: data._createTime ?? now,
  }
}

/** 更新文档时刷新 updatedAt */
export function stampUpdate(data = {}) {
  const now = ts()
  return {
    ...data,
    updatedAt: now,
    _updateTime: now,
  }
}

function sortByUpdatedDesc(rows) {
  return [...rows].sort((a, b) => (b.updatedAt || b._updateTime || 0) - (a.updatedAt || a._updateTime || 0))
}

/**
 * 通用 CRUD 工厂
 * @param {string} collectionName
 */
function createContentCrud(collectionName) {
  return {
    /** @param {{ where?: object, limit?: number }} [options] */
    async list(options = {}) {
      const { where = null, limit = 500 } = options
      const rows = where
        ? await fetchCollectionWhere(collectionName, where, limit)
        : await fetchCollectionLimit(collectionName, { limit, where })
      return sortByUpdatedDesc(rows)
    },

    async get(id) {
      if (!id) return null
      return cdnDocGet(collectionName, id)
    },

    async add(data) {
      const doc = await stampCreate(data)
      const res = await cdnAdd(collectionName, doc)
      assertCdnOk(res, 'add')
      const id = res?.id ?? res?._id ?? res?.ids?.[0]
      return { id, doc: { ...doc, _id: id } }
    },

    async update(id, data) {
      const patch = stampUpdate(data)
      const res = await cdnUpdate(collectionName, id, patch)
      assertCdnOk(res, 'update')
      return patch
    },

    async remove(id) {
      const res = await cdnRemove(collectionName, id)
      assertCdnOk(res, 'remove')
    },
  }
}

export const contentTopics = createContentCrud(COLLECTIONS.topics)
export const contentAssets = createContentCrud(COLLECTIONS.assets)
export const contentPieces = createContentCrud(COLLECTIONS.pieces)
export const contentReviews = createContentCrud(COLLECTIONS.reviews)
export const contentAnalytics = createContentCrud(COLLECTIONS.analytics)

/** 默认选题字段（蓝图 §4.1） */
export function defaultTopic(overrides = {}) {
  return {
    title: '',
    ip: 'GRAVITY',
    platform: 'xhs',
    category: '标本',
    angle: '',
    hook: '',
    rationale: '',
    source: 'human',
    status: 'candidate',
    score: 0,
    ...overrides,
  }
}

/** 默认母素材字段（蓝图 §4.2） */
export function defaultAsset(overrides = {}) {
  return {
    type: 'photo',
    title: '',
    desc: '',
    fileRefs: [],
    specimenRef: '',
    shootDate: '',
    ipTags: ['GRAVITY'],
    reusableClips: 0,
    ...overrides,
  }
}

/** 默认终审日志字段（蓝图 §4.4） */
export function defaultReview(overrides = {}) {
  return {
    pieceId: '',
    reviewer: '',
    decision: 'rewrite',
    constitutionCheck: { passed: false, notes: '' },
    comment: '',
    reviewedAt: null,
    ...overrides,
  }
}

/** 默认复盘字段（蓝图 §4.5） */
export function defaultAnalytics(overrides = {}) {
  return {
    period: '',
    inputMetricsSummary: {},
    insights: [],
    nextTopics: [],
    stopList: [],
    generatedBy: '复盘Agent',
    ...overrides,
  }
}

/** 默认成品工单字段（蓝图 §4.3） */
export function defaultPiece(overrides = {}) {
  return {
    topicId: '',
    assetId: '',
    ip: 'GRAVITY',
    platform: 'xhs',
    title: '',
    body: '',
    tags: [],
    coverCopy: '',
    clipSuggestions: [],
    compliance: { passed: false, violations: [], checkedBy: 'agent', checkedAt: null },
    state: 'drafting',
    publishMeta: { publishedAt: null, externalUrl: '' },
    metrics: { views: 0, 完播率: 0, 收藏: 0, 评论具体句: 0, 引流私域: 0 },
    agentMeta: { model: '', provider: '', tokens: 0 },
    ...overrides,
  }
}
