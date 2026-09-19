/**
 * 出货结算 · 通知（共享模块的**唯一真源**）
 * SSOT：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md §7
 *
 * 职责：
 *   ① 解析收件人（超管 / **指定门店的店长**）—— 后者是 store 维度的，
 *      既有 `payCallback/staffNotify.js` 的 `listStaffOpenidsByRoles` 只有角色维度、没有门店维度，
 *      所以这里按需自建，不整体复制那份已经漂成 3 个版本的文件；
 *   ② 把通知内容（标题/正文/跳转/变量）做成**纯函数**，便于守卫断言"不许报假金额"；
 *   ③ 投递：逐个 openid 调 `dispatchMessage`，**任何失败都不抛**。
 *
 * 为什么拆成共享模块：出货单生成（`manageStoreShipment`）与账单状态变更
 * （`manageStudioSettlement`）都要通知。云函数不能跨目录 require，故逐函数留副本，
 * 由 `check:shared-modules` 守副本一致（改了必须两边同步）。
 *
 * ⚠️ 铁律：**通知失败绝不能影响业务动作**。录单成功、确认收款成功，
 *    不能因为消息发不出去就回滚或报错 —— 所有投递异常一律吞掉并计入返回值。
 */
const { SUPER_ADMIN_OPENIDS } = require('./staffGuard')

const NOTIFY_EVENTS = {
  /** 出货单已生成且已核价 → 超管 + 该门店店长（去付款） */
  SHIPMENT_PRICED: 'studio_shipment_priced',
  /** 门店标了已付款 → 超管（去确认收款） */
  BILL_PAID_MARKED: 'studio_bill_paid_marked',
  /** 超管确认收款 → 该门店店长（告知已结清） */
  BILL_SETTLED: 'studio_bill_settled'
}

/**
 * 主店 id 别名（与 `manageStoreShipment/shipmentDefaults.js` 的 `MAIN_IDS` 同源）。
 * 用于「店长的 storeIds 写的是主店 id、单据写的是门店 id」这种历史差异。
 */
const STORE_ALIASES = {
  store_shanhaizaowu: ['store_1780146782017_6w0okpr'],
  store_1780146782017_6w0okpr: ['store_shanhaizaowu']
}

const ROLE_SUPER = 'super_admin'
const ROLE_MANAGER = 'manager'
const ROLE_STORE_MANAGER = 'store_manager'

function uniq(list) {
  const seen = {}
  const out = []
  for (const x of list || []) {
    const v = String(x || '').trim()
    if (!v || seen[v]) continue
    seen[v] = true
    out.push(v)
  }
  return out
}

function staffRolesOf(row) {
  const set = {}
  const push = (r) => {
    const v = String(r || '').trim()
    if (v) set[v] = true
  }
  if (row && Array.isArray(row.roles)) row.roles.forEach(push)
  if (row && row.role) push(row.role)
  if (row && row.workspaceRole) push(row.workspaceRole)
  return Object.keys(set)
}

function isStoreManagerRow(row) {
  const roles = staffRolesOf(row)
  return roles.indexOf(ROLE_STORE_MANAGER) !== -1 || roles.indexOf(ROLE_MANAGER) !== -1
}

function rowStoreIds(row) {
  const raw = row && (row.storeIds || row.storeId)
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean)
  const one = String(raw || '').trim()
  return one ? [one] : []
}

/** 该行是否属于指定门店。**没有 storeIds 的店长不匹配任何门店**（宁可漏发，不可错发别家门店的账） */
function rowBelongsToStore(row, storeId) {
  const sid = String(storeId || '').trim()
  if (!sid) return false
  const ids = rowStoreIds(row)
  if (!ids.length) return false
  const candidates = [sid].concat(STORE_ALIASES[sid] || [])
  return ids.some((id) => candidates.indexOf(id) !== -1)
}

async function loadConfiguredSuperAdminOpenids(db) {
  try {
    const res = await db.collection('workspace_acl').doc('super_admins').get()
    const list = (res.data && Array.isArray(res.data.openids) && res.data.openids) || []
    return list.map((id) => String(id || '').trim()).filter(Boolean)
  } catch (e) {
    return []
  }
}

async function loadActiveStaff(db) {
  try {
    const res = await db.collection('staff_members').where({ status: 'active' }).limit(200).get()
    return (res && res.data) || []
  } catch (e) {
    return []
  }
}

/**
 * 解析收件人。
 * @param {Object} db
 * @param {Object} want { storeId?, includeSuper?, includeStoreManager? }
 * @returns {Promise<{openids:string[], superCount:number, storeManagerCount:number, storeManagerMissing:boolean}>}
 */
async function resolveRecipients(db, want) {
  const w = want || {}
  const openids = []
  let superCount = 0
  let storeManagerCount = 0

  if (w.includeSuper !== false) {
    const dbSupers = await loadConfiguredSuperAdminOpenids(db)
    const list = uniq([].concat(SUPER_ADMIN_OPENIDS || [], dbSupers))
    superCount = list.length
    openids.push(...list)
  }

  const staff = await loadActiveStaff(db)
  if (w.includeSuper !== false) {
    // staff_members 里显式标了超管的也要算上（不能只靠硬编码白名单）
    const fromStaff = staff.filter((r) => staffRolesOf(r).indexOf(ROLE_SUPER) !== -1)
    const list = uniq(fromStaff.map((r) => r.openid))
    superCount = uniq([].concat(openids, list)).length
    openids.push(...list)
  }

  let storeManagerMissing = false
  if (w.includeStoreManager) {
    const sid = String(w.storeId || '').trim()
    const matched = staff.filter((r) => isStoreManagerRow(r) && rowBelongsToStore(r, sid))
    const list = uniq(matched.map((r) => r.openid))
    storeManagerCount = list.length
    storeManagerMissing = list.length === 0
    openids.push(...list)
  }

  return {
    openids: uniq(openids),
    superCount,
    storeManagerCount,
    storeManagerMissing
  }
}

