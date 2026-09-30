/**
 * 供应商管理中心 · 纯函数内核（无 IO，守卫可直接加载）
 * 蓝图：admin/docs/供应商管理中心_Phase2_技术蓝图_2026-09-28.md
 *
 * 金额一律「分」（*Fen）；时间一律北京时间营业日（与 manager/utils/reportDay.js 同式）。
 */

const TZ_SHANGHAI = 8 * 60 * 60 * 1000
const MS_DAY = 24 * 60 * 60 * 1000

/** 超期阈值（天）：账期待产品点名（蓝图 N-4） */
const PAY_TERM_DAYS = 7

const SOURCE_BUYER = 'buyer_workbench'
const PARTY_SUPPLIER = 'supplier_fulfillment'

const B2B_ROLES = ['buyer', 'franchisee', 'channel', 'supplier']
const BUYER_ROLES = ['buyer', 'franchisee', 'channel']

/** 功能项目录：缺省即默认（存量伙伴行为不变） */
const DESK_FEATURES = [
  { key: 'catalog', label: '价目选购', side: 'buyer', def: true, hint: '采购商看供货价目并加购' },
  { key: 'order', label: '下单 / 支付 / 我的采购单', side: 'buyer', def: true, hint: '服务端校验待 B2B 支付流接入（CR-1）' },
  { key: 'demand', label: '采购需求', side: 'supplier', def: true, hint: '供货方查看发给自己的需求' },
  { key: 'ship', label: '发货回传', side: 'supplier', def: false, hint: '写回尚未开放，先占位（默认关）' },
  { key: 'statement', label: '对账与物流', side: 'both', def: true, hint: '本人单据的货款、账龄与运单' }
]

const PO_STATUS_LABEL = {
  draft: '草稿',
  submitted: '待确认',
  pending_supplier_confirm: '待供货方确认',
  confirmed: '已确认',
  shipping: '出货中',
  shipped: '已发货',
  received: '已签收',
  closed: '已完成',
  cancelled: '已取消'
}

const PAY_BUCKET_LABEL = {
  received: '已收款',
  marked: '验收标记',
  due: '待收款',
  offline: '对公待确认',
  review: '金额待核对',
  refunded: '已退款',
  na: '不适用'
}

const PREP_METHODS = ['干制', '浸液', '塑化', '其他']
const PACKAGING_FILTERS = ['玻璃罩', '相框', '冰箱贴', '精灵球', '蝶翅画', '压制标本', '创意摆件', '首饰', '收藏级标本', '其它标本']
const BIO_FILTERS = ['植物果实', '海洋', '蝴蝶', '昆虫', '哺乳动物', '两栖动物', '爬行动物']

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isDateKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))
}

/** 任意时刻 → 北京时间营业日 YYYY-MM-DD */
function bizDateKey(ms) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return ''
  const s = new Date(t + TZ_SHANGHAI)
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`
}

function keyToUtcNoon(key) {
  const [y, m, d] = String(key).split('-').map((x) => parseInt(x, 10))
  return Date.UTC(y, m - 1, d, 12, 0, 0, 0)
}

function addDays(key, delta) {
  if (!isDateKey(key)) return ''
  const s = new Date(keyToUtcNoon(key) + (Number(delta) || 0) * MS_DAY)
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`
}

/** 北京时间营业日起止毫秒（闭区间） */
function dayBounds(key) {
  if (!isDateKey(key)) return { startTs: 0, endTs: 0 }
  const [y, m, d] = key.split('-').map((x) => parseInt(x, 10))
  const startTs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TZ_SHANGHAI
  return { startTs, endTs: startTs + MS_DAY - 1 }
}

/** 两个营业日之间相差的天数（b - a） */
function dayDiff(aKey, bKey) {
  if (!isDateKey(aKey) || !isDateKey(bKey)) return 0
  return Math.round((keyToUtcNoon(bKey) - keyToUtcNoon(aKey)) / MS_DAY)
}

const RANGE_LABEL = { today: '今日', '7d': '近 7 天', '30d': '近 30 天', month: '本月', all: '全部' }

