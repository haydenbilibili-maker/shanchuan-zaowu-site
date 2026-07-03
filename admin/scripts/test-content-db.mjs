#!/usr/bin/env node
/**
 * 内容工厂 CloudBase 自测：content_topics add + list
 * Node 环境使用 @cloudbase/js-sdk（字段规范与 contentDb.js 一致）
 *
 * 用法：cd admin && node scripts/test-content-db.mjs
 * 前置：控制台已建 content_topics 并粘贴 cloudbase/rules/content_topics.json
 */
import cloudbase from '@cloudbase/js-sdk'

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const REGION = 'ap-shanghai'
const COL_TOPICS = 'content_topics'

function defaultTopic(overrides = {}) {
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

async function stampCreateNode(data) {
  const now = Date.now()
  return {
    ...data,
    createdAt: now,
    updatedAt: now,
    _createTime: now,
  }
}

async function main() {
  const app = cloudbase.init({ env: ENV_ID, region: REGION })
  await app.auth().signInAnonymously()
  const state = await app.auth().getLoginState()
  const openid = state?.user?.uid || state?.credential?.openid || 'admin'
  const db = app.database()
  const col = COL_TOPICS

  console.log('=== contentDb 自测：content_topics add + list ===')
  console.log('集合:', col, '| openid:', openid)

  const payload = await stampCreateNode(
    defaultTopic({
      title: `[自测] ${new Date().toISOString().slice(0, 19)}`,
      hook: '光落在容器边缘',
      rationale: 'test-content-db.mjs',
      source: 'human',
    })
  )

  let addRes
  try {
    addRes = await db.collection(col).add(payload)
  } catch (e) {
    console.error('\n❌ add 异常:', e.message)
    throw e
  }

  if (addRes?.code) {
    if (addRes.code === 'DATABASE_COLLECTION_NOT_EXIST') {
      console.error('\n❌ 集合不存在。请先在控制台创建 5 张表并粘贴 rules：')
      console.error('   cloudbase/schema/content_factory.md')
      console.error('   cloudbase/rules/content_*.json\n')
    }
    throw new Error(`${addRes.code}: ${addRes.message}`)
  }

  const newId = addRes?.id || addRes?._id
  console.log('✓ add 成功, _id:', newId)

  const listRes = await db.collection(col).limit(10).get()
  const rows = listRes.data || []
  console.log('✓ list 条数:', rows.length)
  console.log('  最新一条:', {
    _id: rows[0]?._id,
    title: rows[0]?.title,
    status: rows[0]?.status,
    createdAt: rows[0]?.createdAt,
    _openid: rows[0]?._openid,
  })

  const found = rows.some((r) => r._id === newId)
  console.log(found ? '✓ list 包含刚写入记录' : '⚠ list 未命中新 id（可能需刷新索引）')
  console.log('\n自测完成。')
}

main().catch((e) => {
  console.error('自测失败:', e.message || e)
  process.exit(1)
})
