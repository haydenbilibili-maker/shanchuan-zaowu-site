#!/usr/bin/env node
/**
 * 营销短信会员号码导出（只读生产库）—— 含个人信息，严格处理
 *
 * ⚠️ 输出只写仓库根的 `.tmp/<子目录>/`（已被根 .gitignore 的 `/.tmp/` 忽略），不写任何其它位置；
 *    启动时校验输出目录在 `.tmp/` 下且被 git 忽略，否则拒绝运行。文件权限 0600。
 *    控制台只打印数量与打码样例（159****5772），**不打印明文号码**。不提交、不上传数据文件。
 *
 * 口径（与 ERP「会员 CRM」/ manageMemberCrm 同源）：
 *   会员 = `users` 集合；手机号 = `users.phone`（注册绑定手机号，phoneVerifiedAt 同时写入）。
 *   等级 = manageMemberCrm 同一份 segmentation.buildProfile（订单成长值）+ storeGrowthValue
 *          → memberLevels.resolveMemberLevel（含荣誉馆长 / levelOverride）。
 *   下过单 = 订单状态 ∈ paid / shipped / received（segmentation.VALID_ORDER_STATUS）。
 *
 * 剔除规则（被剔除的号码另存一份供核对）：
 *   1. 无手机号 / 不是大陆 11 位手机号（须匹配 ^1[3-9]\d{9}$）—— 只计数；
 *   2. 已注销：users.status === 'cancelled'；
 *   3. 内部账号：staff_members（任何状态，含已停用）里角色含 员工/店长/超管 之一，或 users.staffRole 为这三者之一、users.isAdmin === true；
 *      股东（investor）与标本师（specimen_artisan）**不算内部账号**，照常发送（2026-10-29 产品负责人拍板）；
 *      该号码在任何一个账号上命中内部账号，就整号剔除（同号的其它账号也不发）；
 *   4. 疑似测试：昵称含 测试/test/demo/体验，或号码为同一数字重复 / 13800138000 / 12345678901 一类；
 *   5. 去重：同一号码多个账号只保留一条（取注册最早的账号做明细），明细里记同号账户数。
 *
 * 产出（--out 目录下）：
 *   sms-phones.txt            每行一个号码（腾讯云控制台群发只收 csv/xlsx；txt 供客户管理「手动输入」等用途）
 *   sms-phones.csv            表头「客户手机号」，腾讯云控制台群发「上传接收号码」可直接导入（链接是模板常量，无变量列）
 *   member-detail.csv         内部核对明细：号码 / 昵称 / 等级 / 注册时间 / 是否下过单 / 订单数 / 门店消费 / 分群 / 同号账户数
 *   excluded.csv              被剔除号码及原因
 *   summary.json              计数汇总（无号码）
 *
 * 用法：
 *   node miniprogram/scripts/export-sms-member-phones.mjs --out .tmp/sms-1111
 *   （`--out` 可给绝对路径，但必须位于某个仓库根的 `.tmp/` 下且被 git 忽略）
 *   依赖 @cloudbase/node-sdk：仓库根 node_modules 里没有时，用环境变量 CLOUDBASE_NODE_SDK 指向其目录。
 *   凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（只读取，不打印）。
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const require = createRequire(import.meta.url)
const CRM_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/manageMemberCrm')
const { buildProfile, VALID_ORDER_STATUS } = require(resolve(CRM_DIR, 'segmentation.js'))
const { loadMemberLevels, resolveMemberLevel } = require(resolve(CRM_DIR, 'memberLevels.js'))

const PHONE_RE = /^1[3-9]\d{9}$/
const INTERNAL_ROLES = new Set(['staff', 'manager', 'super_admin'])
const TEST_NICK_RE = /测试|test|demo|体验/i
const TEST_PHONES = new Set(['13800138000', '13800000000', '12345678901', '13888888888'])

export const mask = (p) => { const s = String(p || ''); return s.length === 11 ? `${s.slice(0, 3)}****${s.slice(7)}` : '***' }
export function normalizePhone (raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s-]/g, '')
  if (/^(\+?86)1\d{10}$/.test(s)) s = s.replace(/^\+?86/, '')
  return s
}
export function looksLikeTestPhone (p) {
  return TEST_PHONES.has(p) || /^1(\d)\1{9}$/.test(p) || /^1\d(\d)\1{8}$/.test(p)
}

function arg (name) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : ''
}

function resolveOutDir () {
  const raw = arg('out')
  if (!raw) throw new Error('缺少 --out（例如 .tmp/sms-1111）')
  const out = isAbsolute(raw) ? raw : resolve(ROOT, raw)
  if (!out.split(sep).includes('.tmp')) throw new Error('--out 必须位于仓库根的 .tmp/ 下：' + out)
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const real = realpathSync(out)
  let ignored = false
  try {
    execFileSync('git', ['check-ignore', '-q', resolve(real, 'probe.csv')], { cwd: real, stdio: 'ignore' })
    ignored = true
  } catch (_) { ignored = false }
  if (!ignored) throw new Error('输出目录未被 git 忽略，拒绝写入个人信息：' + real)
  return real
}

function openDb () {
  const env = {}
  for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  let tcb = null
  for (const p of [process.env.CLOUDBASE_NODE_SDK, resolve(ROOT, 'node_modules/@cloudbase/node-sdk')].filter(Boolean)) {
    try { tcb = require(p); break } catch (_) { /* 试下一个 */ }
  }
  if (!tcb) throw new Error('未找到 @cloudbase/node-sdk（可设 CLOUDBASE_NODE_SDK）')
  return tcb.init({ env: ENV_ID, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY }).database()
}

