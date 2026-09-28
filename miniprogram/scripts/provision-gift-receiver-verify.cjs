#!/usr/bin/env node
/**
 * 幂等创建 gift_receiver_verify 集合（礼笺领取核验：受礼人手机号加盐哈希 + 尾号 + 核验尝试记录）
 * 权限：CUSTOM {read:false, write:false} —— 与 cloudbase/rules/gift_receiver_verify.json 一致，仅云函数（manageGift）可读写。
 * 只建空集合与权限，不写任何文档。_id = orderId，无需额外索引。
 * 环境：cloud1-8gnkty5bfff9f0bf；密钥：admin/.env 的 TCB_SECRET_*
 *
 * 用法：node miniprogram/scripts/provision-gift-receiver-verify.cjs [--dry-run]
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'gift_receiver_verify'
const RULE = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudbase/rules/gift_receiver_verify.json'), 'utf8'))

function loadDotEnv() {
  for (const file of ['admin/.env', 'admin/.env.local']) {
    const p = path.join(ROOT, file)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
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
}

async function main() {
  if (RULE.read !== false || RULE.write !== false) throw new Error('规则文件不是 {read:false, write:false}，拒绝执行')
  loadDotEnv()
  if (!process.env.TCB_SECRET_ID || !process.env.TCB_SECRET_KEY) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  const CloudBase = require(path.join(ROOT, 'node_modules/@cloudbase/manager-node'))
  const app = CloudBase.init({ secretId: process.env.TCB_SECRET_ID, secretKey: process.env.TCB_SECRET_KEY, envId: ENV_ID })
  const { database, permission } = app

  const exists = await database.checkCollectionExists(COLLECTION)
  console.log(`env=${ENV_ID} collection=${COLLECTION} exists=${!!(exists && exists.Exists)}`)
  if (process.argv.includes('--dry-run')) return
  if (!(exists && exists.Exists)) {
    await database.createCollectionIfNotExists(COLLECTION)
    console.log('✓ 已建集合')
  }
  await permission.modifyResourcePermission({
    resourceType: 'collection',
    resource: COLLECTION,
    permission: 'CUSTOM',
    securityRule: JSON.stringify(RULE)
  })
  console.log(`✓ 权限 CUSTOM ${JSON.stringify(RULE)}`)
  const after = await database.checkCollectionExists(COLLECTION)
  console.log(`校验 exists=${!!(after && after.Exists)}`)
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
