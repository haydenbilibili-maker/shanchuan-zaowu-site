/**
 * 社保扣缴标准（工资条明细，产品负责人 2026-10-10 点名；同日第 2 轮口径）
 *
 * 口径：
 *   1. 金额取自社保缴费记录（SI_RECORDS），记录是多人合计：每人金额 = 合计 ÷ splitHeadcount（按分取整）。
 *      splitHeadcount 只用于把这份记录折算成每人金额，**不是参保人数上限** —— 任何参保员工都按同一每人金额扣
 *      （2026-09-03 记录为 2 人合计；第三位员工另有缴费记录未提供，按同一每人金额扣）。
 *   2. 按「所属期 = 工资条月份」分到各自的工资条：9 月工资条只扣所属期 9 月的品目，医疗所属 10 月就进 10 月工资条。
 *      某月没有该品目的缴费记录 → 沿用最近一期同品目金额，并标「参考上期」；之前也没有 → 不扣，列为提示。
 *   3. 工伤保险按政策个人不扣，只由公司缴纳；公司缴纳部分只展示，不进扣款、不影响实发。
 *   4. 年度品目（大额医疗互助）一年只扣一次；系统外已扣的年度写进 SI_EXTERNAL_CHARGES，工资条上注明、不再扣。
 *   5. 同一员工、同一品目、同一所属期只扣一次：之前工资条（含「预扣」）扣过的，本张列为提示、不再扣。
 *
 * 新缴费记录 / 金额调整：在 SI_RECORDS 追加一条（不要改已用过的记录）；ERP 副本同步改。
 * ESM 副本：真源为 miniprogram/cloudfunctions/manageStaffWorkspace/socialInsurance.js（CJS），由 test:payslip-social-insurance 逐项比对一致。
 */
export const SI_ITEMS = [
  { key: 'pension', name: '养老保险', item: '企业职工基本养老保险费' },
  { key: 'medical', name: '医疗保险', item: '基本医疗保险费' },
  { key: 'medicalMutual', name: '大额医疗互助', item: '基本医疗保险费（职工大额医疗互助保险）', cycle: 'year' },
  { key: 'unemployment', name: '失业保险', item: '失业保险费' },
  { key: 'injury', name: '工伤保险', item: '工伤保险费', companyOnly: true }
]

export const SI_RECORDS = [
  {
    id: 'si-2026-09-03',
    label: '2026-09-03 三方协议缴费',
    paidDate: '2026-09-03',
    splitHeadcount: 2,
    source: '社保缴费记录截图，两人合计（第三位员工另有缴费记录，按同一每人金额扣）',
    lines: [
      { key: 'pension', period: '2026-09', personalTotal: 702.92, companyTotal: 1054.36 },
      { key: 'medical', period: '2026-10', personalTotal: 175.72, companyTotal: 676.56 },
      { key: 'medicalMutual', period: '2026', personalTotal: 200, companyTotal: 0 },
      { key: 'unemployment', period: '2026-09', personalTotal: 26.36, companyTotal: 61.5 },
      { key: 'injury', period: '2026-09', personalTotal: 0, companyTotal: 28.12 }
    ]
  }
]

/** 系统外已扣（工资条上注明、不再扣） */
export const SI_EXTERNAL_CHARGES = [
  { key: 'medicalMutual', period: '2026', text: '大额医疗互助 2026 年度已于 8 月工资扣缴' }
]

export const SI_NOTE_SPLIT = '每人金额 = 缴费记录合计 ÷ 记录人数；记录人数只用于折算，不限制参保人数'
export const SI_NOTE_INJURY = '工伤保险按政策由公司全额缴纳，个人不扣'

const YM_RE = /^\d{4}-\d{2}$/
const Y_RE = /^\d{4}$/

function toCents(n) {
  return Math.round((Number(n) || 0) * 100)
}

