/**
 * 员工工号生成：公司序号(天干) + 门店序号(小写字母) + 员工序号(四位数字)
 * 例：甲a0001、甲b0003、乙aa0012
 */

export const TIANGAN = '甲乙丙丁戊己庚辛壬癸'

/** 无门店（标本师/职能等）占位，与门店字母段区分 */
export const NO_STORE_LETTER = 'x'

/**
 * 门店在排序列表中的序号 → 小写字母（0→a … 25→z，26→aa …）
 * @param {number} index0 从 0 起的门店序号
 */
export function storeIndexToLetters(index0) {
  if (index0 < 0 || !Number.isFinite(index0)) return NO_STORE_LETTER
  let n = index0 + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(97 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 按门店编码、再按 id 稳定排序，得到门店 id 列表 */
export function sortedStoreIds(storeBundle) {
  const list = [...(storeBundle?.stores || [])]
  list.sort((a, b) => {
    const ca = String(a.code || '')
    const cb = String(b.code || '')
    if (ca !== cb) return ca.localeCompare(cb, 'zh-Hans-CN')
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
  return list.map((s) => s.id)
}

/**
 * @param {string|null|undefined} storeId
 * @returns {{ companyChar: string, storeLetters: string, prefix: string }}
 */
export function buildEmployeeNoPrefix(storeBundle, payrollSettings, storeId) {
  const idx = Number(payrollSettings?.companyTianGanIndex)
  const companyChar = TIANGAN[(Number.isFinite(idx) ? idx : 0) % TIANGAN.length]

  let storeLetters = NO_STORE_LETTER
  if (storeId) {
    const ids = sortedStoreIds(storeBundle)
    const pos = ids.indexOf(storeId)
    if (pos >= 0) storeLetters = storeIndexToLetters(pos)
  }

  return {
    companyChar,
    storeLetters,
    prefix: `${companyChar}${storeLetters}`,
  }
}

function escapePrefixForRegex(prefix) {
  return prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 解析是否符合当前规则：天干 + 小写字母(可多位) + 4 位数字
 */
export function parseStructuredEmployeeNo(employeeNo) {
  const s = String(employeeNo || '').trim()
  const m = s.match(/^([甲乙丙丁戊己庚辛壬癸])([a-z]+)(\d{4})$/)
  if (!m) return null
  return { companyChar: m[1], storeLetters: m[2], serial: parseInt(m[3], 10), prefix: m[1] + m[2] }
}

/**
 * 生成下一个工号（同一公司天干 + 门店字母段下流水 +1）
 * @param {object} opts
 * @param {Array} opts.employees PayrollEmployee[]
 * @param {object} opts.storeBundle loadStoreBundle()
 * @param {object} opts.payrollSettings payroll.settings
 * @param {string|null} opts.storeId 无门店传 null → 字母段为 x
 * @param {string|null} opts.excludeEmployeeId 编辑时排除自身，避免重算占用当前号
 */
export function generateNextEmployeeNo(opts) {
  const { employees, storeBundle, payrollSettings, storeId, excludeEmployeeId } = opts
  const { prefix } = buildEmployeeNoPrefix(storeBundle, payrollSettings, storeId)
  const re = new RegExp(`^${escapePrefixForRegex(prefix)}(\\d{4})$`)
  let max = 0
  for (const e of employees || []) {
    if (excludeEmployeeId && e.id === excludeEmployeeId) continue
    const no = String(e.employeeNo || '').trim()
    const mm = no.match(re)
    if (mm) {
      const n = parseInt(mm[1], 10)
      if (Number.isFinite(n)) max = Math.max(max, n)
    }
  }
  const next = max + 1
  if (next > 9999) throw new Error('员工序号已超过 9999，请调整规则或归档后重置')
  return `${prefix}${String(next).padStart(4, '0')}`
}
