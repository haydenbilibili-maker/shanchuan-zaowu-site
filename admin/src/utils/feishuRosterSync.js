/**
 * 员工花名册 ← 飞书人事多维表
 * 真相源：飞书表；Admin 本地 payroll.employees upsert（localStorage）
 * 凭证经 /api/feishu-sync，不进 SPA
 */
import { feishuProxyStatus } from './feishuSync.js'
import { genPayrollId, appendAuditLog } from './payrollStorage.js'
import { generateNextEmployeeNo } from './employeeNoGenerator.js'

/** 用户提供的人事 Base */
export const ROSTER_APP_TOKEN = 'UOIcbbRBwaX9U1sIR9xcezhenzb'
export const ROSTER_TABLE_ID = 'tblSuPKdcSnJwNTq'
export const ROSTER_VIEW_ID = 'vewgbAatnj'

const MAPPING_KEY = 'sc_feishu_roster_mapping_v1'

/** 系统字段 → 飞书列名（可改） */
export const ROSTER_FIELD_DEFS = [
  { key: 'name', label: '姓名', required: true, hints: ['姓名', '员工姓名', '名字', 'Name'] },
  { key: 'phone', label: '手机', hints: ['手机', '手机号', '联系电话', '电话', 'Mobile'] },
  { key: 'idCardNumber', label: '身份证号', hints: ['身份证', '身份证号', '证件号', '身份证号码'] },
  { key: 'bankCardNumber', label: '银行卡号', hints: ['银行卡', '银行卡号', '卡号', '银行账号', '账号'] },
  { key: 'bankName', label: '开户行', hints: ['开户行', '银行', '开户银行', '支行'] },
  { key: 'employeeNo', label: '工号', hints: ['工号', '员工编号', '编号'] },
  { key: 'department', label: '部门', hints: ['部门', '所属部门'] },
  { key: 'position', label: '岗位', hints: ['岗位', '职位', '职务', '角色'] },
  { key: 'gender', label: '性别', hints: ['性别'] },
  { key: 'hireDate', label: '入职日期', hints: ['入职日期', '入职日', '入职时间', '到岗日期'] },
  { key: 'leaveDate', label: '离职日期', hints: ['离职日期', '离职日', '离职时间'] },
  { key: 'status', label: '状态', hints: ['状态', '在职状态', '员工状态'] },
  { key: 'employeeType', label: '员工类型', hints: ['员工类型', '类型', '人员类型', '岗位类型'] },
  { key: 'baseSalaryMonthly', label: '基本工资', hints: ['基本工资', '月薪', '底薪', '工资'] },
]

function candidateUrls() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  const urls = ['/api/feishu-sync']
  if (base && base !== '/') urls.push(`${base}/api/feishu-sync`)
  return [...new Set(urls)]
}

async function feishuApi(body) {
  const urls = candidateUrls()
  let lastErr
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('text/html')) {
        lastErr = new Error(`${url} 未部署飞书代理（返回了 HTML）`)
        continue
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok && json.success !== false) {
        lastErr = new Error(`飞书代理 HTTP ${res.status}`)
        continue
      }
      if (json.success === false) {
        const err = new Error(json.msg || '飞书同步失败')
        err.fatal = true
        throw err
      }
      return json
    } catch (e) {
      if (e.fatal) throw e
      lastErr = e
    }
  }
  throw lastErr || new Error('飞书代理不可用')
}

export function defaultRosterMapping() {
  const fields = {}
  for (const d of ROSTER_FIELD_DEFS) {
    fields[d.key] = d.hints?.[0] || ''
  }
  return {
    appToken: ROSTER_APP_TOKEN,
    tableId: ROSTER_TABLE_ID,
    viewId: ROSTER_VIEW_ID,
    fields,
    updatedAt: 0,
  }
}

export function loadRosterMapping() {
  try {
    const raw = localStorage.getItem(MAPPING_KEY)
    if (!raw) return defaultRosterMapping()
    const parsed = JSON.parse(raw)
    const base = defaultRosterMapping()
    return {
      ...base,
      ...parsed,
      fields: { ...base.fields, ...(parsed.fields || {}) },
    }
  } catch {
    return defaultRosterMapping()
  }
}

export function saveRosterMapping(mapping) {
  const next = {
    ...defaultRosterMapping(),
    ...mapping,
    fields: { ...(mapping.fields || {}) },
    updatedAt: Date.now(),
  }
  localStorage.setItem(MAPPING_KEY, JSON.stringify(next))
  return next
}