export function perHead(total, headcount) {
  const hc = Math.max(1, Math.floor(Number(headcount) || 1))
  return Math.round(toCents(total) / hc) / 100
}

function itemOf(key) {
  return SI_ITEMS.find((i) => i.key === key) || null
}

export function validateRecord(rec) {
  const errors = []
  if (!rec || !rec.id) return ['缴费记录缺少 id']
  if (!(Number(rec.splitHeadcount) >= 1)) errors.push(`${rec.id}：记录人数须 ≥ 1`)
  const lines = Array.isArray(rec.lines) ? rec.lines : []
  if (!lines.length) errors.push(`${rec.id}：没有品目`)
  lines.forEach((l) => {
    const it = l && itemOf(l.key)
    if (!it) return errors.push(`${rec.id}：未知品目 ${l && l.key}`)
    const periodOk = it.cycle === 'year' ? Y_RE.test(String(l.period)) : YM_RE.test(String(l.period))
    if (!periodOk) errors.push(`${rec.id}：${it.name} 所属期格式不对（${l.period}）`)
    if (it.key === 'injury' && !it.companyOnly) errors.push('工伤保险必须标记为仅公司缴纳')
    if (it.companyOnly && toCents(l.personalTotal) !== 0) errors.push(`${rec.id}：${it.name} 仅公司缴纳，个人部分必须为 0`)
    if (toCents(l.personalTotal) < 0 || toCents(l.companyTotal) < 0) errors.push(`${rec.id}：${it.name} 金额不能为负`)
  })
  return errors
}

export function validateAll() {
  const errors = []
  if (!SI_ITEMS.some((i) => i.key === 'injury' && i.companyOnly)) errors.push('工伤保险必须标记为仅公司缴纳')
  SI_RECORDS.forEach((r) => errors.push(...validateRecord(r)))
  return errors
}

/** 所有记录里该品目的行，按所属期、缴费日期排序（同一所属期取最新缴费日期） */
function linesOf(key) {
  const out = []
  SI_RECORDS.forEach((rec) => (rec.lines || []).forEach((l) => {
    if (l.key === key) out.push({ line: l, rec })
  }))
  return out.sort((a, b) =>
    a.line.period === b.line.period
      ? (a.rec.paidDate < b.rec.paidDate ? -1 : 1)
      : (a.line.period < b.line.period ? -1 : 1))
}

/** 所属期的金额来源：有当期记录用当期；否则沿用最近一期（refPeriod）；都没有返回 null */
export function lineFor(key, period) {
  const all = linesOf(key)
  const exact = all.filter((x) => x.line.period === period)
  if (exact.length) return { ...exact[exact.length - 1], refPeriod: '' }
  const before = all.filter((x) => x.line.period < period)
  if (before.length) {
    const hit = before[before.length - 1]
    return { ...hit, refPeriod: hit.line.period }
  }
  return null
}

function periodLabel(period) {
  return Y_RE.test(period) ? `${period} 年度` : period
}

/**
 * 计算一张工资条的社保快照。
 * @param {{ payslipMonth: string, includeAnnual?: boolean, charged?: {key,period,month}[], advance?: {key,period}[] }} input
 *   charged：该员工其他工资条已扣过的（品目, 所属期）；advance：本张额外预扣的（品目, 所属期），只给补录脚本用
 * @returns {{ ok: true, snapshot: object } | { ok: false, msg: string }}
 */
