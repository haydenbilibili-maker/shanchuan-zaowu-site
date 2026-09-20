/**
 * 装裱方式 / 制作工艺 **选项字典** 的读取与维护
 *
 * 集合 `product_taxonomy`（单文档，`_id: 'default'`）；**代码默认值 + 云端覆盖**：
 *   · 读（无 action，公开）：回云端文档；文档不存在 / 读失败 → `doc: null`，
 *     由**客户端**退回 `config/productTaxonomy.js` 的代码默认值。
 *   · 写（`action: 'save'`，**仅超管**）：覆盖整份字典，服务端做四项校验。
 *
 * ⚠️ 为什么默认值**不放在这里**：本仓的枚举已经有 5 处副本
 * （`config/productTaxonomy.js` / `manageProducts/productTaxonomy.js` /
 *   `manageArtisanCommission` / `getShippingRules/defaults` / `admin/src/utils/`）。
 * 再往云函数里抄第六份，只会让"改一处漏四处"的概率继续变大。
 * 这里**只做存取**，默认值的唯一事实源仍然是 `config/productTaxonomy.js`。
 *
 * ⚠️ 删除保护（最重要的一条）：装裱方式决定**运费档**（裁决 40/41/41b/41c/48）。
 * 把一个"还有商品在用"的选项删掉，那些商品的 craftType 就指向一个不存在的值 ——
 * 运费会静默落进"其它类型"那一档，而页面上什么都看不出来。
 * 所以服务端**必须**自己数一遍在用量再决定是否放行，不能信客户端。
 */
const cloud = require('wx-server-sdk')
const { assertStaff } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'product_taxonomy'
const DOC_ID = 'default'
/** 与客户端同一口径：锚定"这些值决定运费档"的字段 */
const CRAFT_TYPE_FIELD = 'craftType'
const CRAFT_PROCESS_FIELD = 'craftProcess'
const MAX_OPTIONS = 40
const VALUE_RE = /^[a-z][a-z0-9_]{0,31}$/
const LABEL_MAX = 16

const ok = (data) => Object.assign({ success: true }, data || {})
const fail = (msg, code) => ({ success: false, msg, code: code || 'ERROR' })

/** 归一化一组选项：只留 {value,label}，去掉空白与重复（同一个 value 只留第一条） */
function normalizeOptions (raw) {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    const value = String((item && item.value) || '').trim().toLowerCase()
    const label = String((item && item.label) || '').trim()
    if (!value && !label) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push({ value, label })
  }
  /**
   * 「其它」必须排**最后**（产品负责人 2026-09-21）。
   * 在这里排一次 = **存进云端的顺序就定了**，所有读这份字典的地方（C 端筛选、字段维护 picker、
   * 选项维护编辑器、ERP…）看到的是同一个顺序。稳定排序：其余项保持后台的编排。
   * ⚠️ 后台新增的选项会插在「其它」后面（线上字典实测 `…, other, custom_1 玻璃瓶, custom_2 塑封`），
   *    顾客翻筛选时「其它」夹在中间很别扭，也会让人以为后面还有"更正式"的分类。
   */
  const rest = out.filter((o) => o.value !== 'other')
  const tail = out.filter((o) => o.value === 'other')
  return rest.concat(tail)
}

/** 四项校验；返回 null = 通过，否则返回给用户看的那句话 */
function validateDictionary (types, processes) {
  for (const [name, list] of [['装裱方式', types], ['制作工艺', processes]]) {
    if (!list.length) return `${name}至少要留一个选项（空清单会让所有商品都变成"未标注"）`
    if (list.length > MAX_OPTIONS) return `${name}最多 ${MAX_OPTIONS} 项（当前 ${list.length}）`
    for (const opt of list) {
      if (!VALUE_RE.test(opt.value)) {
        return `${name}的选项值「${opt.value || '(空)'}」不合法：只能是 a-z / 0-9 / 下划线，且以字母开头`
      }
      if (!opt.label) return `${name}里「${opt.value}」缺中文名`
      if ([...opt.label].length > LABEL_MAX) return `${name}「${opt.label}」的中文名超过 ${LABEL_MAX} 个字`
    }
    // 兜底项必须存在：存量商品里有 craftType/craftProcess 为空或历史值的，界面上要有地方落
    if (!list.some((o) => o.value === 'other')) return `${name}必须保留「其它」（value = other）作为兜底`
  }
  const tSet = new Set(types.map((o) => o.value))
  if (tSet.size !== types.length) return '装裱方式里有重复的选项值'
  const pSet = new Set(processes.map((o) => o.value))
  if (pSet.size !== processes.length) return '制作工艺里有重复的选项值'
  return null
}