/**
 * 范围 → { startTs, endTs, startDate, endDate, label }；显式 startDate/endDate 优先。
 */
function resolveRange(opts, nowMs) {
  const o = opts || {}
  const today = bizDateKey(nowMs == null ? Date.now() : nowMs)
  let startDate = ''
  let endDate = ''
  let key = String(o.range || '').trim()
  if (isDateKey(o.startDate) || isDateKey(o.endDate)) {
    startDate = isDateKey(o.startDate) ? o.startDate : ''
    endDate = isDateKey(o.endDate) ? o.endDate : ''
    key = 'custom'
  } else if (key === 'today') {
    startDate = today
    endDate = today
  } else if (key === '7d') {
    startDate = addDays(today, -6)
    endDate = today
  } else if (key === '30d') {
    startDate = addDays(today, -29)
    endDate = today
  } else if (key === 'month') {
    startDate = `${today.slice(0, 7)}-01`
    endDate = today
  } else {
    key = 'all'
  }
  if (startDate && endDate && startDate > endDate) {
    const t = startDate
    startDate = endDate
    endDate = t
  }
  const startTs = startDate ? dayBounds(startDate).startTs : 0
  const endTs = endDate ? dayBounds(endDate).endTs : 0
  const label =
    key === 'custom'
      ? `${startDate || '最早'} ~ ${endDate || '今天'}`
      : RANGE_LABEL[key] || '全部'
  return { key, startDate, endDate, startTs, endTs, label, today }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function orderTime(po) {
  return num(po && po.submittedAt) || num(po && po.createdAt) || 0
}

function inRange(po, range) {
  const t = orderTime(po)
  if (range.startTs && t < range.startTs) return false
  if (range.endTs && t > range.endTs) return false
  return true
}

function isSupplierOrder(po) {
  return String((po && po.party) || '') === PARTY_SUPPLIER
}

function isBuyerOrder(po) {
  return !isSupplierOrder(po) && String((po && po.source) || '') === SOURCE_BUYER
}

function isDeskOrder(po) {
  return isSupplierOrder(po) || isBuyerOrder(po)
}

function buyerOpenidOf(po) {
  return String((po && (po.buyerOpenid || po._openid)) || '')
}

function partnerKeyOf(po) {
  if (isSupplierOrder(po)) return `s:${String(po.supplierId || '')}`
  if (isBuyerOrder(po)) return `b:${buyerOpenidOf(po)}`
  return `o:${String((po && (po.storeId || po.storeName)) || '')}`
}

/** 订单金额（分）：totalAmount 是元、payFen 是分 —— 名字自带单位，不混用（错题本 E18） */
function amountFenOf(po) {
  const yuan = num(po && po.totalAmount)
  if (yuan != null && yuan > 0) return Math.round(yuan * 100)
  const fen = num(po && po.payFen)
  if (fen != null && fen > 0) return Math.round(fen)
  return 0
}

function isRefunded(po) {
  const refund = po && po.refund && typeof po.refund === 'object' ? po.refund : null
  return String((po && po.paymentStatus) || '') === 'refunded' || !!(refund && refund.status === 'refunded')
}

/** 货款分档：采购商单才有 B2B 支付字段；供货方单 / 其它来源 = 不适用 */
function payBucketOf(po) {
  if (!isBuyerOrder(po)) return 'na'
  if (isRefunded(po)) return 'refunded'
  const s = String(po.paymentStatus || '')
  if (s === 'paid') return 'received'
  if (s === 'marked_paid') return 'marked'
  if (s === 'offline_pending') return 'offline'
  if (s === 'pay_review') return 'review'
  return 'due'
}

function receivedFenOf(po) {
  const paid = num(po && po.paidFen)
  if (paid != null && paid > 0) return Math.round(paid)
  return amountFenOf(po)
}

function isClosedStatus(st) {
  return st === 'cancelled' || st === 'draft'
}

function fulfilStageOf(po) {
  const st = String((po && po.status) || '')
  if (st === 'cancelled') return 'cancelled'
  if (st === 'draft') return 'draft'
  if (po && num(po.receivedAt)) return 'received'
  if (st === 'received' || st === 'closed') return 'received'
  if (st === 'shipped') return 'transit'
  if (st === 'confirmed' || st === 'shipping') return 'toShip'
  return 'pendingConfirm'
}

const STAGE_LABEL = {
  pendingConfirm: '待确认',
  toShip: '待发货',
  transit: '在途',
  received: '已签收',
  cancelled: '已取消',
  draft: '草稿'
}

/** 账龄：仅未结清（待收 / 对公 / 待核对）且未关闭的单；按北京时间营业日差 */
function agingOf(po, nowMs) {
  const bucket = payBucketOf(po)
  const st = String((po && po.status) || '')
  if (['due', 'offline', 'review'].indexOf(bucket) === -1 || isClosedStatus(st)) {
    return { open: false, days: 0, band: '', overdue: false }
  }
  const from = bizDateKey(orderTime(po))
  const today = bizDateKey(nowMs == null ? Date.now() : nowMs)
  const days = from ? Math.max(0, dayDiff(from, today)) : 0
  const band = days <= 7 ? '0-7' : days <= 30 ? '8-30' : '30+'
  return { open: true, days, band, overdue: days > PAY_TERM_DAYS }
}

function yuanText(fen) {
  const n = Math.round(Number(fen) || 0)
  const neg = n < 0
  const abs = Math.abs(n)
  const y = Math.floor(abs / 100)
  const c = abs % 100
  const int = String(y).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}¥${int}${c ? '.' + pad2(c) : ''}`
}

function tailOf(s, n) {
  const str = String(s || '')
  return str.length > n ? str.slice(-n) : str
}

function fmtTime(ms) {
  const t = num(ms)
  if (!t) return ''
  const s = new Date(t + TZ_SHANGHAI)
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`
}

