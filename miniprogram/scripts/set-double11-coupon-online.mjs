#!/usr/bin/env node
/**
 * 双十一八折券 → 仅线上（产品负责人 2026-10-30 点名授权，只改这一张活动券）
 *
 *   node miniprogram/scripts/set-double11-coupon-online.mjs            # dry-run：计数 + 打码样例，写 .tmp/
 *   node miniprogram/scripts/set-double11-coupon-online.mjs --write    # 执行写入并读回核验
 *
 * 改动范围：
 *   - coupons 模板 channel → online；name →「双十一 · 线上八折券」
 *   - 同 couponId 的 user_coupons：凡 channel ≠ online 的改成 online（所有状态）；
 *     title 一并改成新名称（含 used，避免退回后展示仍写「全场」）
 *
 * 密钥只从 admin/.env 读，不打印。输出只写仓库根 .tmp/double11-online/
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
export const COUPON_ID = '40407fa6e7f8342ac6a47201bfc92a15'
export const NEW_NAME = '双十一 · 线上八折券'
export const NEW_CHANNEL = 'online'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = join(ROOT, '.tmp/double11-online')
const PAGE = 100

function maskOpenid(oid) {
  const s = String(oid || '')
  if (s.length <= 8) return '****'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

function loadEnv() {
  const envFile = [join(ROOT, 'admin/.env'), process.env.SCZW_ADMIN_ENV].filter(Boolean).find((p) => existsSync(p))
  if (!envFile) throw new Error('找不到 admin/.env（TCB_SECRET_ID / TCB_SECRET_KEY）')
  const env = {}
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  return env
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

function initDb() {
  const env = loadEnv()
  const require = createRequire(import.meta.url)
  let CloudBase = null
  for (const id of ['@cloudbase/manager-node', join(ROOT, 'node_modules/@cloudbase/manager-node')]) {
    try { CloudBase = require(id); break } catch (e) { /* 下一个 */ }
  }
  if (!CloudBase) throw new Error('未安装 @cloudbase/manager-node')
  const { database } = CloudBase.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })
  const run = async (table, command) => parseMgo(await database.runCommands({
    MgoCommands: [{ TableName: table, CommandType: 'COMMAND', Command: JSON.stringify(command) }]
  }))
  const update = async (table, command) => parseMgo(await database.runCommands({
    MgoCommands: [{ TableName: table, CommandType: 'UPDATE', Command: JSON.stringify(command) }]
  }))
  return { run, update }
}

