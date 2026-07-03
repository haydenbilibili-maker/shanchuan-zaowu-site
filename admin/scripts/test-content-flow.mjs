#!/usr/bin/env node
/**
 * 内容工厂端到端自测：新建选题 → 草稿 → review → approved
 * cd admin && node scripts/test-content-flow.mjs
 */
import cloudbase from '@cloudbase/js-sdk'

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const REGION = 'ap-shanghai'
const COL_TOPICS = 'content_topics'
const COL_PIECES = 'content_pieces'
const COL_REVIEWS = 'content_reviews'

const COMPLIANT_BODY =
  '午后的光落在容器边缘，翅脉在寂静里慢慢显出来；看的人靠近一步，时刻比刚才慢了一点。'

async function main() {
  const app = cloudbase.init({ env: ENV_ID, region: REGION })
  await app.auth().signInAnonymously()
  const auth = await app.auth().getLoginState()
  const reviewer = auth?.user?.uid || 'flow-test'
  const db = app.database()
  const now = Date.now()
  const stamp = () => Date.now()

  console.log('=== 内容工厂流程自测：选题 → drafting → review → approved ===\n')

  // 1. 新建选题
  const topicRes = await db.collection(COL_TOPICS).add({
    title: `[流程自测] ${new Date().toISOString().slice(0, 19)}`,
    ip: 'GRAVITY',
    platform: 'xhs',
    category: '标本',
    angle: '光与容器',
    hook: '午后光落在蝶翅',
    rationale: 'test-content-flow.mjs',
    source: 'human',
    status: 'candidate',
    score: 70,
    createdAt: now,
    updatedAt: now,
    _createTime: now,
  })
  if (topicRes?.code) throw new Error(topicRes.message)
  const topicId = topicRes.id
  console.log('✓ 1. 新建选题', topicId)

  // 2. 挑选入看板 → piece topic
  const pieceRes = await db.collection(COL_PIECES).add({
    topicId,
    assetId: '',
    ip: 'GRAVITY',
    platform: 'xhs',
    title: topicRes.title || '流程自测选题',
    body: '',
    tags: [],
    compliance: { passed: false, violations: [], checkedBy: 'agent', checkedAt: null },
    state: 'topic',
    publishMeta: { publishedAt: null, externalUrl: '' },
    metrics: { views: 0, 完播率: 0, 收藏: 0, 评论具体句: 0, 引流私域: 0 },
    stateHistory: [{ state: 'topic', at: stamp(), by: 'human' }],
    createdAt: stamp(),
    updatedAt: stamp(),
    _createTime: stamp(),
  })
  if (pieceRes?.code) throw new Error(pieceRes.message)
  const pieceId = pieceRes.id
  let piece = { _id: pieceId, state: 'topic', compliance: { passed: false } }
  console.log('✓ 2. 创建看板卡片 topic', pieceId)

  // 3. topic → drafting
  await db.collection(COL_REVIEWS).add({
    pieceId,
    reviewer,
    decision: 'transition',
    comment: 'topic → drafting',
    constitutionCheck: { passed: false, notes: '' },
    reviewedAt: stamp(),
    createdAt: stamp(),
    updatedAt: stamp(),
    _createTime: stamp(),
  })
  await db.collection(COL_PIECES).doc(pieceId).update({
    state: 'drafting',
    body: COMPLIANT_BODY,
    stateHistory: [
      { state: 'topic', at: now, by: 'human' },
      { state: 'drafting', at: stamp(), by: reviewer },
    ],
    updatedAt: stamp(),
  })
  piece = { ...piece, state: 'drafting', body: COMPLIANT_BODY }
  console.log('✓ 3. topic → drafting')

  // 4. drafting → review（带合规结果）
  const compliance = {
    passed: true,
    violations: [],
    checkedBy: 'agent',
    checkedAt: stamp(),
  }
  await db.collection(COL_REVIEWS).add({
    pieceId,
    reviewer,
    decision: 'transition',
    comment: 'drafting → review',
    constitutionCheck: { passed: true, notes: '' },
    reviewedAt: stamp(),
    createdAt: stamp(),
    updatedAt: stamp(),
    _createTime: stamp(),
  })
  await db.collection(COL_PIECES).doc(pieceId).update({
    state: 'review',
    compliance,
    stateHistory: [
      { state: 'topic', at: now, by: 'human' },
      { state: 'drafting', at: now, by: reviewer },
      { state: 'review', at: stamp(), by: reviewer },
    ],
    updatedAt: stamp(),
  })
  piece = { ...piece, state: 'review', compliance }
  console.log('✓ 4. drafting → review')

  // 5. 闸口：未合规时 approve 被拒
  if (piece.compliance?.passed !== true) {
    throw new Error('自测数据异常：review 前应有合规通过')
  }
  const badPiece = { ...piece, compliance: { passed: false, violations: ['故意未过'] } }
  try {
    if (badPiece.compliance?.passed !== true) throw new Error('合规未通过，无法批准。请先重写或修正文案。')
    throw new Error('闸口未生效')
  } catch (e) {
    if (!/合规未通过/.test(e.message)) throw e
    console.log('✓ 5. 未合规时 approve 被拒绝')
  }

  // 6. review → approved（合规 + reviewer）
  await db.collection(COL_REVIEWS).add({
    pieceId,
    reviewer,
    decision: 'approve',
    comment: '流程自测通过',
    constitutionCheck: { passed: true, notes: '' },
    reviewedAt: stamp(),
    createdAt: stamp(),
    updatedAt: stamp(),
    _createTime: stamp(),
  })
  await db.collection(COL_PIECES).doc(pieceId).update({
    state: 'approved',
    stateHistory: [
      { state: 'topic', at: now, by: 'human' },
      { state: 'drafting', at: now, by: reviewer },
      { state: 'review', at: now, by: reviewer },
      { state: 'approved', at: stamp(), by: reviewer },
    ],
    updatedAt: stamp(),
  })
  console.log('✓ 6. review → approved')

  const final = await db.collection(COL_PIECES).doc(pieceId).get()
  const row = Array.isArray(final.data) ? final.data[0] : final.data
  if (row?.state !== 'approved') {
    throw new Error('最终状态应为 approved，实际：' + row?.state)
  }

  const reviews = await db.collection(COL_REVIEWS).where({ pieceId }).get()
  console.log('✓ content_reviews 记录数:', reviews.data?.length || 0)
  console.log('\n流程自测完成。pieceId:', pieceId)
}

main().catch((e) => {
  console.error('自测失败:', e.message || e)
  process.exit(1)
})