/** 物流：出货单优先（ERP 发货写 fulfillment_shipments.logistics），其次采购单上的供货方回传字段 */
function logisticsOf(po, shipments) {
  const list = []
  ;(Array.isArray(shipments) ? shipments : []).forEach((s) => {
    const lg = (s && s.logistics) || {}
    const no = String(lg.trackingNumber || '').trim()
    if (!no) return
    list.push({
      carrier: String(lg.carrier || '').trim() || '承运商未填',
      trackingNo: no,
      shipTime: num(lg.shipTime) || num(s.updatedAt) || null,
      shipmentNo: String(s.shipmentNo || ''),
      source: 'shipment'
    })
  })
  const no = String((po && po.logisticsTracking) || '').trim()
  if (no && !list.some((x) => x.trackingNo === no)) {
    list.push({
      carrier: String(po.logisticsCarrier || '').trim() || '承运商未填',
      trackingNo: no,
      shipTime: num(po.shippedAt),
      shipmentNo: '',
      source: 'supplier'
    })
  }
  return list
}

const CHANNEL_LABEL = { wechat_jsapi: '微信支付', offline: '对公转账', preview_mark: '验收标记' }

/**
 * 时间线：下单 → 付款 → 确认 → 发货 → 签收 → 结算；退款 / 取消为终态节点。
 * state: done | current | todo | warn | na
 */
