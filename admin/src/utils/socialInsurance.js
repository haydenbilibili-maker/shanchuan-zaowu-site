/**
 * 社保扣缴标准（工资条明细改造，2026-10-10 产品负责人点名）
 *
 * 口径：
 *   1. 金额取自社保缴费记录（多人合计），每人金额 = 合计 ÷ headcount（按分取整）；
 *   2. 工伤保险按政策个人不扣，只由公司缴纳（companyOnly，个人部分恒为 0）；
 *   3. 「公司为你缴纳」只做展示，不进工资条扣款、不影响实发；
 *   4. cycle=year 的品目（大额医疗互助）全年只扣一次；periodOffset 为相对「社保缴费月」的所属期偏移。
 *
 * 新增 / 调整标准：在 SI_STANDARDS 追加一条（effectiveFrom 递增），不要改已用过的条目 ——
 * 工资条保存的是计算快照，旧条目改了不会回写，但会让「同一标准」两次算出不同结果。
 *
 * 真源：miniprogram/cloudfunctions/manageStaffWorkspace/socialInsurance.js（CJS）；本文件是 ERP 的 ESM 副本，
 * 必须保持 ESM（错题本 E31），由 test:payslip-social-insurance 逐项比对一致。
 */
export const SI_STANDARDS = [
  {
    id: 'si-2026-09',
    label: '2026 年社保（2026-09-03 三方协议缴费）',
    effectiveFrom: '2026-09',
    headcount: 2,
    source: '2026-09-03 社保缴费记录，两人合计',
    lines: [
      { key: 'pension', item: '企业职工基本养老保险费', name: '养老保险', personalTotal: 702.92, companyTotal: 1054.36, cycle: 'month', periodOffset: 0 },
      { key: 'medical', item: '基本医疗保险费', name: '医疗保险', personalTotal: 175.72, companyTotal: 676.56, cycle: 'month', periodOffset: 1 },
      { key: 'medicalMutual', item: '基本医疗保险费', name: '大额医疗互助', personalTotal: 200, companyTotal: 0, cycle: 'year', periodOffset: 0 },
      { key: 'unemployment', item: '失业保险费', name: '失业保险', personalTotal: 26.36, companyTotal: 61.5, cycle: 'month', periodOffset: 0 },
      { key: 'injury', item: '工伤保险费', name: '工伤保险', personalTotal: 0, companyTotal: 28.12, cycle: 'month', periodOffset: 0, companyOnly: true }
    ]
  }
]

export const SI_NOTE_SPLIT = '个人与公司金额均按缴费记录合计 ÷ 参保人数计'
export const SI_NOTE_INJURY = '工伤保险按政策由公司全额缴纳，个人不扣'

const YM_RE = /^\d{4}-\d{2}$/

function toCents(n) {
  return Math.round((Number(n) || 0) * 100)
}

export function perHead(total, headcount) {
  const hc = Math.max(1, Math.floor(Number(headcount) || 1))
  return Math.round(toCents(total) / hc) / 100
}

export function addMonths(ym, offset) {
  const [y, m] = String(ym).split('-').map(Number)
  const idx = y * 12 + (m - 1) + (Number(offset) || 0)
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function validateStandard(std) {
  const errors = []
  if (!std || !std.id) return ['标准缺少 id']
  if (!(Number(std.headcount) >= 1)) errors.push(`${std.id}：参保人数须 ≥ 1`)
  if (!YM_RE.test(String(std.effectiveFrom || ''))) errors.push(`${std.id}：起用月份须为 YYYY-MM`)
  const lines = Array.isArray(std.lines) ? std.lines : []
  if (!lines.length) errors.push(`${std.id}：没有品目`)
  lines.forEach((l) => {
    if (!l || !l.key || !l.name) errors.push(`${std.id}：品目缺少 key / name`)
    else if (l.key === 'injury' && !l.companyOnly) errors.push(`${std.id}：工伤保险必须标记为仅公司缴纳`)
    else if (l.companyOnly && toCents(l.personalTotal) !== 0) errors.push(`${std.id}：${l.name} 仅公司缴纳，个人部分必须为 0`)
    if (l && (toCents(l.personalTotal) < 0 || toCents(l.companyTotal) < 0)) errors.push(`${std.id}：${l.name} 金额不能为负`)
  })
  return errors
}

export function listStandards() {
  return SI_STANDARDS.map((s) => ({ id: s.id, label: s.label, effectiveFrom: s.effectiveFrom, headcount: s.headcount, source: s.source }))
}

export function findStandard(id) {
  return SI_STANDARDS.find((s) => s.id === String(id || '').trim()) || null
}

/** 缴费月对应的默认标准：effectiveFrom ≤ 缴费月 中最新的一条 */
export function standardForMonth(paidMonth) {
  const ym = String(paidMonth || '')
  const hits = SI_STANDARDS.filter((s) => s.effectiveFrom <= ym).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  return hits[0] || null
}

/** 工资条月份 → 默认社保缴费月（上一个月：本月发的工资扣上月缴的社保） */
export function defaultPaidMonth(payslipMonth) {
  return YM_RE.test(String(payslipMonth || '')) ? addMonths(payslipMonth, -1) : ''
}

/**
 * 计算一人一份工资条的社保快照。
 * @param {{ standardId: string, paidMonth: string, includeAnnual?: boolean }} input
 * @returns {{ ok: true, snapshot: object } | { ok: false, msg: string }}
 */
export function computeSocialInsurance(input) {
  const std = findStandard(input && input.standardId)
  if (!std) return { ok: false, msg: '未找到社保扣缴标准' }
  const errors = validateStandard(std)
  if (errors.length) return { ok: false, msg: errors[0] }
  const paidMonth = String((input && input.paidMonth) || '').trim()
  if (!YM_RE.test(paidMonth)) return { ok: false, msg: '社保缴费月须为 YYYY-MM' }
  if (paidMonth < std.effectiveFrom) return { ok: false, msg: `该标准 ${std.effectiveFrom} 起用，早于此月不可套用` }
  const includeAnnual = !!(input && input.includeAnnual)
  const year = paidMonth.slice(0, 4)
  const personal = []
  const company = []
  let annualIncluded = false
  std.lines.forEach((l) => {
    const isYear = l.cycle === 'year'
    if (isYear && !includeAnnual) return
    const period = isYear ? `${year} 全年` : addMonths(paidMonth, l.periodOffset)
    const base = { key: l.key, name: l.name, period }
    const p = l.companyOnly ? 0 : perHead(l.personalTotal, std.headcount)
    const c = perHead(l.companyTotal, std.headcount)
    if (p > 0) {
      personal.push({ ...base, amount: p })
      if (isYear) annualIncluded = true
    }
    if (c > 0) company.push({ ...base, amount: c })
  })
  const sum = (rows) => Math.round(rows.reduce((s, r) => s + toCents(r.amount), 0)) / 100
  return {
    ok: true,
    snapshot: {
      standardId: std.id,
      label: std.label,
      headcount: std.headcount,
      paidMonth,
      annualYear: year,
      annualIncluded,
      personal,
      company,
      personalTotal: sum(personal),
      companyTotal: sum(company),
      notes: [SI_NOTE_SPLIT, SI_NOTE_INJURY]
    }
  }
}