/**
 * 投递（**best-effort，永不抛**）。
 * @returns {Promise<{sent:number, failed:number, errors:string[]}>}
 */
async function notifyStaff(cloud, params) {
  const p = params || {}
  const openids = uniq(p.openids)
  const out = { sent: 0, failed: 0, errors: [] }
  if (!openids.length || !p.eventType) return out
  for (const openid of openids) {
    try {
      await cloud.callFunction({
        name: 'dispatchMessage',
        data: {
          action: 'dispatch',
          eventType: p.eventType,
          openid,
          relatedId: p.relatedId || '',
          vars: p.vars || {}
        }
      })
      out.sent += 1
    } catch (e) {
      out.failed += 1
      if (out.errors.length < 3) out.errors.push(String((e && e.message) || e))
    }
  }
  return out
}

// ─────────────────────────── 通知内容（纯函数，可测） ───────────────────────────

function yuan(cents) {
  const n = Number(cents)
  return (Number.isFinite(n) ? Math.round(n) / 100 : 0).toFixed(2)
}

/**
 * 出货单已生成待支付。
 * ⚠️ **有未核价行时不许报一个假金额** —— 改成报"有几行待核价"，
 *    金额字段照实给已核价部分并明确标注，避免门店按一个假总额去备钱。
 */
function buildShipmentPricedNotice(shipment) {
  const s = shipment || {}
  const issue = Number(s.pricingIssueCount) || 0
  const priced = String(s.pricingStatus || '') !== 'incomplete'
  const total = yuan(s.totalCents)
  const vars = {
    shipmentNo: s.shipmentNo || '',
    storeName: s.storeName || '',
    shipmentDate: s.shipmentDate || '',
    totalQty: String(Number(s.totalQty) || 0),
    itemCount: String(Number(s.itemCount) || 0),
    totalAmount: total,
    pricingIssueCount: String(issue)
  }
  if (priced) {
    return Object.assign({ ready: true }, vars, {
      title: '新出货单待支付',
      content: `【待支付】${vars.storeName} 出货单 ${vars.shipmentNo}\n共 ${vars.totalQty} 件 · ¥${total}\n请核对后结款。`
    })
  }
  return Object.assign({ ready: false }, vars, {
    title: '新出货单待核价',
    // 纯文本，不要写 Markdown 星号 —— 微信消息不渲染 Markdown，会原样显示成 ** 号
    content: `【待核价】${vars.storeName} 出货单 ${vars.shipmentNo}\n有 ${issue} 行还没定好材料/包装，暂不能结款。\n已核价部分 ¥${total}（不是最终金额）。`
  })
}

function buildBillPaidMarkedNotice(bill) {
  const b = bill || {}
  const vars = {
    billNo: b.billNo || '',
    storeName: b.storeName || '',
    totalAmount: yuan(b.totalCents),
    shipmentCount: String(Number(b.shipmentCount) || 0),
    periodFrom: b.periodFrom || '',
    periodTo: b.periodTo || ''
  }
  return Object.assign({ ready: true }, vars, {
    title: '门店已标付款，待确认收款',
    content: `【待确认】${vars.storeName} 已标付款 ¥${vars.totalAmount}\n账单 ${vars.billNo} · ${vars.shipmentCount} 张单（${vars.periodFrom}~${vars.periodTo}）\n请核对到账后点「确认收款」。`
  })
}

function buildBillSettledNotice(bill) {
  const b = bill || {}
  const vars = {
    billNo: b.billNo || '',
    storeName: b.storeName || '',
    totalAmount: yuan(b.totalCents),
    shipmentCount: String(Number(b.shipmentCount) || 0)
  }
  return Object.assign({ ready: true }, vars, {
    title: '货款已结清',
    content: `【已结清】${vars.storeName} 货款 ¥${vars.totalAmount}\n账单 ${vars.billNo} · ${vars.shipmentCount} 张单已终结。`
  })
}

/** 把通知文案打成 dispatchMessage 的 vars（模板用 {{x}} 引用） */
function toDispatchVars(notice) {
  const n = notice || {}
  const out = {}
  for (const k of Object.keys(n)) {
    if (k === 'ready') continue
    if (k === 'title' || k === 'content') continue
    out[k] = n[k]
  }
  out.noticeTitle = n.title || ''
  out.noticeContent = n.content || ''
  return out
}

module.exports = {
  NOTIFY_EVENTS,
  STORE_ALIASES,
  ROLE_SUPER,
  ROLE_MANAGER,
  ROLE_STORE_MANAGER,
  uniq,
  staffRolesOf,
  isStoreManagerRow,
  rowStoreIds,
  rowBelongsToStore,
  resolveRecipients,
  notifyStaff,
  buildShipmentPricedNotice,
  buildBillPaidMarkedNotice,
  buildBillSettledNotice,
  toDispatchVars,
  yuan
}