async function fetchAllUserCoupons(run) {
  const rows = []
  for (let skip = 0; ; skip += PAGE) {
    const batch = await run('user_coupons', {
      find: 'user_coupons',
      filter: { couponId: COUPON_ID },
      projection: { _id: 1, _openid: 1, channel: 1, title: 1, status: 1, name: 1 },
      skip,
      limit: PAGE
    })
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

function classify(rows) {
  const needChannel = []
  const needTitle = []
  const byStatus = {}
  const byChannel = {}
  for (const r of rows) {
    const st = String(r.status || '')
    byStatus[st] = (byStatus[st] || 0) + 1
    const ch = r.channel == null || r.channel === '' ? '(缺省)' : String(r.channel)
    byChannel[ch] = (byChannel[ch] || 0) + 1
    if (String(r.channel || '') !== NEW_CHANNEL) needChannel.push(r)
    if (String(r.title || r.name || '') !== NEW_NAME) needTitle.push(r)
  }
  return { needChannel, needTitle, byStatus, byChannel, total: rows.length }
}

function sample(rows, n = 5) {
  return rows.slice(0, n).map((r) => ({
    _id: String(r._id || '').slice(0, 12) + '…',
    openid: maskOpenid(r._openid),
    channel: r.channel == null ? null : r.channel,
    status: r.status,
    title: r.title || r.name || ''
  }))
}

async function main() {
  const write = process.argv.includes('--write')
  mkdirSync(OUT_DIR, { recursive: true })
  const { run, update } = initDb()

  const tplRows = await run('coupons', {
    find: 'coupons',
    filter: { _id: COUPON_ID },
    limit: 1
  })
  const tpl = tplRows[0]
  if (!tpl) throw new Error(`模板不存在：${COUPON_ID}`)

  const ucRows = await fetchAllUserCoupons(run)
  const cls = classify(ucRows)

  const report = {
    at: new Date().toISOString(),
    mode: write ? 'write' : 'dry-run',
    envId: ENV_ID,
    couponId: COUPON_ID,
    newName: NEW_NAME,
    newChannel: NEW_CHANNEL,
    template: {
      _id: COUPON_ID,
      name: tpl.name || tpl.title,
      channel: tpl.channel == null ? null : tpl.channel,
      active: tpl.active,
      needChannel: String(tpl.channel || '') !== NEW_CHANNEL,
      needName: String(tpl.name || tpl.title || '') !== NEW_NAME
    },
    userCoupons: {
      total: cls.total,
      byStatus: cls.byStatus,
      byChannel: cls.byChannel,
      needChannelCount: cls.needChannel.length,
      needTitleCount: cls.needTitle.length,
      channelSamples: sample(cls.needChannel),
      titleSamples: sample(cls.needTitle)
    },
    writeResult: null
  }

  console.log(`env=${ENV_ID}  模式：${write ? '写入' : 'dry-run'}`)
  console.log(`模板 name=${report.template.name}  channel=${report.template.channel}  needChannel=${report.template.needChannel}  needName=${report.template.needName}`)
  console.log(`user_coupons 共 ${cls.total} 条；需改 channel ${cls.needChannel.length}；需改 title ${cls.needTitle.length}`)
  console.log('  byChannel:', JSON.stringify(cls.byChannel))
  console.log('  byStatus:', JSON.stringify(cls.byStatus))
  console.log('  channel 样例（打码）:', JSON.stringify(report.userCoupons.channelSamples, null, 2))

  if (!write) {
    const out = join(OUT_DIR, 'dry-run.json')
    writeFileSync(out, JSON.stringify(report, null, 2))
    console.log(`\n预演结束，报告 → ${out}`)
    console.log('确认后加 --write 执行。')
    return
  }

  const wr = { template: null, userChannel: null, userTitle: null, verify: null }

  if (report.template.needChannel || report.template.needName) {
    const set = { updateTime: Date.now() }
    if (report.template.needChannel) set.channel = NEW_CHANNEL
    if (report.template.needName) set.name = NEW_NAME
    wr.template = await update('coupons', {
      update: 'coupons',
      updates: [{ q: { _id: COUPON_ID }, u: { $set: set }, multi: false, upsert: false }]
    })
  } else {
    wr.template = { skipped: true, reason: '模板已是目标 name/channel' }
  }

  if (cls.needChannel.length) {
    wr.userChannel = await update('user_coupons', {
      update: 'user_coupons',
      updates: [{
        q: { couponId: COUPON_ID, channel: { $ne: NEW_CHANNEL } },
        u: { $set: { channel: NEW_CHANNEL } },
        multi: true,
        upsert: false
      }]
    })
    // 缺省 / null / '' 不会被 $ne 命中的情况：再补三刀
    for (const q of [
      { couponId: COUPON_ID, channel: { $exists: false } },
      { couponId: COUPON_ID, channel: null },
      { couponId: COUPON_ID, channel: '' }
    ]) {
      await update('user_coupons', {
        update: 'user_coupons',
        updates: [{ q, u: { $set: { channel: NEW_CHANNEL } }, multi: true, upsert: false }]
      })
    }
  } else {
    wr.userChannel = { skipped: true, reason: '全部已是 online' }
  }

  if (cls.needTitle.length) {
    wr.userTitle = await update('user_coupons', {
      update: 'user_coupons',
      updates: [{
        q: { couponId: COUPON_ID, title: { $ne: NEW_NAME } },
        u: { $set: { title: NEW_NAME } },
        multi: true,
        upsert: false
      }]
    })
    for (const q of [
      { couponId: COUPON_ID, title: { $exists: false } },
      { couponId: COUPON_ID, title: null },
      { couponId: COUPON_ID, title: '' }
    ]) {
      await update('user_coupons', {
        update: 'user_coupons',
        updates: [{ q, u: { $set: { title: NEW_NAME } }, multi: true, upsert: false }]
      })
    }
  } else {
    wr.userTitle = { skipped: true, reason: '全部已是新标题' }
  }

  const tplBack = (await run('coupons', {
    find: 'coupons', filter: { _id: COUPON_ID }, limit: 1,
    projection: { name: 1, channel: 1, active: 1 }
  }))[0]
  const after = await fetchAllUserCoupons(run)
  const afterCls = classify(after)
  const channelDist = {}
  for (const r of after) {
    const ch = r.channel == null || r.channel === '' ? '(缺省)' : String(r.channel)
    channelDist[ch] = (channelDist[ch] || 0) + 1
  }
  wr.verify = {
    template: { name: tplBack && tplBack.name, channel: tplBack && tplBack.channel },
    userCouponsRemainingBadChannel: afterCls.needChannel.length,
    userCouponsRemainingBadTitle: afterCls.needTitle.length,
    channelDist,
    sample: sample(after, 3)
  }

  report.writeResult = wr
  const out = join(OUT_DIR, 'write-result.json')
  writeFileSync(out, JSON.stringify(report, null, 2))

  const bad = []
  if (!tplBack || tplBack.channel !== NEW_CHANNEL) bad.push(`模板 channel=${tplBack && tplBack.channel}`)
  if (!tplBack || tplBack.name !== NEW_NAME) bad.push(`模板 name=${tplBack && tplBack.name}`)
  if (afterCls.needChannel.length) bad.push(`仍有 ${afterCls.needChannel.length} 条 user_coupons channel≠online`)
  if (afterCls.needTitle.length) bad.push(`仍有 ${afterCls.needTitle.length} 条 user_coupons title 未改`)
  if (bad.length) {
    console.error('✗ 写后核验失败：' + bad.join('；'))
    console.error(`报告 → ${out}`)
    process.exitCode = 1
    return
  }
  console.log(`✓ 已改写并核验：模板 channel=online name=${NEW_NAME}；user_coupons ${after.length} 条全部 online`)
  console.log(`报告 → ${out}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error('✗', e && e.message ? e.message : e); process.exit(1) })
}
