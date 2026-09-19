#!/usr/bin/env node
/**
 * 出货结算通知守卫（`settlementNotify.js`）
 *
 * 为什么需要（依据蓝图 §7）：
 *   ① **有未核价行时不许报一个假总额** —— 通知是让门店去**备钱**的。
 *      金额报错比不报更糟：门店会按错的数准备货款，到确认收款时才发现对不上。
 *   ② **收件人必须按门店隔离** —— `studio_bill_settled` 是发给「该门店店长」的。
 *      若门店过滤失效，山川造物的店长会收到星宸标本的账款金额。
 *   ③ 店长**没配 storeIds** 时不许匹配任何门店（宁可漏发，不可错发别家门店的账）；
 *      且要能报出 `storeManagerMissing`，让人查得出「是没配还是发失败」。
 *   ④ **通知失败绝不能影响业务动作**（录单/收款已成功，消息是告知）→ 投递永不抛。
 *
 * 本守卫**不测** dispatchMessage 的模板渲染与微信侧投递（那需要云环境）；
 * 只钉本模块的纯逻辑：取人、内容口径、best-effort 语义。
 *
 * 用法：
 *   node miniprogram/scripts/test-studio-notify.mjs
 *   node miniprogram/scripts/test-studio-notify.mjs --selftest
 * 退出码：断言失败 1；注入未被检出 1；全通过 0。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const SRC_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
const NOTIFY_PATH = join(SRC_DIR, 'settlementNotify.js')

let passes = 0
const failures = []
function ok(label, cond, detail) {
  if (cond) passes += 1
  else failures.push(detail ? `${label} —— ${detail}` : label)
}
function eq(label, got, want) {
  ok(label, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}
function deepEq(label, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  ok(label, a === b, `期望 ${b}，实际 ${a}`)
}

/** 桩 db：只实现本模块用到的两种读取 */
function stubDb(rows, superDoc) {
  return {
    collection(name) {
      return {
        where() {
          return {
            limit() {
              return { get: async () => ({ data: name === 'staff_members' ? rows : [] }) }
            }
          }
        },
        doc() {
          return { get: async () => ({ data: name === 'workspace_acl' ? superDoc : null }) }
        }
      }
    }
  }
}

/** 桩 cloud：记录投递，可按 openid 让特定投递抛错 */
function stubCloud(failFor) {
  const calls = []
  return {
    calls,
    callFunction: async (opts) => {
      const openid = opts.data.openid
      calls.push(openid)
      if (failFor && failFor.indexOf(openid) !== -1) throw new Error('boom:' + openid)
      return { result: { success: true } }
    }
  }
}

const STAFF = [
  // 星宸标本的店长（storeIds 用门店 id）
  { openid: 'mgr_xing', status: 'active', roles: ['store_manager'], storeIds: ['store_xingchen'] },
  // 山川造物的店长（storeIds 写的是主店别名 id）
  { openid: 'mgr_shan', status: 'active', workspaceRole: 'store_manager', storeIds: ['store_1780146782017_6w0okpr'] },
  // 没配门店范围的店长 —— 不许匹配任何门店
  { openid: 'mgr_orphan', status: 'active', roles: ['store_manager'], storeIds: [] },
  // 普通店员，不该被当成店长
  { openid: 'staff_1', status: 'active', roles: ['staff'], storeIds: ['store_xingchen'] },
  // staff_members 里显式标了超管
  { openid: 'super_in_staff', status: 'active', roles: ['super_admin'], storeIds: [] }
]