function buildTimeline(po, shipments, nowMs) {
  const nodes = []
  const supplier = isSupplierOrder(po)
  const st = String(po.status || '')
  const bucket = payBucketOf(po)
  const push = (key, title, state, at, note) => nodes.push({ key, title, state, at: at || null, timeText: fmtTime(at), note: note || '' })

  push('placed', supplier ? '需求下达' : '下单', 'done', orderTime(po), po.orderNo ? `单号 ${po.orderNo}` : '')

  if (supplier) {
    push('pay', '总部付款', 'na', null, '总部付款暂未在系统里登记')
  } else {
    const trades = Array.isArray(po.payTrades) ? po.payTrades.length : 0
    const tradeNote = trades > 1 ? `共发起 ${trades} 次支付` : ''
    const txn = po.transactionId ? `微信单号尾号 ${tailOf(po.transactionId, 6)}` : ''
    const ch = CHANNEL_LABEL[String(po.paymentChannel || '')] || ''
    if (bucket === 'received' || bucket === 'refunded') {
      push('pay', '已付款', 'done', num(po.paidAt), [ch, yuanText(receivedFenOf(po)), txn, tradeNote].filter(Boolean).join(' · '))
    } else if (bucket === 'marked') {
      push('pay', '验收标记已付', 'warn', num(po.paidAt), '非真实收款（超管验收旁路）')
    } else if (bucket === 'offline') {
      push('pay', '对公待确认', 'current', null, '采购商已登记对公，待财务在 ERP 确认到账')
    } else if (bucket === 'review') {
      const a = po.payAnomaly || {}
      push('pay', '金额待核对', 'warn', num(a.at), a.code === 'AMOUNT_MISMATCH' ? `微信实收 ${yuanText(a.paidFen)} ≠ 应收 ${yuanText(a.expectedFen)}` : '支付异常待总部核对')
    } else if (isClosedStatus(st)) {
      push('pay', '未付款', 'na', null, '')
    } else {
      push('pay', String(po.paymentStatus) === 'pending' ? '支付中' : '待付款', 'current', null, tradeNote || (po.pricingMode === 'quote_required' ? '含区间价 / 议价，需总部报价' : ''))
    }
  }

  const confirmedAt = num(po.confirmedAt)
  const stage = fulfilStageOf(po)
  const afterConfirm = ['toShip', 'transit', 'received'].indexOf(stage) !== -1
  push('confirm', supplier ? '供货方确认' : '总部确认', confirmedAt || afterConfirm ? 'done' : stage === 'cancelled' ? 'na' : 'todo', confirmedAt, '')

  const lg = logisticsOf(po, shipments)
  const shippedAt = num(po.shippedAt) || (lg[0] && lg[0].shipTime) || null
  const shipped = stage === 'transit' || stage === 'received'
  push(
    'ship',
    '发货',
    shipped ? 'done' : stage === 'toShip' ? 'current' : stage === 'cancelled' ? 'na' : 'todo',
    shippedAt,
    lg.map((x) => `${x.carrier} ${x.trackingNo}`).join('；')
  )
  push('receive', '签收', stage === 'received' ? 'done' : stage === 'transit' ? 'current' : stage === 'cancelled' ? 'na' : 'todo', num(po.receivedAt), '')

  if (supplier) {
    push('settle', '结算', 'na', null, '暂未在系统里登记')
  } else {
    const settled = bucket === 'received' && stage === 'received'
    push('settle', '结算', settled ? 'done' : isClosedStatus(st) || bucket === 'refunded' ? 'na' : 'todo', null, settled ? '货款已收、货已签收' : '')
  }

  if (bucket === 'refunded') {
    const r = po.refund || {}
    push('refund', '已退款', 'warn', num(po.refundedAt) || num(r.refundedAt), r.reason ? `原因：${String(r.reason).slice(0, 60)}` : '')
  } else if (po.refund && po.refund.status === 'refunding') {
    push('refund', '退款中', 'current', num(po.refund.requestedAt), '已向微信发起退款，等待到账')
  } else if (po.refund && po.refund.status === 'failed') {
    push('refund', '退款失败', 'warn', num(po.refund.failedAt), '待总部在 ERP 重试')
  }
  if (st === 'cancelled') push('cancel', '已取消', 'warn', num(po.cancelledAt) || num(po.updatedAt), '')
  return nodes
}

function itemsSummary(po) {
  const items = Array.isArray(po && po.items) ? po.items : []
  const qty = items.reduce((s, it) => s + (parseInt(it && it.quantity, 10) || 0), 0)
  const first = items[0] || {}
  const title = first.name ? (items.length > 1 ? `${first.name} 等 ${items.length} 款` : first.name) : '（无明细）'
  return { title, qty, lines: items.length }
}

