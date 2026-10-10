/**
 * 工资条明细的展示整理（员工本人看）。
 * 社保快照（socialInsurance）由云函数 manageStaffWorkspace 保存：
 *   personal = 个人应扣（已计入 deduction），company = 公司为你缴纳（只展示，不从实发里扣）。
 * 没有快照的旧工资条按原字段原样展示。
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function money(n) {
  return round2(n).toFixed(2)
}

function siTag(r) {
  if (r.advance) return '预扣'
  if (r.refPeriod) return `参考上期 ${r.refPeriod}`
  return ''
}

function siRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.name && Number(r.amount) > 0)
    .map((r) => ({
      key: `${r.key || r.name}-${r.period || ''}`,
      name: r.name,
      period: r.periodLabel || r.period || '',
      tag: siTag(r),
      amountFmt: money(r.amount)
    }))
}

function buildSocialInsurance(si, otherDeduction) {
  if (!si || typeof si !== 'object') return null
  const personal = siRows(si.personal)
  const company = siRows(si.company)
  if (!personal.length && !company.length) return null
  const hasInjury = (Array.isArray(si.company) ? si.company : []).some((r) => r && r.key === 'injury')
  const hasRef = personal.concat(company).some((r) => r.tag.indexOf('参考上期') === 0)
  const split = Number(si.splitHeadcount || si.headcount) || 0
  const infos = (Array.isArray(si.info) ? si.info : [])
    .filter((x) => x && x.text && x.kind !== 'missing')
    .map((x) => x.text)
  return {
    personal,
    company,
    infos,
    personalTotalFmt: money(si.personalTotal),
    companyTotalFmt: money(si.companyTotal),
    otherDeduction: round2(otherDeduction),
    otherDeductionFmt: money(otherDeduction),
    splitNote: split > 1 ? `每人金额 = 缴费记录合计 ÷ ${split}（只用于折算，不限制参保人数）` : '',
    refNote: hasRef ? '标「参考上期」的品目本月暂无缴费记录，沿用最近一期金额' : '',
    injuryNote: hasInjury ? '工伤保险按政策由公司全额缴纳，个人不扣' : ''
  }
}

function enrichDetail(raw) {
  if (!raw) return null
  const detail = { ...raw }
  const items = Array.isArray(detail.items) ? detail.items : []
  detail.hasItems = items.length > 0
  if (detail.hasItems) {
    let earn = 0
    let deduct = 0
    items.forEach((it) => {
      if (it && it.kind === 'deduct') deduct += Number(it.amount) || 0
      else earn += Number(it.amount) || 0
    })
    detail.grossDisplay = round2(earn)
    detail.deductDisplay = round2(deduct)
  } else {
    const base = Number(detail.base) || 0
    const bonus = Number(detail.bonus) || 0
    detail.grossDisplay =
      Number.isFinite(Number(detail.gross)) && detail.gross != null
        ? Number(detail.gross)
        : round2(base + bonus)
    detail.deductDisplay = Number(detail.deduction) || 0
  }
  detail.si = buildSocialInsurance(detail.socialInsurance, detail.otherDeduction)
  if (detail.si) {
    detail.deductDisplay = round2(Number(detail.deduction) || 0)
  }
  return detail
}

module.exports = { enrichDetail, buildSocialInsurance }
