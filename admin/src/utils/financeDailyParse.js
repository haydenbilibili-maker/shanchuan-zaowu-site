/**
 * 门店日报粘贴解析（Admin「智能日报」/ 店长「记一笔」对齐）
 *
 * 现金语义（2026-09）：
 *   「现金：xxx元」= 门店在手现金余额（cashBalance），不是当日现金收入。
 *   当日营收 NET = POS + 线上 − 退款（不含 cashBalance）。
 *   「N月合计」是门店自报的月累计，只用于核对，不是当日营收。
 *
 * 金额/订单只从**表头**取：分隔线（——— / --- / ===）或首个编号明细行（1.蓝闪蝶 / 🦋…）
 * 以下是商品明细（件数），不得参与任何金额/订单识别。
 */

const SEPARATOR_LINE = /^\s*[—–\-－=＝_＿─━~～·•.。]{3,}\s*$/
const DETAIL_START_LINE = /^\s*(?:\d{1,2}\s*[.．、]\s*[^\d\s]|🦋)/

/** 全角数字/小数点/冒号/空格折半角，便于统一匹配 */
export function normalizeDailyReportText(text) {
  return String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/，(?=\d{3}(?!\d))/g, ',')
    .replace(/\u3000/g, ' ')
}

/** 切出日报表头（分隔线 / 首个明细行之前）；返回 { header, detail } */
export function splitDailyReportHeader(text) {
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

/**
 * @param {string} text
 * @returns {{
 *   ok: boolean,
 *   error?: string,
 *   date?: string,
 *   pos?: number|null,
 *   online?: number|null,
 *   refund?: number|null,
 *   cashBalance?: number|null,
 *   orderCount?: number|null,
 *   monthTotal?: number|null,
 *   storeNameHint?: string,
 *   revenue?: number|null,
 * }}
 */
export function parseDailyFinanceText(text) {
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
  // 在手现金余额（非当日现金流水）
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
      error: '未能识别日期。请包含如「2026年 9月10日」或「2026-09-10」',
      storeNameHint: storeNameHint || undefined,
    }
  }
  if (pos == null) {
    return {
      ok: false,
      error: '未能识别银联 POS 收款。请包含如「银联POS收款:1743.3元」',
      date,
      storeNameHint: storeNameHint || undefined,
    }
  }
  if (pos < 0) {
    return { ok: false, error: 'POS 收款金额无效', date }
  }

  const dateObj = new Date(date)
  if (Number.isNaN(dateObj.getTime())) {
    return { ok: false, error: '日期格式无效，请检查年月日', date }
  }

  const onlineN = online != null ? online : 0
  const refundN = refund != null ? refund : 0
  // 营收不含在手现金
  const revenue = Math.max(0, pos + onlineN - refundN)

  return {
    ok: true,
    date,
    pos,
    online: online != null ? online : null,
    refund: refund != null ? refund : null,
    cashBalance: cashBalance != null ? cashBalance : null,
    orderCount,
    monthTotal: monthTotal != null ? monthTotal : null,
    storeNameHint: storeNameHint || undefined,
    revenue,
  }
}

/**
 * 渠道净额：POS + 线上 + 遗留「现金收入」− 退款；在手现金不计入。
 * 兼容旧数据：无 cashBalance 时，cash 仍按当日现金收入计。
 */
export function rowNetFromChannels(record) {
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
