import { sumStoreNetRevenueForMonth } from './storeStorage.js'
import { genPayrollId } from './payrollStorage.js'
import { annualChargedMonth, computeSocialInsurance } from './socialInsurance.js'

function revenueKey(storeId, yearMonth) {
  return `${storeId}::${String(yearMonth).slice(0, 7)}`
}

/**
 * 门店当月用于算提成的营收：有登记则取登记净额之和；登记为 0 时允许用覆盖值
 */
export function resolveStoreRevenueForPayroll(storeBundle, payrollBundle, storeId, yearMonth) {
  const ym = String(yearMonth).slice(0, 7)
  const auto = sumStoreNetRevenueForMonth(storeBundle, storeId, ym)
  const ov = payrollBundle?.revenueOverrides?.[revenueKey(storeId, ym)]
  const overrideNum = ov != null && ov !== '' ? Number(ov) : NaN
  if (auto > 0) return { revenue: auto, source: 'entries' }
  if (Number.isFinite(overrideNum) && overrideNum >= 0) return { revenue: overrideNum, source: 'override' }
  return { revenue: 0, source: auto === 0 && !Number.isFinite(overrideNum) ? 'empty' : 'entries' }
}

function clerkEffectiveRate(settings, storeId) {
  const perStore = settings?.storeCommissionRates?.[storeId]
  if (perStore != null && Number.isFinite(Number(perStore)) && Number(perStore) >= 0) {
    return Number(perStore)
  }
  return Number(settings?.clerkCommissionRate) || 0.01
}

function clerkWeight(emp, defaultRate) {
  const o = emp.commissionRateOverride
  if (o == null || o === '') return 1
  const num = Number(o)
  if (!Number.isFinite(num) || num < 0) return 1
  if (!defaultRate) return 1
  return num / defaultRate
}

/**
 * 参保员工的社保快照（标准与小程序工资条同源，见 socialInsurance.js）：
 * 每月按「不晚于工资月的最近一版」月度标准扣同样的个人部分；大额医疗互助一年只扣一次（含系统外已扣）。
 * 个人部分从实发里扣，公司缴纳只记录展示。
 */
function socialInsuranceForSlip(settings, existingSlips, employeeId, ym) {
  const enrolled = Array.isArray(settings?.siEnrolledEmployeeIds) ? settings.siEnrolledEmployeeIds.map(String) : []
  if (!enrolled.includes(String(employeeId))) return null
  const others = (existingSlips || []).filter((s) => String(s.employeeId) === String(employeeId) && s.yearMonth !== ym)
  const r = computeSocialInsurance({ payslipMonth: ym, annualChargedIn: annualChargedMonth(others, ym.slice(0, 4)) })
  return r.ok ? r.snapshot : null
}

function siSlipFields(si, grossPay) {
  if (!si) return { siPersonal: 0, siCompany: 0, socialInsurance: null, netPay: grossPay }
  return {
    siPersonal: si.personalTotal,
    siCompany: si.companyTotal,
    socialInsurance: si,
    netPay: Math.round((grossPay - si.personalTotal) * 100) / 100,
  }
}

/**
 * 生成当月薪酬明细（草稿）。返回 { slips, errors, warnings }
 */
