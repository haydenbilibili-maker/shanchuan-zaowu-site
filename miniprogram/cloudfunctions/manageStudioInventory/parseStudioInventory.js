/**
 * 工作室库存群公告解析
 *
 * 样例：
 *   群公告
 *   山海造物标本库存
 *   2026年9月14日
 *   小蓝闪蝶贝壳钟表4个
 *   10cm玻璃罩（小球）⬇️
 *   血漪蛱蝶10个
 */

const GROUP_ARROW_RE = /[⬇️⬇↓🠗]+$/
const DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/
const ITEM_RE = /^(.+?)(\d+)\s*个\s*$/
const SKIP_EXACT = /^(群公告|公告)$/

function pad2(n) {
  return String(n).padStart(2, '0')
}

function normalizeDate(y, m, d) {
  const yy = parseInt(y, 10)
  const mm = parseInt(m, 10)
  const dd = parseInt(d, 10)
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return ''
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return ''
  return `${yy}-${pad2(mm)}-${pad2(dd)}`
}

function isGroupLine(line) {
  return GROUP_ARROW_RE.test(line)
}

function parseGroupName(line) {
  return String(line || '')
    .replace(GROUP_ARROW_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @returns {{
 *   ok: boolean,
 *   error?: string,
 *   inventoryDate: string,
 *   sourceLabel: string,
 *   location: 'studio',
 *   groups: Array<{ name: string, count: number, totalQty: number }>,
 *   lines: Array<{
 *     skuName: string,
 *     qty: number,
 *     unit: string,
 *     groupName: string,
 *     lineNo: number
 *   }>,
 *   skipped: Array<{ lineNo: number, text: string, reason: string }>,
 *   stats: { lineCount: number, totalQty: number, groupCount: number }
 * }}
 */
function parseStudioInventoryText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '')
  if (!raw.trim()) {
    return {
      ok: false,
      error: '请粘贴群公告库存文本',
      inventoryDate: '',
      sourceLabel: '',
      location: 'studio',
      groups: [],
      lines: [],
      skipped: [],
      stats: { lineCount: 0, totalQty: 0, groupCount: 0 }
    }
  }

  const rows = raw.split(/\r?\n/)
  let inventoryDate = ''
  let sourceLabel = ''
  let currentGroup = ''
  const lines = []
  const skipped = []
  const groupOrder = []
  const groupMap = Object.create(null)

  const touchGroup = (name) => {
    const key = name || '未分组'
    if (!groupMap[key]) {
      groupMap[key] = { name: key, count: 0, totalQty: 0 }
      groupOrder.push(key)
    }
    return groupMap[key]
  }

  rows.forEach((row, idx) => {
    const lineNo = idx + 1
    const line = String(row || '').trim()
    if (!line) return

    if (SKIP_EXACT.test(line)) {
      skipped.push({ lineNo, text: line, reason: '忽略公告头' })
      return
    }

    const dateMatch = line.match(DATE_RE)
    if (
      dateMatch &&
      !ITEM_RE.test(line) &&
      !isGroupLine(line) &&
      !/[个]/.test(line) &&
      /^[\d\s年月日./\-]+$/.test(line)
    ) {
      const d = normalizeDate(dateMatch[1], dateMatch[2], dateMatch[3])
      if (d) {
        inventoryDate = d
        return
      }
    }

    if (isGroupLine(line)) {
      const name = parseGroupName(line)
      if (!name) {
        skipped.push({ lineNo, text: line, reason: '空分组' })
        return
      }
      currentGroup = name
      touchGroup(name)
      return
    }

    if (/库存/.test(line) && !ITEM_RE.test(line) && !/\d+\s*个/.test(line)) {
      sourceLabel = line.replace(/\s+/g, ' ').trim()
      return
    }

    const itemMatch = line.match(ITEM_RE)
    if (itemMatch) {
      const skuName = String(itemMatch[1] || '').replace(/\s+/g, ' ').trim()
      const qty = parseInt(itemMatch[2], 10)
      if (!skuName || skuName.length > 80) {
        skipped.push({ lineNo, text: line, reason: '品名无效' })
        return
      }
      if (!Number.isFinite(qty) || qty < 0 || qty > 999999) {
        skipped.push({ lineNo, text: line, reason: '数量无效' })
        return
      }
      const groupName = currentGroup || ''
      lines.push({
        skuName,
        qty,
        unit: '个',
        groupName,
        lineNo
      })
      const g = touchGroup(groupName)
      g.count += 1
      g.totalQty += qty
      return
    }

    skipped.push({ lineNo, text: line, reason: '未能识别' })
  })

  // 同组同名合并
  const merged = []
  const keyIndex = Object.create(null)
  lines.forEach((row) => {
    const key = `${row.groupName}||${row.skuName}`
    if (keyIndex[key] != null) {
      merged[keyIndex[key]].qty += row.qty
      return
    }
    keyIndex[key] = merged.length
    merged.push({ ...row })
  })

  const groups = groupOrder.map((k) => {
    const g = groupMap[k]
    // 重新按合并后统计
    const subset = merged.filter((x) => (x.groupName || '未分组') === k)
    return {
      name: g.name,
      count: subset.length,
      totalQty: subset.reduce((s, x) => s + x.qty, 0)
    }
  }).filter((g) => g.count > 0 || g.name !== '未分组')

  const totalQty = merged.reduce((s, x) => s + x.qty, 0)
  const ok = merged.length > 0
  return {
    ok,
    error: ok ? undefined : '未解析到任何「品名+数量+个」明细行',
    inventoryDate,
    sourceLabel: sourceLabel || '工作室库存',
    location: 'studio',
    groups,
    lines: merged,
    skipped,
    stats: {
      lineCount: merged.length,
      totalQty,
      groupCount: groups.filter((g) => g.name !== '未分组').length
    }
  }
}

module.exports = {
  parseStudioInventoryText,
  GROUP_ARROW_RE,
  DATE_RE,
  ITEM_RE
}