function runTests(N) {
  // ── A. 角色与门店解析（纯）──
  eq('A1 roles 数组被识别', N.staffRolesOf({ roles: ['a', 'b'] }).sort().join(), 'a,b')
  eq('A2 单个 role 被识别', N.staffRolesOf({ role: 'x' }).join(), 'x')
  eq('A3 workspaceRole 也算角色', N.staffRolesOf({ workspaceRole: 'store_manager' }).join(), 'store_manager')
  eq('A4 空行不报错', N.staffRolesOf(null).length, 0)
  ok('A5 manager 与 store_manager 互认', N.isStoreManagerRow({ roles: ['manager'] }) === true)
  ok('A6 普通店员不算店长', N.isStoreManagerRow({ roles: ['staff'] }) === false)

  deepEq('A7 门店 id 数组解析', N.rowStoreIds({ storeIds: ['a', ' b '] }), ['a', 'b'])
  deepEq('A8 单门店 id 也接受', N.rowStoreIds({ storeId: 'a' }), ['a'])
  deepEq('A9 没有门店范围返回空', N.rowStoreIds({}), [])
  ok('A10 门店匹配', N.rowBelongsToStore({ storeIds: ['store_xingchen'] }, 'store_xingchen') === true)
  ok('A11 别家门店不匹配', N.rowBelongsToStore({ storeIds: ['store_xingchen'] }, 'store_shanhaizaowu') === false)
  ok(
    'A12 主店别名能互相匹配（历史 id 差异）',
    N.rowBelongsToStore({ storeIds: ['store_1780146782017_6w0okpr'] }, 'store_shanhaizaowu') === true
  )
  ok('A13 **没配门店范围不匹配任何门店**（宁可漏发不可错发）', N.rowBelongsToStore({ storeIds: [] }, 'store_xingchen') === false)
  ok('A14 空 storeId 不匹配', N.rowBelongsToStore({ storeIds: ['a'] }, '') === false)

  // ── B. 通知内容口径（纯）──
  const incom = N.buildShipmentPricedNotice({
    shipmentNo: 'SH1',
    storeName: '星宸标本',
    pricingStatus: 'incomplete',
    pricingIssueCount: 3,
    totalCents: 58500,
    totalQty: 2,
    itemCount: 2
  })
  eq('B1 未核价时 ready=false', incom.ready, false)
  eq('B2 未核价时标题说「待核价」', incom.title, '新出货单待核价')
  ok('B3 未核价时正文报出行数', /3 行/.test(incom.content), incom.content)
  ok('B4 **未核价时正文明确说金额不是最终值**（关键：门店据此备钱）', /不是最终金额/.test(incom.content), incom.content)
  ok('B5 未核价时金额只作为「已核价部分」出现', /已核价部分/.test(incom.content), incom.content)

  const priced = N.buildShipmentPricedNotice({
    shipmentNo: 'SH1',
    storeName: '星宸标本',
    pricingStatus: 'priced',
    pricingIssueCount: 0,
    totalCents: 58500,
    totalQty: 2,
    itemCount: 2
  })
  eq('B6 全部核价 ready=true', priced.ready, true)
  eq('B7 全部核价标题说「待支付」', priced.title, '新出货单待支付')
  ok('B8 全部核价正文给出金额', /¥585\.00/.test(priced.content), priced.content)
  ok('B9 全部核价正文不出现「不是最终金额」', !/不是最终金额/.test(priced.content))
  ok('B10 正文是纯文本（不含 Markdown 星号，微信不渲染）', priced.content.indexOf('**') === -1, priced.content)

  const paid = N.buildBillPaidMarkedNotice({
    billNo: 'SB20260914-0001',
    storeName: '星宸标本',
    totalCents: 84500,
    shipmentCount: 2,
    periodFrom: '2026-09-14',
    periodTo: '2026-09-15'
  })
  ok('B11 待确认收款正文给出金额', /¥845\.00/.test(paid.content), paid.content)
  ok('B12 待确认收款正文提示点「确认收款」', /确认收款/.test(paid.content), paid.content)
  const settled = N.buildBillSettledNotice({ billNo: 'SB1', storeName: '星宸标本', totalCents: 84500, shipmentCount: 2 })
  ok('B13 已结清正文给出金额', /¥845\.00/.test(settled.content), settled.content)

  eq('B14 分转元（84500 → 845.00）', N.yuan(84500), '845.00')
  eq('B15 分转元（0 → 0.00）', N.yuan(0), '0.00')
  eq('B16 分转元对非法值兜底', N.yuan(null), '0.00')

  const vars = N.toDispatchVars(priced)
  ok('B17 投递变量带标题', vars.noticeTitle === '新出货单待支付')
  ok('B18 投递变量带正文', typeof vars.noticeContent === 'string' && vars.noticeContent.length > 0)
  ok('B19 投递变量不泄漏 ready', vars.ready === undefined)
  ok('B20 投递变量仍带业务字段（门店/单号）', vars.storeName === '星宸标本' && vars.shipmentNo === 'SH1')

  // ── C. 收件人解析 ──
  return (async () => {
    const db = stubDb(STAFF, { openids: ['super_cfg'] })
    const rAll = await N.resolveRecipients(db, {
      storeId: 'store_xingchen',
      includeSuper: true,
      includeStoreManager: true
    })
    ok('C1 超管含硬编码白名单', rAll.openids.length > 0)
    ok('C2 含 workspace_acl 配置的超管', rAll.openids.indexOf('super_cfg') !== -1)
    ok('C3 含 staff_members 里标了超管的人', rAll.openids.indexOf('super_in_staff') !== -1)
    ok('C4 含该门店店长', rAll.openids.indexOf('mgr_xing') !== -1)
    ok('C5 **不含别家门店的店长**', rAll.openids.indexOf('mgr_shan') === -1)
    ok('C6 **不含没配门店范围的店长**', rAll.openids.indexOf('mgr_orphan') === -1)
    ok('C7 不含普通店员', rAll.openids.indexOf('staff_1') === -1)
    eq('C8 收件人去重（无重复 openid）', rAll.openids.length, N.uniq(rAll.openids).length)
    eq('C9 店长命中数为 1', rAll.storeManagerCount, 1)
    eq('C10 店长没漏', rAll.storeManagerMissing, false)

    const rShan = await N.resolveRecipients(db, {
      storeId: 'store_shanhaizaowu',
      includeSuper: false,
      includeStoreManager: true
    })
    ok('C11 别家门店解析出的是对应店长（主店别名生效）', rShan.openids.indexOf('mgr_shan') !== -1)
    ok('C12 只发店长时不含超管', rShan.openids.indexOf('super_in_staff') === -1)
    eq('C13 只要店长时店长数正确', rShan.storeManagerCount, 1)

    const rMissing = await N.resolveRecipients(db, {
      storeId: 'store_nobody',
      includeSuper: false,
      includeStoreManager: true
    })
    eq('C14 找不到店长时收件人为空', rMissing.openids.length, 0)
    eq('C15 **找不到店长要能被报出来**（便于查「没配范围」还是「发失败」）', rMissing.storeManagerMissing, true)

    // ── D. 投递 best-effort ──
    const cloud = stubCloud(['bad_openid'])
    const d1 = await N.notifyStaff(cloud, { eventType: 'x', openids: ['a', 'b'], relatedId: 'r', vars: {} })
    eq('D1 正常投递计数', d1.sent, 2)
    eq('D2 正常投递无失败', d1.failed, 0)
    const cloud2 = stubCloud(['bad_openid'])
    let threw = false
    let d2 = null
    try {
      d2 = await N.notifyStaff(cloud2, {
        eventType: 'x',
        openids: ['ok_1', 'bad_openid', 'ok_2'],
        relatedId: 'r',
        vars: {}
      })
    } catch (e) {
      threw = true
    }
    ok('D3 **单个投递失败不会让整体抛出**（不影响业务动作）', threw === false)
    eq('D4 失败被计入而非中断', d2.failed, 1)
    eq('D5 失败后仍继续投递其余收件人', d2.sent, 2)
    ok('D6 失败原因被留痕', d2.errors.length === 1 && /boom/.test(d2.errors[0]), JSON.stringify(d2.errors))
    const d3 = await N.notifyStaff(stubCloud(), { eventType: 'x', openids: [], vars: {} })
    eq('D7 没有收件人时直接返回', d3.sent + d3.failed, 0)
    eq('D8 没有 eventType 时不投递', (await N.notifyStaff(stubCloud(), { openids: ['a'] })).sent, 0)
    eq('D9 收件人去重后只投一次', (await N.notifyStaff(stubCloud(), { eventType: 'x', openids: ['a', 'a', 'a'] })).sent, 1)
  })()
}