export function generateMonthlySlips(storeBundle, payrollBundle, yearMonth) {
  const ym = String(yearMonth).slice(0, 7)
  const settings = payrollBundle.settings || {}
  const mode = settings.clerkCommissionMode === 'per_head' ? 'per_head' : 'pool'
  const employees = payrollBundle.employees || []
  const attendanceList = payrollBundle.attendanceMonths || []
  const existingSlips = payrollBundle.slips || []

  const errors = []
  const warnings = []

  const locked = existingSlips.filter((s) => s.yearMonth === ym && s.status === 'locked')
  if (locked.length > 0) {
    errors.push(`月份 ${ym} 已有锁定薪酬明细，请先解锁后再重新生成。`)
    return { slips: null, errors, warnings }
  }

  const activeEmps = employees.filter((e) => e.status !== 'left')

  for (const e of activeEmps) {
    if (e.employeeType === 'store_clerk' && !e.storeId) {
      errors.push(`店员「${e.name || e.employeeNo}」未绑定门店，无法算薪。`)
    }
  }
  if (errors.length) return { slips: null, errors, warnings }

  const attByEmp = new Map()
  for (const a of attendanceList) {
    if (a.yearMonth === ym) attByEmp.set(a.employeeId, a)
  }

  const clerksByStore = new Map()
  for (const e of activeEmps) {
    if (e.employeeType !== 'store_clerk') continue
    if (!e.commissionParticipate) continue
    const sid = e.storeId
    if (!sid) continue
    if (!clerksByStore.has(sid)) clerksByStore.set(sid, [])
    clerksByStore.get(sid).push(e)
  }

  const commissionByEmployeeId = new Map()

  for (const [storeId, clerks] of clerksByStore) {
    const { revenue, source } = resolveStoreRevenueForPayroll(storeBundle, payrollBundle, storeId, ym)
    if (revenue <= 0 && clerks.length > 0) {
      warnings.push(
        `门店 ${storeId} 在 ${ym} 无登记营收且无有效覆盖值，店员提成按 0 计。`
      )
    }
    const rate = clerkEffectiveRate(settings, storeId)
    const pool = Math.max(0, revenue) * rate

    if (mode === 'per_head') {
      for (const e of clerks) {
        const personalRate =
          e.commissionRateOverride != null && e.commissionRateOverride !== ''
            ? Number(e.commissionRateOverride)
            : rate
        const r = Number.isFinite(personalRate) && personalRate >= 0 ? personalRate : rate
        commissionByEmployeeId.set(e.id, Math.max(0, revenue) * r)
      }
    } else {
      let sumW = 0
      const weights = clerks.map((e) => {
        const w = clerkWeight(e, rate)
        sumW += w
        return { e, w }
      })
      if (sumW <= 0) sumW = 1
      for (const { e, w } of weights) {
        const share = pool * (w / sumW)
        commissionByEmployeeId.set(e.id, share)
      }
    }
    if (source === 'override' && revenue > 0) {
      warnings.push(`门店 ${storeId} 使用「计提成营收覆盖值」参与 ${ym} 算薪。`)
    }
  }

  const slips = []
  const now = Date.now()

  for (const e of activeEmps) {
    const att = attByEmp.get(e.id)
    const deduction = Number(att?.deductionAmount) || 0
    const base = Number(e.baseSalaryMonthly) || 0

    let commissionPortion = 0
    let performanceBonus = 0
    let revenueBaseUsed = null
    let commissionRateUsed = null
    const storeIdSnap = e.storeId || null

    if (e.employeeType === 'store_clerk') {
      commissionPortion = commissionByEmployeeId.get(e.id) ?? 0
      if (!e.commissionParticipate) commissionPortion = 0
      const revInfo = resolveStoreRevenueForPayroll(storeBundle, payrollBundle, e.storeId, ym)
      revenueBaseUsed = revInfo.revenue
      commissionRateUsed = clerkEffectiveRate(settings, e.storeId)
    } else {
      performanceBonus = Number(e.monthlyPerformanceBonus) || 0
      commissionPortion = 0
      revenueBaseUsed = null
      commissionRateUsed = null
    }

    const allowance = 0
    const grossPay = base + commissionPortion + performanceBonus + allowance - deduction
    const si = socialInsuranceForSlip(settings, existingSlips, e.id, ym)

    slips.push({
      id: genPayrollId('slip'),
      employeeId: e.id,
      yearMonth: ym,
      employeeType: e.employeeType,
      basePortion: base,
      commissionPortion,
      performanceBonus,
      allowance,
      deduction,
      grossPay,
      ...siSlipFields(si, grossPay),
      revenueBaseUsed,
      commissionRateUsed,
      storeId: storeIdSnap,
      status: 'draft',
      lockedAt: null,
      createdAt: now,
    })
  }

  const nextSlips = existingSlips.filter((s) => s.yearMonth !== ym)
  return { slips: [...nextSlips, ...slips], errors: [], warnings }
}

/**
 * 同店提成池联动：重算任一店员时，须一并重算同店且参与提成的其他店员（PRD 池分摊）
 */
function expandClerkPeerIds(employees, seedIds) {
  const out = new Set(seedIds.map((id) => String(id)))
  const byId = new Map((employees || []).map((e) => [String(e.id), e]))
  for (const id of [...out]) {
    const e = byId.get(String(id))
    if (!e || e.employeeType !== 'store_clerk' || !e.storeId || e.commissionParticipate === false) continue
    for (const o of employees || []) {
      if (
        o.employeeType === 'store_clerk' &&
        o.storeId === e.storeId &&
        o.commissionParticipate !== false &&
        o.status !== 'left'
      ) {
        out.add(String(o.id))
      }
    }
  }
  return [...out]
}

/**
 * 草稿态下：仅重算指定员工（及同店店员池内同伴）的薪酬行，其余员工当月行不变。
 * 返回 { slips, errors, warnings }
 */
