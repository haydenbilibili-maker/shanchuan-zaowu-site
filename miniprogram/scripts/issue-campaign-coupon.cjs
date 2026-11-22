#!/usr/bin/env node
/**
 * 活动券自动发放（issueCampaignCoupon）的运维脚本 —— 2026-10-29 双十一八折券
 *
 *   node miniprogram/scripts/issue-campaign-coupon.cjs dry-run   调云函数 dryRun（只返回将发人数，不写库）
 *   node miniprogram/scripts/issue-campaign-coupon.cjs status    只读核对：会员数 / 已持券人数（按 receiveType）/ 到期时刻 / 触发器状态
 *
 * dry-run 首次会给函数补 `ADMIN_OPS_KEY`（取自 manageProducts，合并写入不覆盖其它变量，只打印长度）。
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（只读取，不打印）。输出不含 openid / 手机号。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const FN = 'issueCampaignCoupon'
const COUPON_ID = '40407fa6e7f8342ac6a47201bfc92a15'
const TMP = path.join(ROOT, 'miniprogram/scripts/.tmp/issue-campaign')

function loadAdminEnv () {
  const env = {}
  for (const raw of fs.readFileSync(path.join(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  return env
}

function initApp () {
  const env = loadAdminEnv()
  const CB = require(path.join(ROOT, 'node_modules/@cloudbase/manager-node'))
  return CB.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })
}

function pullOpsKey () {
  fs.mkdirSync(TMP, { recursive: true })
  const out = path.join(TMP, 'ref.env')
  try {
    execFileSync('tcb', ['fn', 'env', 'pull', 'manageProducts', '--output-file', out, '--env-id', ENV_ID], {
      cwd: path.join(ROOT, 'miniprogram'), stdio: 'pipe'
    })
    const line = fs.readFileSync(out, 'utf8').split('\n').find((l) => l.startsWith('ADMIN_OPS_KEY='))
    const v = line ? line.slice('ADMIN_OPS_KEY='.length).trim() : ''
    if (!v) throw new Error('manageProducts 上没有 ADMIN_OPS_KEY，无法对齐')
    return v
  } finally {
    try { fs.unlinkSync(out) } catch (_) {}
  }
}

async function ensureOpsKey (functions) {
  const vars = async () => {
    const d = await functions.getFunctionDetail(FN)
    const map = {}
    for (const v of ((d && d.Environment && d.Environment.Variables) || [])) if (v && v.Key) map[v.Key] = v.Value
    return map
  }
  const cur = await vars()
  if (cur.ADMIN_OPS_KEY) return cur.ADMIN_OPS_KEY
  const key = pullOpsKey()
  await functions.updateFunctionConfig({ name: FN, envVariables: { ...cur, ADMIN_OPS_KEY: key } })
  const after = await vars()
  if (after.ADMIN_OPS_KEY !== key) throw new Error(FN + ' 补配 ADMIN_OPS_KEY 后复核不一致')
  console.log(`已给 ${FN} 补配 ADMIN_OPS_KEY（取自 manageProducts，长度 ${key.length}，不回显）`)
  return key
}

function parseRows (res) {
  const out = []
  const push = (v, d = 0) => {
    if (v == null || d > 4) return
    if (Array.isArray(v)) return v.forEach((x) => push(x, d + 1))
    if (typeof v === 'string') { try { push(JSON.parse(v), d + 1) } catch (e) {} return }
    out.push(v)
  }
  push(res && res.Data)
  return out
}

const num = (v) => (v && typeof v === 'object' ? Number(v.$numberInt || v.$numberLong || v.$numberDouble) : Number(v))

async function status (app) {
  const run = async (table, command) => parseRows(await app.database.runCommands({
    MgoCommands: [{ TableName: table, CommandType: 'COMMAND', Command: JSON.stringify(command) }]
  }))
  const members = await run('users', { count: 'users', query: { status: { $ne: 'cancelled' } } })
  const byType = await run('user_coupons', {
    aggregate: 'user_coupons',
    pipeline: [
      { $match: { couponId: COUPON_ID } },
      { $group: { _id: { receiveType: '$receiveType', status: '$status' }, n: { $sum: 1 }, minExp: { $min: '$expireTime' }, maxExp: { $max: '$expireTime' }, last: { $max: '$createTime' } } }
    ],
    cursor: {}
  })
  const notCw = await run('user_coupons', { count: 'user_coupons', query: { couponId: COUPON_ID, _id: { $not: { $regex: '^cw_' } } } })
  const detail = await app.functions.getFunctionDetail(FN)
  const trig = (detail.Triggers || []).map((t) => `${t.TriggerName} ${t.TriggerDesc} enable=${t.Enable}`)
  const fmt = (d) => (d && d.$date ? new Date(num(d.$date)).toISOString() : '')
  console.log(`北京时间 ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')}`)
  console.log(`未注销会员：${num(members[0] && members[0].n)}`)
  console.log('该券持有（按领取方式 / 状态）：')
  let total = 0
  for (const r of byType) {
    total += num(r.n)
    console.log(`  ${r._id.receiveType || '-'} / ${r._id.status || '-'}：${num(r.n)}  到期 ${fmt(r.minExp)} ~ ${fmt(r.maxExp)}  最近写入 ${fmt(r.last)}`)
  }
  console.log(`合计 ${total}；_id 不是 cw_ 开头的：${num(notCw[0] && notCw[0].n)}（应为 0）`)
  console.log(`触发器：${trig.join(' | ') || '（无）'}`)
}

async function main () {
  const cmd = process.argv[2]
  const app = initApp()
  if (cmd === 'dry-run') {
    const opsKey = await ensureOpsKey(app.functions)
    const res = await app.functions.invokeFunction(FN, { action: 'dryRun', opsKey })
    const ret = res && res.RetMsg
    console.log(JSON.stringify(typeof ret === 'string' ? JSON.parse(ret) : ret, null, 2))
  } else if (cmd === 'status') {
    await status(app)
  } else {
    console.log('用法：node miniprogram/scripts/issue-campaign-coupon.cjs dry-run|status')
    process.exitCode = 2
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