const INJECTIONS = [
  ['未核价也报最终金额（门店按假金额备钱）', (src) => src.replace('  if (priced) {', '  if (true) {')],
  ['店长不再按门店过滤（别家门店会收到本店账款）', (src) => src.replace('staff.filter((r) => isStoreManagerRow(r) && rowBelongsToStore(r, sid))', 'staff.filter((r) => isStoreManagerRow(r))')],
  ['没配门店范围的店长也算匹配', (src) => src.replace('  if (!ids.length) return false', '  if (!ids.length) return true')],
  ['投递失败改为抛出（会拖垮业务动作）', (src) => src.replace('      out.failed += 1\n      if (out.errors.length < 3) out.errors.push(String((e && e.message) || e))', '      throw e')],
  ['收件人不再去重', (src) => src.replace('    if (!v || seen[v]) continue', '    if (!v) continue')],
  ['「找不到店长」不再上报', (src) => src.replace('    storeManagerMissing = list.length === 0', '    storeManagerMissing = false')]
]

function loadNotify(dir) {
  const resolved = require.resolve(join(dir, 'settlementNotify.js'))
  delete require.cache[resolved]
  return require(join(dir, 'settlementNotify.js'))
}

async function runOnce(dir) {
  passes = 0
  failures.length = 0
  let N
  try {
    N = loadNotify(dir)
  } catch (e) {
    failures.push(`加载模块失败：${e.message}`)
    return { failed: failures.length, failures: failures.slice() }
  }
  try {
    await runTests(N)
  } catch (e) {
    failures.push(`断言执行抛异常：${e.message}`)
  }
  return { failed: failures.length, failures: failures.slice() }
}

