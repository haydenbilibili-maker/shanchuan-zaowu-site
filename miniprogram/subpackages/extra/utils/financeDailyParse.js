/**
 * 门店日报粘贴解析（与 Admin financeDailyParse 对齐）
 * 「现金：xxx元」= 在手现金余额 cashBalance，不计入当日营收。
 * 「N月合计」是门店自报的月累计，只用于核对，不是当日营收。
 * 金额/订单只从表头取：分隔线或首个编号明细行（1.蓝闪蝶 / 🦋…）以下是商品明细，不参与识别。
 */

const SEPARATOR_LINE = /^\s*[—–\-－=＝_＿─━~～·•.。]{3,}\s*$/
const DETAIL_START_LINE = /^\s*(?:\d{1,2}\s*[.．、]\s*[^\d\s]|🦋)/

function normalizeDailyReportText(text) {
  return String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/，(?=\d{3}(?!\d))/g, ',')
    .replace(/\u3000/g, ' ')
}

function splitDailyReportHeader(text) {
  const lines = String(text || '').split(/\r?\n/)
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (SEPARATOR_LINE.test(lines[i]) || DETAIL_START_LINE.test(lines[i])) {
      cut = i
      break
    }
  }
  return {
    header: lines.slice(0, cut).join('\n'),
    detail: lines.slice(cut).join('\n'),
  }
}

function parseDailyFinanceText(text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return { ok: false, error: '请粘贴日报内容（含日期与银联 POS 收款）' }
  }

  const head = splitDailyReportHeader(normalizeDailyReportText(raw)).header

  const amountAfter = (labels) => {
    const key = labels.join('|')
    // 先匹配完整数字（含千分位），避免 1743.3 被 [0-9]{1,3} 截成 174
    const re = new RegExp(
      `(?:${key})\\s*[:：]?\\s*[¥￥]?\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?)\\s*元?`,
      'i',
    )
    const m = head.match(re)
    if (!m) return null
    const n = parseFloat(String(m[1]).replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }

  const dateMatch = head.match(
    /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/,
  )
  let date = null
  if (dateMatch) {
    date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
  } else {
    const short = head.match(/(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/)
    if (short) {
      const y = new Date().getFullYear()
      date = `${y}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`
    }
  }

  let pos = amountAfter(['银联POS收款', '银联\\s*POS\\s*收款', 'POS收款', '银联收款'])
  if (pos == null) pos = amountAfter(['银联POS', 'POS', '刷卡'])

  const online = amountAfter(['线上', 'ONLINE'])
  const refund = amountAfter(['退款', 'REFUND'])
  const cashBalance = amountAfter(['现金余额', '在手现金', '现存现金', '现金', 'CASH'])
  const monthTotal = amountAfter(['(?:本月|当月|\\d{1,2}\\s*月)\\s*合计', '月合计'])

  let orderCount = null
  const oc =
    head.match(/订单数\s*[:：]?\s*(\d+)/i) ||
    head.match(/订单\s*[:：]?\s*(\d+)\s*(?:单|笔)?/i)
  if (oc) {
    const n = parseInt(oc[1], 10)
    if (Number.isFinite(n) && n >= 0) orderCount = n
  }

  const headLines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
  let storeNameHint = ''
  for (const line of headLines) {
    if (/^\d{4}/.test(line) || /收款|订单|线上|退款|现金|合计/.test(line)) continue
    if (/山川造物|山海造物|星宸|这有山/.test(line) || /^[\u4e00-\u9fa5A-Za-z0-9·\s]{2,24}$/.test(line)) {
      storeNameHint = line.replace(/\s+/g, ' ').trim()
      break
    }
  }

  if (!date) {
    return {
      ok: false,
      error: '未能识别日期。请包含如「2026年 9月10日」',
      storeNameHint: storeNameHint || undefined,
    }
  }
  if (pos == null) {
    return {
      ok: false,
      error: '未能识别银联 POS 收款。请包含如「银联POS收款：1743.3元」',
      date,
      storeNameHint: storeNameHint || undefined,
    }
  }

  const onlineN = online != null ? online : 0
  const refundN = refund != null ? refund : 0
  // 门店净额仍可含历史「线上」字段；展示「线上」条只用小程序 GMV
  const revenue = Math.max(0, pos + onlineN - refundN)

  return {
    ok: true,
    date,
    pos,
    online: onlineN,
    refund: refundN,
    cashBalance: cashBalance != null ? cashBalance : null,
    cash: 0,
    cashIncome: 0,
    orderCount,
    monthTotal: monthTotal != null ? monthTotal : null,
    storeNameHint: storeNameHint || undefined,
    revenue,
    /** 解析到日报「线上」时提示：计入账本 online（门店净额），不作为 UI「线上」条 */
    legacyOnlineWarning:
      onlineN > 0
        ? '识别到日报「线上」金额将写入账本 online（计入门店净额）。看板「线上」条仅统计小程序已付 GMV，请勿把小程序成交填进此项。'
        : '',
  }
}

/**
 * 渠道净额：POS + 线上 + 遗留现金收入 − 退款；在手现金不计入。
 * 有 cashBalance 时，cash 不再当收入（除非显式 cashIncome）。
 */
function rowNetFromChannels(record) {
  const pos = Number(record?.pos) || 0
  const online = Number(record?.online) || 0
  const refund = Number(record?.refundAmount ?? record?.refund) || 0
  const hasBalance =
    record?.cashBalance != null &&
    record?.cashBalance !== '' &&
    Number.isFinite(Number(record.cashBalance))
  const cashIncome = hasBalance
    ? Number(record?.cashIncome) || 0
    : Number(record?.cashIncome ?? record?.cash) || 0
  if (pos || online || cashIncome || refund) {
    return Math.max(0, pos + online + cashIncome - refund)
  }
  return Number(record?.netAmount ?? record?.revenue ?? record?.total) || 0
}

/** 店名提示 → canonical storeId */
function matchStoreIdFromHint(hint) {
  const h = String(hint || '')
  if (/星宸/.test(h)) return 'store_xingchen'
  if (/山川造物|山海造物|这有山/.test(h)) return 'store_shanhaizaowu'
  return ''
}

module.exports = {
  parseDailyFinanceText,
  rowNetFromChannels,
  matchStoreIdFromHint,
}