/** 数一条选项值在藏品库里被用了多少件（用哪张表数，取决于它属于哪本字典） */
async function countInUse (field, value) {
  try {
    const res = await db.collection('products').where({ [field]: value }).count()
    return Number(res.total) || 0
  } catch (e) {
    // 数不出来就**不放行删除**：删错比拒绝更贵（那些商品的运费会静默落档）
    return -1
  }
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'get')

  if (action === 'get') {
    try {
      const res = await db.collection(COLLECTION).doc(DOC_ID).get()
      const doc = (res && res.data) || null
      if (!doc) return ok({ doc: null })
      return ok({
        doc: {
          craftTypes: normalizeOptions(doc.craftTypes),
          craftProcesses: normalizeOptions(doc.craftProcesses),
          updatedAt: doc.updatedAt || 0,
          updatedBy: String(doc.updatedBy || '')
        }
      })
    } catch (e) {
      // 文档不存在（集合还没建 / 还没保存过）也走这一支：**不是错误**，客户端退回代码默认值
      const miss = /not exist|does not exist|DOCUMENT_NOT_FOUND|cannot find document/i.test(String(e && e.errMsg || e && e.message || ''))
      if (miss) return ok({ doc: null })
      console.warn('product taxonomy read failed', e)
      return ok({ doc: null, degraded: true })
    }
  }

  if (action !== 'save') return fail('未知操作 ' + action, 'BAD_ACTION')

  const { OPENID } = cloud.getWXContext()
  const guard = await assertStaff(db, OPENID, { requireSuperAdmin: true, adminOpsKey: event && event.adminOpsKey })
  if (!guard.ok) return fail(guard.msg || '无权限', guard.code || 'FORBIDDEN')

  const types = normalizeOptions(event && event.craftTypes)
  const processes = normalizeOptions(event && event.craftProcesses)
  const invalid = validateDictionary(types, processes)
  if (invalid) return fail(invalid, 'INVALID')

  // ── 删除保护：先读旧文档，逐个数"被删掉且还有商品在用"的值 ──
  let prev = null
  try {
    const r = await db.collection(COLLECTION).doc(DOC_ID).get()
    prev = (r && r.data) || null
  } catch (e) { /* 没有旧文档 = 首次保存，无需保护 */ }
  if (prev) {
    const checks = [
      { field: CRAFT_TYPE_FIELD, name: '装裱方式', before: normalizeOptions(prev.craftTypes), after: types },
      { field: CRAFT_PROCESS_FIELD, name: '制作工艺', before: normalizeOptions(prev.craftProcesses), after: processes }
    ]
    for (const c of checks) {
      const keep = new Set(c.after.map((o) => o.value))
      for (const old of c.before) {
        if (keep.has(old.value)) continue
        const n = await countInUse(c.field, old.value)
        if (n < 0) return fail(`数不出「${old.label || old.value}」的使用量，为安全起见没有删除任何东西（请重试）`, 'COUNT_FAILED')
        if (n > 0) {
          return fail(`「${old.label || old.value}」还有 ${n} 件商品在用，不能删除。请先把这些商品改成别的${c.name}。`, 'IN_USE')
        }
      }
    }
  }

  const now = Date.now()
  const payload = {
    craftTypes: types,
    craftProcesses: processes,
    updatedAt: now,
    updatedBy: String(OPENID || '')
  }
  try {
    try {
      await db.collection(COLLECTION).doc(DOC_ID).set({ data: payload })
    } catch (e) {
      // 集合不存在 → 建集合后重试一次（CloudBase 的 set 不会隐式建集合）
      await db.createCollection(COLLECTION).catch(() => {})
      await db.collection(COLLECTION).doc(DOC_ID).set({ data: payload })
    }
  } catch (e) {
    console.error('product taxonomy save failed', e)
    return fail('保存失败：' + String((e && e.errMsg) || (e && e.message) || e), 'WRITE_FAILED')
  }
  return ok({ doc: payload })
}
