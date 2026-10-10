/**
 * 社保月度扣缴标准（工资条明细，产品负责人 2026-10-10 点名；同日第 3 轮口径）
 *
 * 口径：
 *   1. 每月扣缴相同：每张工资条都扣同样的月度个人部分（当前版：养老 351.46 + 医疗 87.86 + 失业 13.18 = 452.50），
 *      公司为你缴纳只展示（养老 527.18 + 医疗 338.28 + 失业 30.75 + 工伤 14.06 = 910.27），不从实发里扣。
 *      截图（2026-08 扣除项目）只是品目样例，不按所属月拆分。
 *   2. 标准有版本：每版写 effectiveFrom（自哪个工资月起生效），某月工资条用「不晚于该月的最近一版」——
 *      没有新版时就按上一版金额扣。费率变了追加新版，不要改已用过的版本。
 *   3. 每人金额 = 截图合计 ÷ splitHeadcount（按分取整）。splitHeadcount 只用于折算，**不是参保人数上限**，所有参保员工都扣。
 *   4. 工伤保险按政策个人不扣，只由公司缴纳。
 *   5. 大额医疗互助一年只扣一次（当年第一张工资条）；系统外已扣的年度写进 SI_EXTERNAL_CHARGES，工资条上注明、不再扣。
 *
 * ESM 副本：真源为 miniprogram/cloudfunctions/manageStaffWorkspace/socialInsurance.js（CJS），由 test:payslip-social-insurance 逐项比对一致。
 */
export const SI_ITEMS = [
  { key: 'pension', name: '养老保险', item: '企业职工基本养老保险费' },
  { key: 'medical', name: '医疗保险', item: '基本医疗保险费' },
  { key: 'medicalMutual', name: '大额医疗互助', item: '基本医疗保险费（职工大额医疗互助保险）', cycle: 'year' },
  { key: 'unemployment', name: '失业保险', item: '失业保险费' },
  { key: 'injury', name: '工伤保险', item: '工伤保险费', companyOnly: true }
]

export const SI_STANDARDS = [
  {
    id: 'si-2026-08',
    label: '月度扣缴标准 · 自 2026-08 起',
    effectiveFrom: '2026-08',
    splitHeadcount: 2,
    source: '社保扣除项目截图（2026-08，两人合计，作为每月固定标准）',
    lines: [
      { key: 'pension', personalTotal: 702.92, companyTotal: 1054.36 },
      { key: 'medical', personalTotal: 175.72, companyTotal: 676.56 },
      { key: 'medicalMutual', personalTotal: 200, companyTotal: 0 },
      { key: 'unemployment', personalTotal: 26.36, companyTotal: 61.5 },
      { key: 'injury', personalTotal: 0, companyTotal: 28.12 }
    ]
  }
]

/** 系统外已扣的年度品目（工资条上注明、当年不再扣） */
export const SI_EXTERNAL_CHARGES = [
  { key: 'medicalMutual', year: '2026', text: '大额医疗互助 2026 年度已于 8 月工资扣缴' }
]

export const SI_NOTE_SPLIT = '每人金额 = 扣除项目合计 ÷ 折算人数；折算人数只用于折算，不限制参保人数'
export const SI_NOTE_INJURY = '工伤保险按政策由公司全额缴纳，个人不扣'

const YM_RE = /^\d{4}-\d{2}$/

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

export function validateStandard(std) {
  const errors = []
  if (!std || !std.id) return ['标准缺少 id']
  if (!YM_RE.test(String(std.effectiveFrom || ''))) errors.push(`${std.id}：生效月须为 YYYY-MM`)
  if (!(Number(std.splitHeadcount) >= 1)) errors.push(`${std.id}：折算人数须 ≥ 1`)
  const lines = Array.isArray(std.lines) ? std.lines : []
  if (!lines.length) errors.push(`${std.id}：没有品目`)
  lines.forEach((l) => {
    const it = l && itemOf(l.key)
    if (!it) return errors.push(`${std.id}：未知品目 ${l && l.key}`)
    if (it.companyOnly && toCents(l.personalTotal) !== 0) errors.push(`${std.id}：${it.name} 仅公司缴纳，个人部分必须为 0`)
    if (toCents(l.personalTotal) < 0 || toCents(l.companyTotal) < 0) errors.push(`${std.id}：${it.name} 金额不能为负`)
  })
  return errors
}