export function computeSocialInsurance(input) {
  const errors = validateAll()
  if (errors.length) return { ok: false, msg: errors[0] }
  const ym = String((input && input.payslipMonth) || '').trim()
  if (!YM_RE.test(ym)) return { ok: false, msg: '工资条月份须为 YYYY-MM' }
  const year = ym.slice(0, 4)
  const includeAnnual = input && input.includeAnnual
  const charged = Array.isArray(input && input.charged) ? input.charged : []
  const advance = Array.isArray(input && input.advance) ? input.advance : []
  const personal = []
  const company = []
  const info = []
  const heads = new Set()
  let annualIncluded = false
  let annualAvailable = false
  let annualBlocked = ''

  const targets = []
  SI_ITEMS.forEach((it) => targets.push({ it, period: it.cycle === 'year' ? year : ym, advance: false }))
  advance.forEach((a) => {
    const it = itemOf(a && a.key)
    if (it && !it.companyOnly && a.period !== ym) targets.push({ it, period: String(a.period), advance: true })
  })

  targets.forEach(({ it, period, advance: isAdvance }) => {
    const isYear = it.cycle === 'year'
    const src = lineFor(it.key, period)
    if (!src) {
      if (!isYear) info.push({ key: it.key, name: it.name, period, kind: 'missing', text: `${it.name}（所属期 ${period}）暂无缴费记录，未扣` })
      return
    }
    heads.add(src.rec.splitHeadcount)
    const base = { key: it.key, name: it.name, period, periodLabel: periodLabel(period) }
    if (src.refPeriod) base.refPeriod = src.refPeriod
    const p = it.companyOnly ? 0 : perHead(src.line.personalTotal, src.rec.splitHeadcount)
    const c = perHead(src.line.companyTotal, src.rec.splitHeadcount)
    if (p > 0) {
      const ext = SI_EXTERNAL_CHARGES.find((e) => e.key === it.key && e.period === period)
      const prior = charged.find((x) => x && x.key === it.key && x.period === period)
      if (ext) {
        info.push({ ...base, kind: 'external', text: ext.text })
        if (isYear) annualBlocked = ext.text
      } else if (prior) {
        info.push({ ...base, kind: 'prior', amount: p, month: prior.month || '', text: `${it.name}（所属期 ${periodLabel(period)}）已在 ${prior.month || '之前'} 工资扣过，本张不再扣` })
        if (isYear) annualBlocked = `${it.name} ${period} 年度已在 ${prior.month || '之前'} 工资扣过，全年只扣一次`
      } else if (isYear && includeAnnual === false) {
        annualAvailable = true
        info.push({ ...base, kind: 'deferred', text: `${it.name}（${periodLabel(period)}）本张暂不扣` })
      } else {
        personal.push(isAdvance ? { ...base, amount: p, advance: true } : { ...base, amount: p })
        if (isAdvance) info.push({ ...base, kind: 'advance', amount: p, text: `${it.name}（所属期 ${periodLabel(period)}）${p.toFixed(2)} 已在本张工资预扣` })
        if (isYear) { annualIncluded = true; annualAvailable = true }
      }
    }
    if (c > 0 && !isAdvance) company.push({ ...base, amount: c })
  })

  if (!personal.length && !company.length) return { ok: false, msg: `${ym} 没有可套用的社保缴费记录` }
  const sum = (rows) => Math.round(rows.reduce((s, r) => s + toCents(r.amount), 0)) / 100
  return {
    ok: true,
    snapshot: {
      version: 2,
      payslipMonth: ym,
      splitHeadcount: heads.size === 1 ? [...heads][0] : 0,
      annualYear: year,
      annualIncluded,
      annualAvailable,
      annualBlocked,
      personal,
      company,
      info,
      personalTotal: sum(personal),
      companyTotal: sum(company),
      notes: [SI_NOTE_SPLIT, SI_NOTE_INJURY]
    }
  }
}

/** 从其他工资条的社保快照里收集已扣过的（品目, 所属期） */
export function chargedFromSnapshots(rows) {
  const out = []
  ;(rows || []).forEach((r) => {
    const s = r && r.socialInsurance
    if (!s || !Array.isArray(s.personal)) return
    s.personal.forEach((p) => {
      if (p && p.key && p.period) out.push({ key: p.key, period: String(p.period), month: String(r.month || r.yearMonth || '') })
    })
  })
  return out
}