async function fetchAll (db, name) {
  const out = []
  for (let skip = 0; ; skip += 100) {
    const r = await db.collection(name).skip(skip).limit(100).get()
    out.push(...r.data)
    if (r.data.length < 100) break
  }
  return out
}

const toMs = (v) => {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date) return Number(new Date(v.$date))
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}
const fmtBj = (ms) => ms ? new Date(ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : ''
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csv = (header, rows) => '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** 纯函数：给定原始数据产出名单（selftest 直接调它） */
export function buildList ({ users, staff, orders, levels }) {
  const rolesOf = (s) => [s.role, ...(Array.isArray(s.roles) ? s.roles : [])].filter(Boolean)
  const staffOpenids = new Set(staff.filter((s) => rolesOf(s).some((r) => INTERNAL_ROLES.has(r))).map((s) => s.openid).filter(Boolean))
  const validOrders = new Map()
  for (const o of orders) {
    if (!o || !VALID_ORDER_STATUS.has(o.status)) continue
    const k = o._openid || o.openid
    validOrders.set(k, (validOrders.get(k) || 0) + 1)
  }
  const profiles = new Map(buildProfile({ users, orders, behaviors: [] }).map((p) => [p.openid, p]))

  const counts = { users: users.length, noPhone: 0, badFormat: 0 }
  const byPhone = new Map()
  for (const u of users) {
    if (!u.phone) { counts.noPhone++; continue }
    const phone = normalizePhone(u.phone)
    if (!PHONE_RE.test(phone)) { counts.badFormat++; continue }
    const reasons = []
    if (u.status === 'cancelled') reasons.push('已注销')
    if (staffOpenids.has(u._openid)) {
      const s = staff.find((x) => x.openid === u._openid)
      reasons.push(`内部账号(staff_members:${rolesOf(s).join('+')}${s.status && s.status !== 'active' ? '/' + s.status : ''})`)
    }
    if (INTERNAL_ROLES.has(u.staffRole)) reasons.push(`内部账号(users.staffRole:${u.staffRole})`)
    if (u.isAdmin === true) reasons.push('内部账号(users.isAdmin)')
    if (TEST_NICK_RE.test(String(u.nickName || ''))) reasons.push('疑似测试(昵称)')
    if (looksLikeTestPhone(phone)) reasons.push('疑似测试(号码)')
    if (!byPhone.has(phone)) byPhone.set(phone, [])
    byPhone.get(phone).push({ u, reasons })
  }

  const kept = []
  const excluded = []
  const reasonCount = {}
  let dupAccounts = 0
  for (const [phone, accs] of byPhone) {
    accs.sort((a, b) => toMs(a.u.registerTime || a.u.createTime) - toMs(b.u.registerTime || b.u.createTime))
    dupAccounts += accs.length - 1
    const reasons = [...new Set(accs.flatMap((a) => a.reasons))]
    const head = accs[0].u
    if (reasons.length) {
      for (const k of new Set(reasons.map((r) => r.replace(/\(.*$/, '')))) reasonCount[k] = (reasonCount[k] || 0) + 1
      excluded.push({ phone, nickName: head.nickName || '', reasons: reasons.join('；'), accounts: accs.length })
      continue
    }
    const p = profiles.get(head._openid) || {}
    const growth = (p.orderGrowthValue || 0) + Math.max(0, Math.floor(Number(head.storeGrowthValue) || 0))
    const lv = resolveMemberLevel(levels, growth, head.isHonorary === true, head.levelOverride || null)
    const orderCount = accs.reduce((n, a) => n + (validOrders.get(a.u._openid) || 0), 0)
    kept.push({
      phone,
      nickName: head.nickName || '',
      levelName: lv.levelName || '',
      registerAt: fmtBj(toMs(head.registerTime || head.createTime)),
      hasOrder: orderCount > 0 ? '是' : '否',
      orderCount,
      storeSpend: Number(head.storeSpendTotal) > 0 ? '有' : '无',
      segment: (p.segmentMeta && p.segmentMeta.label) || p.segment || '',
      accounts: accs.length
    })
  }
  kept.sort((a, b) => a.registerAt.localeCompare(b.registerAt))
  return { kept, excluded, counts: { ...counts, withValidPhone: byPhone.size + dupAccounts, uniquePhones: byPhone.size, dupAccounts, excludedPhones: excluded.length, excludedByReason: reasonCount, final: kept.length } }
}

function selftest () {
  const levels = []
  const users = [
    { _openid: 'a', phone: '13912345678', nickName: '甲', createTime: 1 },
    { _openid: 'b', phone: '13912345678', nickName: '甲小号', createTime: 2 },
    { _openid: 'c', phone: '13700001111', nickName: '员工', createTime: 3 },
    { _openid: 'c2', phone: '13700001111', nickName: '员工另一号', createTime: 4 },
    { _openid: 'd', phone: '+86 135 0000 2222', nickName: '乙', createTime: 5 },
    { _openid: 'e', phone: '12345678901', nickName: '丙', createTime: 6 },
    { _openid: 'f', phone: '13600003333', nickName: 'test01', createTime: 7 },
    { _openid: 'g', phone: '13600004444', nickName: '丁', status: 'cancelled', createTime: 8 },
    { _openid: 'h', nickName: '无号', createTime: 9 },
    { _openid: 'i', phone: '0571-8888', nickName: '座机', createTime: 10 },
    { _openid: 'j', phone: '15800005555', nickName: '店长', staffRole: 'manager', createTime: 11 },
    { _openid: 'k', phone: '15800006666', nickName: '股东', staffRole: 'investor', createTime: 12 },
    { _openid: 'l', phone: '15800007777', nickName: '标本师', createTime: 13 },
    { _openid: 'm', phone: '15800008888', nickName: '股东兼店长', createTime: 14 },
    { _openid: 'n', phone: '15800009999', nickName: '已停用股东', createTime: 15 }
  ]
  const staff = [
    { openid: 'c', role: 'staff', status: 'active' },
    { openid: 'k', role: 'investor', status: 'active' },
    { openid: 'l', role: 'specimen_artisan', status: 'active' },
    { openid: 'm', role: 'investor', roles: ['investor', 'manager'], status: 'active' },
    { openid: 'n', role: 'investor', status: 'disabled' }
  ]
  const orders = [{ _openid: 'b', status: 'paid', totalPrice: 10 }, { _openid: 'a', status: 'pending_pay' }]
  const r = buildList({ users, staff, orders, levels })
  const phones = r.kept.map((k) => k.phone).sort()
  const fails = []
  const expect = (cond, msg) => { if (!cond) fails.push(msg) }
  expect(JSON.stringify(phones) === JSON.stringify(['13500002222', '13912345678', '15800006666', '15800007777', '15800009999']), '保留名单应为 2 个普通会员 + 股东 + 标本师 + 已停用股东：' + phones.join(','))
  expect(r.excluded.some((e) => e.phone === '15800008888' && /manager/.test(e.reasons)), '股东兼店长（roles 含 manager）仍须剔除')
  expect(r.kept.find((k) => k.phone === '13912345678').hasOrder === '是', '同号小号的有效订单要计入「下过单」')
  expect(r.kept.find((k) => k.phone === '13912345678').accounts === 2, '同号账户数应为 2')
  expect(r.excluded.some((e) => e.phone === '13700001111' && /内部账号/.test(e.reasons)), '员工号（含同号另一账号）必须整号剔除')
  expect(r.excluded.some((e) => e.phone === '15800005555'), 'users.staffRole 为员工/店长/超管必须剔除')
  expect(r.excluded.some((e) => e.phone === '13600004444' && /已注销/.test(e.reasons)), '已注销必须剔除')
  expect(r.excluded.some((e) => e.phone === '13600003333'), '昵称含 test 必须剔除')
  expect(r.counts.noPhone === 1 && r.counts.badFormat === 2, '无号 1 / 非大陆手机号 2（座机 + 12 开头）')
  expect(mask('15912345772') === '159****5772', '打码格式')
  if (fails.length) { console.error('selftest 失败：\n- ' + fails.join('\n- ')); process.exit(1) }
  console.log('selftest 通过（去重 / +86 规范化 / 员工整号剔除 / 股东与标本师保留 / 注销 / 测试 / 格式 / 打码）')
}

async function main () {
  if (process.argv.includes('--selftest')) return selftest()
  const outDir = resolveOutDir()
  const db = openDb()
  const [users, staff, orders] = await Promise.all([fetchAll(db, 'users'), fetchAll(db, 'staff_members'), fetchAll(db, 'orders')])
  const { levels } = await loadMemberLevels(db)
  const { kept, excluded, counts } = buildList({ users, staff, orders, levels })

  const w = (name, text) => writeFileSync(resolve(outDir, name), text, { mode: 0o600 })
  w('sms-phones.txt', kept.map((k) => k.phone).join('\n') + '\n')
  w('sms-phones.csv', csv(['客户手机号'], kept.map((k) => [k.phone])))
  w('member-detail.csv', csv(
    ['手机号', '昵称', '会员等级', '注册时间(北京)', '是否下过单', '线上有效订单数', '门店消费', 'CRM分群', '同号账户数'],
    kept.map((k) => [k.phone, k.nickName, k.levelName, k.registerAt, k.hasOrder, k.orderCount, k.storeSpend, k.segment, k.accounts])
  ))
  w('excluded.csv', csv(['手机号', '昵称', '剔除原因', '同号账户数'], excluded.map((e) => [e.phone, e.nickName, e.reasons, e.accounts])))
  const summary = { generatedAt: new Date().toISOString(), env: ENV_ID, ...counts, ordersRead: orders.length, staffMembers: staff.length }
  w('summary.json', JSON.stringify(summary, null, 2) + '\n')

  console.log(JSON.stringify(summary, null, 2))
  console.log('样例（打码）：', kept.slice(0, 3).map((k) => mask(k.phone)).join(' / '))
  console.log('输出目录：', outDir)
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