export function regeneratePartialMonthlySlips(storeBundle, payrollBundle, yearMonth, employeeIds) {
  const ym = String(yearMonth).slice(0, 7)
  const ids = (employeeIds || []).map(String).filter(Boolean)
  if (!ids.length) return { slips: null, errors: ['未指定员工'], warnings: [] }

  const settings = payrollBundle.settings || {}
  const mode = settings.clerkCommissionMode === 'per_head' ? 'per_head' : 'pool'
  const employees = payrollBundle.employees || []
  const attendanceList = payrollBundle.attendanceMonths || []
  const existingSlips = payrollBundle.slips || []

  const errors = []
  const warnings = []

  const locked = existingSlips.filter((s) => s.yearMonth === ym && s.status === 'locked')
  if (locked.length > 0) {
    errors.push(`月份 ${ym} 已有锁定薪酬明细，请先解锁后再重算。`)
    return { slips: null, errors, warnings }
  }

  const targetIds = expandClerkPeerIds(employees, ids)
  const targetSet = new Set(targetIds.map(String))
  const activeEmps = employees.filter((e) => e.status !== 'left')
  const activeSet = new Set(activeEmps.map((e) => String(e.id)))

  for (const tid of targetSet) {
    if (!activeSet.has(String(tid))) {
      errors.push(`员工 ${tid} 不存在或已离职`)
      return { slips: null, errors, warnings }
    }
  }

  for (const e of activeEmps) {
    if (targetSet.has(String(e.id)) && e.employeeType === 'store_clerk' && !e.storeId) {
      errors.push(`店员「${e.name || e.employeeNo}」未绑定门店，无法算薪。`)
    }
  }
  if (errors.length) return { slips: null, errors, warnings }

  const attByEmp = new Map()
  for (const a of attendanceList) {
    if (a.yearMonth === ym) attByEmp.set(a.employeeId, a)
  }

  const clerksByStore = new Map()
  for (const e of activeEmps) {
    if (e.employeeType !== 'store_clerk') continue
    if (!e.commissionParticipate) continue
    const sid = e.storeId
    if (!sid) continue
    if (!clerksByStore.has(sid)) clerksByStore.set(sid, [])
    clerksByStore.get(sid).push(e)
  }

  const commissionByEmployeeId = new Map()
  for (const [storeId, clerks] of clerksByStore) {
    const { revenue, source } = resolveStoreRevenueForPayroll(storeBundle, payrollBundle, storeId, ym)
    if (revenue <= 0 && clerks.length > 0) {
      warnings.push(`门店 ${storeId} 在 ${ym} 无登记营收且无有效覆盖值，店员提成按 0 计。`)
    }
    const rate = clerkEffectiveRate(settings, storeId)
    const pool = Math.max(0, revenue) * rate

    if (mode === 'per_head') {
      for (const e of clerks) {
        const personalRate =
          e.commissionRateOverride != null && e.commissionRateOverride !== ''
            ? Number(e.commissionRateOverride)
            : rate
        const r = Number.isFinite(personalRate) && personalRate >= 0 ? personalRate : rate
        commissionByEmployeeId.set(e.id, Math.max(0, revenue) * r)
      }
    } else {
      let sumW = 0
      const weights = clerks.map((e) => {
        const w = clerkWeight(e, rate)
        sumW += w
        return { e, w }
      })
      if (sumW <= 0) sumW = 1
      for (const { e, w } of weights) {
        commissionByEmployeeId.set(e.id, pool * (w / sumW))
      }
    }
    if (source === 'override' && revenue > 0) {
      warnings.push(`门店 ${storeId} 使用「计提成营收覆盖值」参与 ${ym} 算薪。`)
    }
  }

  const now = Date.now()
  const rebuilt = []

  for (const e of activeEmps) {
    if (!targetSet.has(String(e.id))) continue
    const att = attByEmp.get(e.id)
    const deduction = Number(att?.deductionAmount) || 0
    const base = Number(e.baseSalaryMonthly) || 0

    let commissionPortion = 0
    let performanceBonus = 0
    let revenueBaseUsed = null
    let commissionRateUsed = null
    const storeIdSnap = e.storeId || null

    if (e.employeeType === 'store_clerk') {
      commissionPortion = commissionByEmployeeId.get(e.id) ?? 0
      if (!e.commissionParticipate) commissionPortion = 0
      const revInfo = resolveStoreRevenueForPayroll(storeBundle, payrollBundle, e.storeId, ym)
      revenueBaseUsed = revInfo.revenue
      commissionRateUsed = clerkEffectiveRate(settings, e.storeId)
    } else {
      performanceBonus = Number(e.monthlyPerformanceBonus) || 0
      commissionPortion = 0
      revenueBaseUsed = null
      commissionRateUsed = null
    }

    const allowance = 0
    const grossPay = base + commissionPortion + performanceBonus + allowance - deduction
    const si = socialInsuranceForSlip(settings, existingSlips, e.id, ym)

    const prev = existingSlips.find((s) => s.yearMonth === ym && s.employeeId === e.id)
    rebuilt.push({
      id: prev?.id || genPayrollId('slip'),
      employeeId: e.id,
      yearMonth: ym,
      employeeType: e.employeeType,
      basePortion: base,
      commissionPortion,
      performanceBonus,
      allowance,
      deduction,
      grossPay,
      ...siSlipFields(si, grossPay),
      revenueBaseUsed,
      commissionRateUsed,
      storeId: storeIdSnap,
      status: 'draft',
      lockedAt: null,
      createdAt: prev?.createdAt ?? now,
    })
  }

  const rest = existingSlips.filter((s) => !(s.yearMonth === ym && targetSet.has(String(s.employeeId))))
  return { slips: [...rest, ...rebuilt], errors: [], warnings }
}
