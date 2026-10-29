#!/usr/bin/env node
/**
 * 双十一八折券模板 · 生产 coupons 集合**只新增这一条**（产品负责人 2026-10-29 授权）
 *
 * 为什么是脚本：ERP 营销中心新版（券模板走 secureDataWrite + 时间窗表单）要等 main → Pages 部署后才可用，
 * 而活动 2026-10-30 00:00 开始；模板字段与新版 ERP「固定到期日」模式保存的形状一致（expireDays=0 + fixedExpireTime）。
 *
 *   node miniprogram/scripts/create-double11-coupon.mjs            # 只读预演：打印将写入的文档 + 线上是否已有同 campaignKey
 *   node miniprogram/scripts/create-double11-coupon.mjs --write    # 写入（已存在同 campaignKey 即拒绝，不覆盖）并读回核验字段类型
 *
 * 时刻一律带 +08:00 写成绝对时刻（BSON date）；云函数运行在 UTC，按绝对时刻比较。
 * 密钥只从 admin/.env 读（TCB_SECRET_ID / TCB_SECRET_KEY），不打印。
 * 下线：ERP 营销中心把该券「状态」关掉（active=false）即不再出现在可领列表、也领不到；已领的券到 fixedExpireTime 自然失效。
 */
import { readFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
export const CAMPAIGN_KEY = 'double11_2026'

export const DOUBLE11_TEMPLATE = {
  name: '双十一 · 全场八折券',
  type: 'discount',
  // 与 ERP 表单「折扣券(折)」同一写法：8 = 八折（couponDiscountRules.couponDiscountMultiplier(8) = 0.8）
  value: 8,
  minSpend: 0,
  condition: '无门槛',
  expireDays: 0,
  limitPerUser: 1,
  channel: 'all',
  active: true,
  startTime: '2026-10-30T00:00:00+08:00',
  endTime: '2026-11-15T23:59:59+08:00',
  fixedExpireTime: '2026-11-15T23:59:59+08:00',
  campaignKey: CAMPAIGN_KEY
}

export const TIME_FIELDS = ['startTime', 'endTime', 'fixedExpireTime']

/** 写库形状：三个时刻转 Date，补 createTime / updateTime（毫秒，与 ERP 同） */
export function buildCouponDoc(template = DOUBLE11_TEMPLATE, nowMs = Date.now()) {
  const doc = { ...template, createTime: nowMs, updateTime: nowMs }
  for (const k of TIME_FIELDS) {
    const d = new Date(template[k])
    if (Number.isNaN(d.getTime())) throw new Error(`${k} 不是合法时刻：${template[k]}`)
    doc[k] = d
  }
  return doc
}

function toEjson(doc) {
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    out[k] = v instanceof Date ? { $date: { $numberLong: String(v.getTime()) } } : v
  }
  return out
}

function parseMgo(res) {
  const out = []
  const push = (v, depth = 0) => {
    if (v == null || depth > 4) return
    if (Array.isArray(v)) { v.forEach((x) => push(x, depth + 1)); return }
    if (typeof v === 'string') { try { push(JSON.parse(v), depth + 1) } catch (e) { /* 非 JSON */ } return }
    if (typeof v === 'object') out.push(v)
  }
  push(res && res.Data)
  return out
}

async function main() {
  const write = process.argv.includes('--write')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const envFile = [join(ROOT, 'admin/.env'), process.env.SCZW_ADMIN_ENV].filter(Boolean).find((p) => existsSync(p))
  if (!envFile) throw new Error('找不到 admin/.env（TCB_SECRET_ID / TCB_SECRET_KEY）')
  const env = {}
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  const require = createRequire(import.meta.url)
  let CloudBase = null
  for (const id of ['@cloudbase/manager-node', join(ROOT, 'node_modules/@cloudbase/manager-node')]) {
    try { CloudBase = require(id); break } catch (e) { /* 下一个 */ }
  }
  if (!CloudBase) throw new Error('未安装 @cloudbase/manager-node')
  const { database } = CloudBase.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })
  const run = async (command) => parseMgo(await database.runCommands({
    MgoCommands: [{ TableName: 'coupons', CommandType: 'COMMAND', Command: JSON.stringify(command) }]
  }))

  const existing = await run({ find: 'coupons', filter: { campaignKey: CAMPAIGN_KEY }, limit: 5 })
  const doc = buildCouponDoc()
  const _id = randomBytes(16).toString('hex')
  console.log(`env=${ENV_ID}  集合 coupons  模式：${write ? '写入' : '只读预演'}`)
  console.log('将写入：', JSON.stringify({ _id, ...doc }, null, 2))
  for (const k of TIME_FIELDS) {
    console.log(`  ${k}: ${doc[k].toISOString()}（北京时间 ${new Date(doc[k].getTime() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')}）`)
  }
  if (existing.length) {
    console.log(`\n线上已有 campaignKey=${CAMPAIGN_KEY} 的模板：${existing.map((d) => d._id).join(', ')} —— 不重复写入。`)
    process.exitCode = write ? 1 : 0
    return
  }
  if (!write) {
    console.log('\n预演结束：线上无同 campaignKey 模板。加 --write 才写入。')
    return
  }
  const ins = await run({ insert: 'coupons', documents: [{ _id, ...toEjson(doc) }] })
  console.log('insert 回执：', JSON.stringify(ins))
  const back = await run({
    aggregate: 'coupons',
    pipeline: [
      { $match: { _id } },
      { $project: { name: 1, type: 1, value: 1, limitPerUser: 1, channel: 1, active: 1, expireDays: 1, minSpend: 1, stackable: 1, totalStock: 1, startTime: 1, endTime: 1, fixedExpireTime: 1,
        tStart: { $type: '$startTime' }, tEnd: { $type: '$endTime' }, tFixed: { $type: '$fixedExpireTime' }, tId: { $type: '$_id' } } }
    ],
    cursor: {}
  })
  console.log('读回：', JSON.stringify(back))
  const row = back[0]
  const bad = []
  if (!row) bad.push('读不回文档')
  else {
    if (row.tId !== 'string') bad.push(`_id 类型 ${row.tId}`)
    for (const t of ['tStart', 'tEnd', 'tFixed']) if (row[t] !== 'date') bad.push(`${t}=${row[t]}`)
    if (row.stackable != null) bad.push('不应有 stackable')
    if (row.totalStock != null) bad.push('不应有 totalStock')
  }
  if (bad.length) {
    console.error(`✗ 读回核验失败：${bad.join('；')}（文档 _id=${_id}，请人工核对后处理）`)
    process.exitCode = 1
    return
  }
  console.log(`✓ 已写入并核验：_id=${_id}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error('✗', e.message); process.exit(1) })
}