/** 列表行（只读视图） */
function orderRow(po, ctx, nowMs) {
  const names = (ctx && ctx.names) || {}
  const key = partnerKeyOf(po)
  const aging = agingOf(po, nowMs)
  const bucket = payBucketOf(po)
  const stage = fulfilStageOf(po)
  const sum = itemsSummary(po)
  const lg = logisticsOf(po, ctx && ctx.shipmentsByPo ? ctx.shipmentsByPo[po._id] : [])
  return {
    _id: po._id,
    orderNo: po.orderNo || '',
    direction: isSupplierOrder(po) ? 'supplier' : isBuyerOrder(po) ? 'buyer' : 'other',
    directionLabel: isSupplierOrder(po) ? '总部→供货方' : isBuyerOrder(po) ? '采购商→总部' : '门店订货',
    partnerKey: key,
    partnerName: names[key] || po.company || po.storeName || po.contactName || '未命名伙伴',
    title: sum.title,
    qty: sum.qty,
    amountFen: amountFenOf(po),
    amountText: amountFenOf(po) ? yuanText(amountFenOf(po)) : '待报价',
    status: String(po.status || ''),
    statusLabel: PO_STATUS_LABEL[po.status] || po.status || '—',
    stage,
    stageLabel: STAGE_LABEL[stage],
    payBucket: bucket,
    payLabel: PAY_BUCKET_LABEL[bucket],
    agingDays: aging.days,
    agingOpen: aging.open,
    overdue: aging.overdue,
    trackingNo: lg[0] ? lg[0].trackingNo : '',
    carrier: lg[0] ? lg[0].carrier : '',
    orderTime: orderTime(po),
    dateText: bizDateKey(orderTime(po))
  }
}

/** 列表筛选（全部在内存里做：B2B 单量小，读取上限见 index.js MAX_SCAN） */
function filterOrders(rows, f, nowMs) {
  const q = f || {}
  const kw = String(q.keyword || '').trim().toLowerCase()
  const range = resolveRange({ startDate: q.startDate, endDate: q.endDate, range: q.range }, nowMs)
  return rows.filter((po) => {
    if (q.scope !== 'all' && !isDeskOrder(po)) return false
    if (q.direction === 'buyer' && !isBuyerOrder(po)) return false
    if (q.direction === 'supplier' && !isSupplierOrder(po)) return false
    if (q.partner && partnerKeyOf(po) !== q.partner) return false
    if (!inRange(po, range)) return false
    if (q.stage && fulfilStageOf(po) !== q.stage) return false
    if (q.pay === 'overdue') {
      if (!agingOf(po, nowMs).overdue) return false
    } else if (q.pay && payBucketOf(po) !== q.pay) return false
    if (kw) {
      const hay = [po.orderNo, po.storeName, po.company, po.contactName]
        .concat((Array.isArray(po.items) ? po.items : []).map((it) => `${it && it.name} ${it && it.skuId}`))
        .join(' ')
        .toLowerCase()
      if (hay.indexOf(kw) === -1) return false
    }
    return true
  })
}

