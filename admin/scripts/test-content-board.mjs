#!/usr/bin/env node
/**
 * 看板状态机自测（蓝图 §6）
 * 模拟：drafting → review（成功）→ approve 因 compliance 未过被拒绝
 *
 * cd admin && node scripts/test-content-board.mjs
 */
import cloudbase from '@cloudbase/js-sdk'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN = join(__dirname, '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const REGION = 'ap-shanghai'
const COL_PIECES = 'content_pieces'
const COL_REVIEWS = 'content_reviews'

const ALLOWED = { drafting: ['review'], review: ['drafting', 'approved'] }

function loadEnv() {
  const path = join(ADMIN, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnv()

function assertTransition(from, to) {
  if (!(ALLOWED[from] || []).includes(to)) {
    throw new Error(`不允许从「${from}」流转到「${to}」`)
  }
}

function assertApproveGate(piece, reviewer) {
  if (!reviewer?.trim()) throw new Error('须指定终审人 reviewer')
  if (piece.state !== 'review') throw new Error('仅「待终审」状态可通过')
  if (piece.compliance?.passed !== true) {
    throw new Error('合规未通过，无法批准。请先重写或修正文案。')
  }
}

async function main() {
  const app = cloudbase.init({ env: ENV_ID, region: REGION })
  await app.auth().signInAnonymously()
  const state = await app.auth().getLoginState()
  const reviewer = state?.user?.uid || 'test-reviewer'
  const db = app.database()
  const now = Date.now()

  console.log('=== useContentBoard 自测：drafting→review，未合规 approve 被拒 ===\n')

  const pieceDoc = {
    title: `[自测] 看板闸口 ${new Date().toISOString().slice(0, 19)}`,
    body: '违规样例占位',
    ip: 'GRAVITY',
    platform: 'xhs',
    tags: [],
    compliance: { passed: false, violations: ['自测：故意未通过'], checkedBy: 'agent', checkedAt: now },
    state: 'drafting',
    publishMeta: { publishedAt: null, externalUrl: '' },
    metrics: { views: 0, 完播率: 0, 收藏: 0, 评论具体句: 0, 引流私域: 0 },
    stateHistory: [{ state: 'drafting', at: now, by: 'test' }],
    createdAt: now,
    updatedAt: now,
    _createTime: now,
  }

  const addRes = await db.collection(COL_PIECES).add(pieceDoc)
  if (addRes?.code) throw new Error(addRes.message || addRes.code)
  const pieceId = addRes.id || addRes._id
  let piece = { ...pieceDoc, _id: pieceId }
  console.log('✓ 创建 piece drafting, _id:', pieceId)

  // drafting → review
  assertTransition(piece.state, 'review')
  await db.collection(COL_REVIEWS).add({
    pieceId,
    reviewer,
    decision: 'transition',
    comment: 'drafting → review',
    constitutionCheck: { passed: false, notes: '' },
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
    _createTime: now,
  })
  await db.collection(COL_PIECES).doc(pieceId).update({
    state: 'review',
    stateHistory: [...piece.stateHistory, { state: 'review', at: Date.now(), by: reviewer }],
    updatedAt: Date.now(),
  })
  piece = { ...piece, state: 'review' }
  console.log('✓ drafting → review 成功')

  // review → approved 应被拒绝
  let rejected = false
  let rejectMsg = ''
  try {
    assertApproveGate(piece, reviewer)
    console.error('❌ 闸口未拦截：本应拒绝 approve')
    process.exit(1)
  } catch (e) {
    rejected = true
    rejectMsg = e.message
  }

  if (!rejected) {
    console.error('❌ 未抛出错误')
    process.exit(1)
  }
  console.log('✓ review → approved 被正确拒绝:', rejectMsg)

  const stillReview = await db.collection(COL_PIECES).doc(pieceId).get()
  const row = Array.isArray(stillReview.data) ? stillReview.data[0] : stillReview.data
  if (row?.state !== 'review') {
    console.error('❌ piece 状态不应变化，当前:', row?.state)
    process.exit(1)
  }
  console.log('✓ piece 仍停留在 review 状态')

  const reviews = await db.collection(COL_REVIEWS).where({ pieceId }).get()
  const count = reviews.data?.length || 0
  console.log('✓ content_reviews 流转记录数:', count, '(含 drafting→review)')

  console.log('\n自测完成。')
}

main().catch((e) => {
  console.error('自测失败:', e.message || e)
  process.exit(1)
})