async function runSelfTest() {
  console.log('自检：确认「通知逻辑被破坏」时断言确实会失败\n')
  const original = readFileSync(NOTIFY_PATH, 'utf8')
  let allDetected = true
  for (const [label, mutate] of INJECTIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-notify-selftest-'))
    const mutated = mutate(original)
    if (mutated === original) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    writeFileSync(join(dir, 'settlementNotify.js'), mutated, 'utf8')
    // 副本模块 require('./staffGuard')，必须一起带上
    copyFileSync(join(SRC_DIR, 'staffGuard.js'), join(dir, 'staffGuard.js'))
    const res = await runOnce(dir)
    const detected = res.failed > 0
    allDetected = allDetected && detected
    console.log(
      `${detected ? '✓' : '✗'} 注入 ${label} → ${detected ? '已检出' : '【漏检】'}${detected ? `（${res.failed} 项失败）` : ''}`
    )
    if (detected) res.failures.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    rmSync(dir, { recursive: true, force: true })
  }
  const clean = await runOnce(SRC_DIR)
  console.log(`\n${clean.failed === 0 ? '✓' : '✗'} 未注入时通过（${clean.failed === 0 ? '无假阳性' : '有假阳性'}）`)
  if (clean.failed > 0) clean.failures.slice(0, 5).forEach((f) => console.log(`    · ${f}`))
  if (!allDetected || clean.failed > 0) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

const isSelfTest = process.argv.includes('--selftest')
const result = isSelfTest ? null : await runOnce(SRC_DIR)
if (isSelfTest) {
  await runSelfTest()
} else {
  console.log(`结算通知：通过 ${passes} / ${passes + result.failed}`)
  if (result.failed > 0) {
    console.log('')
    result.failures.forEach((f) => console.log(`  ✗ ${f}`))
    console.log(`\n✗ ${result.failed} 项失败`)
    process.exit(1)
  }
  console.log('✓ 通知断言全部通过（门店隔离 / 未核价不报假金额 / 主店别名 / 失败即拒 / best-effort 投递 / 去重）')
}