/** 大盘 */
function buildDashboard(orders, opts, nowMs) {
  const o = opts || {}
  const range = resolveRange(o, nowMs)
  const names = o.names || {}
  const list = (Array.isArray(orders) ? orders : []).filter((po) => {
    if (o.scope !== 'all' && !isDeskOrder(po)) return false
    if (o.partner && partnerKeyOf(po) !== o.partner) return false
    return inRange(po, range)
  })
  const out = {
    range: { key: range.key, label: range.label, startDate: range.startDate, endDate: range.endDate },
    orders: { count: 0, amountFen: 0, pendingConfirm: 0, toShip: 0, transit: 0, received: 0, cancelled: 0 },
    money: { receivedFen: 0, markedFen: 0, dueFen: 0, offlineFen: 0, reviewFen: 0, refundedFen: 0, overdueCount: 0, overdueFen: 0 },
    counts: { due: 0, offline: 0, review: 0, received: 0, refunded: 0, marked: 0 },
    aging: { '0-7': 0, '8-30': 0, '30+': 0 },
    payable: { count: 0, amountFen: 0, note: '总部给供货方的付款暂未在系统里登记，这里只算应付' },
    byPartner: [],
    payTermDays: PAY_TERM_DAYS
  }
  const partners = {}
  list.forEach((po) => {
    const stage = fulfilStageOf(po)
    if (stage === 'cancelled') {
      out.orders.cancelled += 1
      return
    }
    if (stage === 'draft') return
    const fen = amountFenOf(po)
    out.orders.count += 1
    out.orders.amountFen += fen
    if (stage === 'pendingConfirm') out.orders.pendingConfirm += 1
    else if (stage === 'toShip') out.orders.toShip += 1
    else if (stage === 'transit') out.orders.transit += 1
    else if (stage === 'received') out.orders.received += 1

    const key = partnerKeyOf(po)
    const p = partners[key] || (partners[key] = {
      key,
      name: names[key] || po.company || po.storeName || po.contactName || '未命名伙伴',
      kind: isSupplierOrder(po) ? 'supplier' : isBuyerOrder(po) ? 'buyer' : 'other',
      count: 0,
      amountFen: 0,
      dueFen: 0
    })
    p.count += 1
    p.amountFen += fen

    if (isSupplierOrder(po)) {
      if (stage === 'transit' || stage === 'received') {
        out.payable.count += 1
        out.payable.amountFen += fen
      }
      return
    }
    const bucket = payBucketOf(po)
    if (bucket === 'na') return
    if (bucket === 'received') {
      out.money.receivedFen += receivedFenOf(po)
      out.counts.received += 1
    } else if (bucket === 'marked') {
      out.money.markedFen += fen
      out.counts.marked += 1
    } else if (bucket === 'refunded') {
      out.money.refundedFen += receivedFenOf(po)
      out.counts.refunded += 1
    } else {
      if (bucket === 'due') {
        out.money.dueFen += fen
        out.counts.due += 1
      } else if (bucket === 'offline') {
        out.money.offlineFen += fen
        out.counts.offline += 1
      } else if (bucket === 'review') {
        out.money.reviewFen += fen
        out.counts.review += 1
      }
      p.dueFen += fen
      const ag = agingOf(po, nowMs)
      if (ag.open) {
        out.aging[ag.band] += 1
        if (ag.overdue) {
          out.money.overdueCount += 1
          out.money.overdueFen += fen
        }
      }
    }
  })
  out.byPartner = Object.keys(partners)
    .map((k) => partners[k])
    .sort((a, b) => b.amountFen - a.amountFen || b.count - a.count)
    .slice(0, 10)
  return out
}

/* ───────────── 功能项 ───────────── */

function featureDefaults() {
  const out = {}
  DESK_FEATURES.forEach((f) => { out[f.key] = f.def })
  return out
}

/** 存量行（无 b2bDesk）= 默认值；只接受目录内的布尔键 */
function normalizeFeatures(raw) {
  const out = featureDefaults()
  const src = raw && typeof raw === 'object' ? raw : {}
  DESK_FEATURES.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(src, f.key)) out[f.key] = src[f.key] === true
  })
  return out
}

function rolesOfRow(row) {
  const list = Array.isArray(row && row.roles) && row.roles.length ? row.roles : [row && row.role]
  return list.map((r) => String(r || '').trim()).filter(Boolean)
}

function isB2bOnlyRoles(roles) {
  const list = Array.isArray(roles) ? roles : []
  return list.length > 0 && list.every((r) => B2B_ROLES.indexOf(r) !== -1)
}

function deskSidesOf(roles) {
  const list = Array.isArray(roles) ? roles : []
  return {
    buyer: list.some((r) => BUYER_ROLES.indexOf(r) !== -1),
    supplier: list.indexOf('supplier') !== -1
  }
}

/* ───────────── 价目 ───────────── */

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200)
}

/** 价格：单一价 >0 / 区间价 0<min≤max / null（议价）；其它一律报错 */
function normalizePrice(raw, label) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw === 'object') {
    const a = Number(raw.min)
    const b = Number(raw.max)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < a) {
      return { ok: false, msg: `${label}区间不合法（需 0 < 最低 ≤ 最高）` }
    }
    if (a === b) return { ok: true, value: Math.round(a * 100) / 100 }
    return { ok: true, value: { min: Math.round(a * 100) / 100, max: Math.round(b * 100) / 100 } }
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: `${label}需为大于 0 的数字` }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