export function validateAll() {
  const errors = []
  if (!SI_ITEMS.some((i) => i.key === 'injury' && i.companyOnly)) errors.push('工伤保险必须标记为仅公司缴纳')
  SI_STANDARDS.forEach((s) => errors.push(...validateStandard(s)))
  const froms = SI_STANDARDS.map((s) => s.effectiveFrom)
  if (new Set(froms).size !== froms.length) errors.push('同一生效月不能有两版标准')
  return errors
}

/** 某工资月适用的标准：不晚于该月的最近一版 */
export function standardForMonth(ym) {
  const hit = SI_STANDARDS.filter((s) => s.effectiveFrom <= ym).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
  return hit.length ? hit[hit.length - 1] : null
}

/** 同一员工其他工资条里，本年度已扣大额医疗互助（年度品目）的月份 */
export function annualChargedMonth(rows, year) {
  const hit = (rows || []).find((r) => {
    const s = r && r.socialInsurance
    return s && s.annualIncluded && String(s.annualYear) === String(year)
  })
  return hit ? String(hit.month || hit.yearMonth || '') : ''
}

/**
 * 计算一张工资条的社保快照。
 * @param {{ payslipMonth: string, includeAnnual?: boolean, annualChargedIn?: string }} input
 *   includeAnnual 不传 = 本年度还能扣就扣；annualChargedIn = 本年度已扣年度品目的工资条月份
 * @returns {{ ok: true, snapshot: object } | { ok: false, msg: string }}
 */
export function computeSocialInsurance(input) {
  const errors = validateAll()
  if (errors.length) return { ok: false, msg: errors[0] }
  const ym = String((input && input.payslipMonth) || '').trim()
  if (!YM_RE.test(ym)) return { ok: false, msg: '工资条月份须为 YYYY-MM' }
  const std = standardForMonth(ym)
  if (!std) return { ok: false, msg: `${ym} 之前没有生效的社保扣缴标准` }
  const year = ym.slice(0, 4)
  const includeAnnual = input && input.includeAnnual
  const chargedIn = String((input && input.annualChargedIn) || '')
  const personal = []
  const company = []
  const info = []
  let annualIncluded = false
  let annualAvailable = false
  let annualBlocked = ''

  std.lines.forEach((l) => {
    const it = itemOf(l.key)
    const p = it.companyOnly ? 0 : perHead(l.personalTotal, std.splitHeadcount)
    const c = perHead(l.companyTotal, std.splitHeadcount)
    if (p > 0 && it.cycle === 'year') {
      const ext = SI_EXTERNAL_CHARGES.find((e) => e.key === it.key && e.year === year)
      if (ext) {
        annualBlocked = ext.text
        info.push({ key: it.key, kind: 'external', text: ext.text })
      } else if (chargedIn) {
        annualBlocked = `${it.name} ${year} 年度已在 ${chargedIn} 工资扣过，全年只扣一次`
        info.push({ key: it.key, kind: 'prior', text: `${it.name} ${year} 年度已在 ${chargedIn} 工资扣过` })
      } else if (includeAnnual === false) {
        annualAvailable = true
        info.push({ key: it.key, kind: 'deferred', text: `${it.name}（${year} 年度一次）本张暂不扣` })
      } else {
        annualAvailable = true
        annualIncluded = true
        personal.push({ key: it.key, name: it.name, amount: p, annual: true })
      }
    } else if (p > 0) {
      personal.push({ key: it.key, name: it.name, amount: p })
    }
    if (c > 0) company.push({ key: it.key, name: it.name, amount: c })
  })

  const sum = (rows) => Math.round(rows.reduce((s, r) => s + toCents(r.amount), 0)) / 100
  return {
    ok: true,
    snapshot: {
      version: 3,
      standardId: std.id,
      standardLabel: std.label,
      effectiveFrom: std.effectiveFrom,
      payslipMonth: ym,
      splitHeadcount: std.splitHeadcount,
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