/** 按飞书列名自动猜测映射 */
export function guessRosterFieldMap(feishuFieldNames = []) {
  const names = feishuFieldNames.map((n) => String(n || '').trim()).filter(Boolean)
  const fields = {}
  for (const def of ROSTER_FIELD_DEFS) {
    const hit =
      names.find((n) => def.hints.some((h) => n === h)) ||
      names.find((n) => def.hints.some((h) => n.includes(h) || h.includes(n)))
    fields[def.key] = hit || ''
  }
  return fields
}

function cellText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return value
      .map((v) => (v && (v.text || v.name)) || (typeof v === 'string' || typeof v === 'number' ? String(v) : ''))
      .filter(Boolean)
      .join(',')
  }
  if (value.text) return String(value.text)
  if (value.name) return String(value.name)
  return String(value)
}

function cellDate(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  const t = cellText(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const n = Number(t)
  if (Number.isFinite(n) && n > 1e11) {
    const d = new Date(n)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return t
}

function pickField(fields, name) {
  if (!name) return undefined
  if (fields[name] !== undefined) return fields[name]
  const key = Object.keys(fields || {}).find((k) => k.trim() === String(name).trim())
  return key ? fields[key] : undefined
}

function mapGender(raw) {
  const t = String(raw || '').trim()
  if (!t) return ''
  if (/^(男|male|m)$/i.test(t)) return 'male'
  if (/^(女|female|f)$/i.test(t)) return 'female'
  return t
}

function mapStatus(raw) {
  const t = String(raw || '').trim()
  if (!t) return 'active'
  if (/离职|离开|left|inactive|resign/i.test(t)) return 'left'
  if (/在职|active|正式|试用/i.test(t)) return 'active'
  return 'active'
}

function mapEmployeeType(raw) {
  const t = String(raw || '').trim()
  if (!t) return ''
  if (/店员|门店|clerk|store/i.test(t)) return 'store_clerk'
  if (/标本/i.test(t)) return 'specimen'
  if (/职能|行政|总部|仓管|运营/i.test(t)) return 'function'
  return ''
}

function mapRecord(rec, fieldMap) {
  const f = rec.fields || {}
  const get = (key) => pickField(f, fieldMap[key])
  const name = cellText(get('name')).trim()
  const phone = cellText(get('phone')).replace(/\s/g, '').trim()
  const salaryRaw = cellText(get('baseSalaryMonthly')).replace(/,/g, '')
  const salary = Number(salaryRaw)
  return {
    feishuRecordId: rec.record_id || rec.id || '',
    name,
    phone,
    idCardNumber: cellText(get('idCardNumber')).replace(/\s/g, '').trim(),
    bankCardNumber: cellText(get('bankCardNumber')).replace(/\s/g, '').trim(),
    bankName: cellText(get('bankName')).trim(),
    employeeNo: cellText(get('employeeNo')).trim(),
    department: cellText(get('department')).trim(),
    position: cellText(get('position')).trim(),
    gender: mapGender(get('gender')),
    hireDate: cellDate(get('hireDate')),
    leaveDate: cellDate(get('leaveDate')),
    status: mapStatus(get('status')),
    employeeType: mapEmployeeType(get('employeeType')),
    baseSalaryMonthly: Number.isFinite(salary) ? salary : undefined,
    raw: f,
  }
}

function findExisting(employees, mapped) {
  if (mapped.feishuRecordId) {
    const byFeishu = employees.find((e) => e.feishuRecordId === mapped.feishuRecordId)
    if (byFeishu) return byFeishu
  }
  const name = (mapped.name || '').trim()
  const phone = (mapped.phone || '').replace(/\s/g, '')
  if (name && phone) {
    const byBoth = employees.find(
      (e) => (e.name || '').trim() === name && String(e.phone || '').replace(/\s/g, '') === phone,
    )
    if (byBoth) return byBoth
  }
  if (mapped.idCardNumber) {
    const idn = mapped.idCardNumber
    const byId = employees.find((e) => String(e.idCardNumber || '').replace(/\s/g, '') === idn)
    if (byId) return byId
  }
  return null
}

/**
 * 探测人事表字段（可用 mapping.appToken / tableId）
 */
export async function inspectRosterTable(mapping = loadRosterMapping()) {
  const status = await feishuProxyStatus()
  if (!status.configured) {
    return {
      success: false,
      msg:
        status.msg ||
        '未配置 FEISHU_APP_ID / FEISHU_APP_SECRET。请写入 admin/.env（本地）或 Cloudflare Pages 环境变量，并确保该飞书应用已添加为人事 Base 的文档应用。',
    }
  }
  const appToken = mapping.appToken || ROSTER_APP_TOKEN
  const tableId = mapping.tableId || ROSTER_TABLE_ID
  try {
    const data = await feishuApi({ action: 'listFields', appToken, tableId })
    const fieldNames = (data.fields || []).map((f) => f.name)
    return {
      success: true,
      appToken: data.appToken || appToken,
      tableId,
      fields: data.fields || [],
      guessed: guessRosterFieldMap(fieldNames),
      msg: `已探测 ${fieldNames.length} 个字段`,
    }
  } catch (e) {
    return { success: false, msg: e.message || String(e) }
  }
}

/**
 * 从飞书拉取并 upsert 到 payroll.employees
 * @returns {{ success, msg, stats, payroll }}
 */
export async function syncRosterFromFeishu(payroll, options = {}) {
  const mapping = options.mapping || loadRosterMapping()
  const storeBundle = options.storeBundle
  const appToken = mapping.appToken || ROSTER_APP_TOKEN
  const tableId = mapping.tableId || ROSTER_TABLE_ID
  const viewId = mapping.viewId || ROSTER_VIEW_ID
  const fieldMap = mapping.fields || {}

  if (!fieldMap.name) {
    return { success: false, msg: '请先配置「姓名」字段映射' }
  }

  const status = await feishuProxyStatus()
  if (!status.configured) {
    return {
      success: false,
      msg:
        '未配置 FEISHU_APP_ID / FEISHU_APP_SECRET。本地：admin/.env；线上：Cloudflare Pages 环境变量。该应用还需对人事 Base（UOIc…）添加文档应用权限。',
    }
  }

  let records
  try {
    const data = await feishuApi({
      action: 'listRecords',
      appToken,
      tableId,
      viewId,
    })
    records = data.records || []
  } catch (e) {
    return { success: false, msg: e.message || String(e) }
  }

  const employees = [...(payroll.employees || [])]
  let created = 0
  let updated = 0
  let skipped = 0
  const now = Date.now()

  for (const rec of records) {
    const mapped = mapRecord(rec, fieldMap)
    if (!mapped.name) {
      skipped += 1
      continue
    }
    const existing = findExisting(employees, mapped)
    const patch = {
      name: mapped.name,
      phone: mapped.phone || (existing?.phone || ''),
      idCardNumber: mapped.idCardNumber || existing?.idCardNumber || '',
      bankCardNumber: mapped.bankCardNumber || existing?.bankCardNumber || '',
      bankName: mapped.bankName || existing?.bankName || '',
      department: mapped.department || existing?.department || '',
      position: mapped.position || existing?.position || '',
      gender: mapped.gender || existing?.gender || '',
      hireDate: mapped.hireDate || existing?.hireDate || '',
      leaveDate: mapped.status === 'left' ? mapped.leaveDate || existing?.leaveDate || '' : existing?.leaveDate || '',
      status: mapped.status || existing?.status || 'active',
      feishuRecordId: mapped.feishuRecordId || existing?.feishuRecordId || '',
      updatedAt: now,
      syncedFromFeishuAt: now,
    }
    if (mapped.employeeNo) patch.employeeNo = mapped.employeeNo
    if (mapped.employeeType) patch.employeeType = mapped.employeeType
    if (mapped.baseSalaryMonthly != null) patch.baseSalaryMonthly = mapped.baseSalaryMonthly

    if (existing) {
      const i = employees.findIndex((e) => e.id === existing.id)
      employees[i] = { ...existing, ...patch }
      updated += 1
    } else {
      let employeeNo = mapped.employeeNo
      if (!employeeNo) {
        try {
          employeeNo = generateNextEmployeeNo({
            employees,
            storeBundle,
            payrollSettings: payroll.settings,
            storeId: null,
            excludeEmployeeId: null,
          })
        } catch {
          employeeNo = `F${String(employees.length + 1).padStart(4, '0')}`
        }
      }
      employees.push({
        id: genPayrollId('emp'),
        employeeNo,
        employeeType: mapped.employeeType || 'function',
        storeId: null,
        baseSalaryMonthly: mapped.baseSalaryMonthly ?? 0,
        commissionParticipate: false,
        commissionRateOverride: null,
        monthlyPerformanceBonus: 0,
        teamMemberId: null,
        createdAt: now,
        ...patch,
      })
      created += 1
    }
  }

  let next = { ...payroll, employees }
  next = appendAuditLog(next, 'feishu_roster_sync', `新建 ${created} / 更新 ${updated} / 跳过 ${skipped}`)
  return {
    success: true,
    payroll: next,
    stats: { pulled: records.length, created, updated, skipped },
    msg: `已同步：新建 ${created}，更新 ${updated}，跳过 ${skipped}（共拉取 ${records.length}）`,
  }
}