function validatePriceItem(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}
  const errors = []
  const skuId = str(d.skuId, 64)
  if (!SKU_RE.test(skuId)) errors.push({ field: 'skuId', msg: '货号需 2–64 位字母、数字、- 或 _' })
  const name = str(d.name, 60)
  if (!name) errors.push({ field: 'name', msg: '请填写品名' })
  const species = str(d.species, 60)
  if (!species) errors.push({ field: 'species', msg: '请填写物种' })
  const packaging = str(d.packaging, 60)
  if (!packaging) errors.push({ field: 'packaging', msg: '请填写包装文案' })
  const price = normalizePrice(d.price, '供货价')
  if (!price.ok) errors.push({ field: 'price', msg: price.msg })
  const guide = normalizePrice(d.guidePrice, '指导价')
  if (!guide.ok) errors.push({ field: 'guidePrice', msg: guide.msg })
  const prepMethod = PREP_METHODS.indexOf(d.prepMethod) !== -1 ? d.prepMethod : '干制'
  const packagingFilter = PACKAGING_FILTERS.indexOf(d.packagingFilter) !== -1 ? d.packagingFilter : '其它标本'
  const bioFilter = BIO_FILTERS.indexOf(d.bioFilter) !== -1 ? d.bioFilter : '昆虫'
  const sortN = parseInt(d.sort, 10)
  const status = d.status === 'inactive' ? 'inactive' : 'active'
  // 图片只在入参显式带了才写（小程序只在上传 / 移除后才送）；新写入的必须是云存储文件，库里的官网相对路径不受影响
  const hasImage = d.image !== undefined
  const image = hasImage ? String(d.image == null ? '' : d.image).trim() : ''
  if (hasImage && image && !isCloudFileId(image)) errors.push({ field: 'image', msg: '图片请用「上传图片」添加' })
  if (errors.length) return { ok: false, errors }
  const data = {
    skuId,
    name,
    species,
    prepMethod,
    packaging,
    packagingFilter,
    bioFilter,
    price: price.value,
    guidePrice: guide.value,
    specs: str(d.specs, 200),
    note: str(d.note, 300),
    imageAlt: str(d.imageAlt, 60) || name,
    status
  }
  if (hasImage) data.image = image
  if (Number.isFinite(sortN)) data.sort = sortN
  return { ok: true, data }
}

const IMAGE_FILE_ID_RE = /^cloud:\/\/\S+$/
const IMAGE_FILE_ID_MAX = 512
const PARTNER_LICENSE_MAX = 3

function isCloudFileId(v) {
  return typeof v === 'string' && v.length <= IMAGE_FILE_ID_MAX && IMAGE_FILE_ID_RE.test(v)
}

/** 换主图时保留图集里其余的图（ERP 维护的多图不被小程序换封面冲掉）；移除主图 = 清空 */
function nextImages(oldImage, oldImages, image) {
  if (!image) return []
  const rest = (Array.isArray(oldImages) ? oldImages : []).filter((u) => u && u !== oldImage && u !== image)
  return [image].concat(rest)
}

const GALLERY_MAX = 9

/**
 * 价目多图（与 ERP normalizeImageFields / 官网 priceListCloud 同约定：images[0] 即封面，image = images[0]）。
 * 新增元素只收 cloud://；库里原有的地址（官网相对路径 / https）允许原样保留。
 * @param {unknown} raw 入参 images
 * @param {string[]} existing 该条目库里现有的 image + images
 */
function validateGallery(raw, existing) {
  if (!Array.isArray(raw)) return { ok: false, msg: '图片格式不对，请重新上传' }
  const keep = new Set((existing || []).map((u) => String(u == null ? '' : u).trim()).filter(Boolean))
  const list = []
  for (const x of raw) {
    const u = String(x == null ? '' : x).trim()
    if (!u || list.indexOf(u) !== -1) continue
    if (!isCloudFileId(u) && !keep.has(u)) return { ok: false, msg: '新图片请用「上传图片」添加' }
    list.push(u)
  }
  if (list.length > GALLERY_MAX) return { ok: false, msg: `商品图最多 ${GALLERY_MAX} 张` }
  return { ok: true, images: list, image: list[0] || '' }
}

/** 伙伴资料图：logo（门头 / 标志）与资质照；只收显式带了的键，其它键原样不动 */
function validatePartnerProfile(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}
  const patch = {}
  if (d.logo !== undefined) {
    const logo = String(d.logo == null ? '' : d.logo).trim()
    if (logo && !isCloudFileId(logo)) return { ok: false, msg: '门头 / 标志图请用「上传」添加' }
    patch.logo = logo
  }
  if (d.licenses !== undefined) {
    if (!Array.isArray(d.licenses)) return { ok: false, msg: '资质照格式不对，请重新上传' }
    const list = d.licenses.map((x) => String(x == null ? '' : x).trim()).filter(Boolean)
    if (list.length > PARTNER_LICENSE_MAX) return { ok: false, msg: `资质照最多 ${PARTNER_LICENSE_MAX} 张` }
    if (!list.every(isCloudFileId)) return { ok: false, msg: '资质照请用「上传」添加' }
    patch.licenses = list
  }
  if (!Object.keys(patch).length) return { ok: false, msg: '没有要保存的图片' }
  return { ok: true, patch }
}

function priceText(p) {
  if (p === null || p === undefined || p === '') return '议价'
  if (typeof p === 'object') return `¥${p.min}–${p.max}`
  return `¥${p}`
}

/** 删除决策：被任何单据引用 → 停用；否则可硬删（同出货中心 priceBook.removeIfUnused） */
function removalPlan(refCount) {
  const n = Math.max(0, parseInt(refCount, 10) || 0)
  return n > 0 ? { mode: 'retire', refCount: n } : { mode: 'remove', refCount: 0 }
}

/** 相邻交换排序：返回需要写回的 [{ _id, sort }] */
function planMove(sortedRows, id, direction) {
  const rows = (Array.isArray(sortedRows) ? sortedRows : []).map((r, i) => ({ _id: r._id, sort: Number.isFinite(Number(r.sort)) ? Number(r.sort) : null, idx: i }))
  const i = rows.findIndex((r) => r._id === id)
  if (i < 0) return { ok: false, msg: '条目不存在' }
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= rows.length) return { ok: true, writes: [], msg: direction === 'up' ? '已在最前' : '已在最后' }
  const dense = rows.every((r, k) => r.sort === k + 1)
  const writes = []
  if (!dense) {
    rows.forEach((r, k) => {
      const want = k === i ? j + 1 : k === j ? i + 1 : k + 1
      if (r.sort !== want) writes.push({ _id: r._id, sort: want })
    })
  } else {
    writes.push({ _id: rows[i]._id, sort: j + 1 }, { _id: rows[j]._id, sort: i + 1 })
  }
  return { ok: true, writes }
}

module.exports = {
  PAY_TERM_DAYS,
  SOURCE_BUYER,
  PARTY_SUPPLIER,
  B2B_ROLES,
  BUYER_ROLES,
  DESK_FEATURES,
  PO_STATUS_LABEL,
  PAY_BUCKET_LABEL,
  STAGE_LABEL,
  PREP_METHODS,
  PACKAGING_FILTERS,
  BIO_FILTERS,
  bizDateKey,
  addDays,
  dayBounds,
  dayDiff,
  resolveRange,
  isSupplierOrder,
  isBuyerOrder,
  isDeskOrder,
  buyerOpenidOf,
  partnerKeyOf,
  amountFenOf,
  receivedFenOf,
  payBucketOf,
  fulfilStageOf,
  agingOf,
  yuanText,
  fmtTime,
  logisticsOf,
  buildTimeline,
  orderRow,
  filterOrders,
  buildDashboard,
  featureDefaults,
  normalizeFeatures,
  rolesOfRow,
  isB2bOnlyRoles,
  deskSidesOf,
  validatePriceItem,
  normalizePrice,
  priceText,
  removalPlan,
  planMove,
  isCloudFileId,
  nextImages,
  validatePartnerProfile,
  PARTNER_LICENSE_MAX,
  validateGallery,
  GALLERY_MAX
}
