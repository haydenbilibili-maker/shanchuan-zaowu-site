/**
 * 会员等级体系 — 超管读写入口（集合 member_levels，与 Admin / makeOrder 同源）
 *
 * action:
 *   list    列表（云库 + 缺档合并）
 *   upsert  新建 / 按 level 更新 { level, name, threshold, discountRate, benefits, icon }
 *   remove  按 level 或 _id 删除
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  COLLECTION,
  normalizeLevel,
  getDefaultLevels,
  loadMemberLevels
} = require('./memberLevels')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

function remapBirthdayBenefitText(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  if (t === '生日礼遇' || t === '生日礼包') return '生日礼券'
  return t.replace(/生日礼遇|生日礼包/g, '生日礼券')
}

function normalizeBenefitsInput(raw) {
  let list = []
  if (Array.isArray(raw)) {
    list = raw
  } else if (typeof raw === 'string') {
    list = String(raw).split(/[,，]/)
  }
  return list
    .map((b) => {
      if (typeof b === 'string') return remapBirthdayBenefitText(b.trim())
      if (b && typeof b === 'object') {
        return remapBirthdayBenefitText(String(b.title || b.label || b.desc || '').trim())
      }
      return ''
    })
    .filter(Boolean)
}

function formatDiscountLabel(rate) {
  const n = Number(rate)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1) return '10 折'
  const text = (n * 10).toFixed(1).replace(/\.0$/, '')
  return `${text} 折`
}

function toClientRow(row) {
  const n = normalizeLevel(row) || row
  const discountRate = Number(n.discountRate)
  return {
    _id: row._id || '',
    level: n.level,
    name: n.name,
    threshold: n.threshold,
    discountRate,
    discount: discountRate,
    icon: n.icon || '',
    benefits: Array.isArray(n.benefits) ? n.benefits.slice() : [],
    privileges: Array.isArray(n.benefits) ? n.benefits.slice() : [],
    discountLabel: formatDiscountLabel(discountRate),
    thresholdLabel: n.threshold > 0 ? `成长值 ≥ ${n.threshold}` : '成长值门槛 0'
  }
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageMemberLevels',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard }
}

async function listLevels() {
  const { levels, source } = await loadMemberLevels(db)
  // 附带云库 _id，便于更新
  let idByLevel = new Map()
  try {
    const res = await db.collection(COLLECTION).limit(100).get()
    ;(res.data || []).forEach((doc) => {
      if (doc && doc.level != null) idByLevel.set(Number(doc.level), doc._id)
    })
  } catch (e) {
    idByLevel = new Map()
  }
  const rows = levels.map((row) => {
    const client = toClientRow(row)
    if (!client._id && idByLevel.has(client.level)) {
      client._id = idByLevel.get(client.level)
    }
    return client
  })
  return { success: true, levels: rows, source: source || 'default' }
}

async function upsertLevel(event) {
  const payload = (event && event.data) || event || {}
  let benefits = []
  if (payload.benefitsStr != null || payload.privilegesStr != null) {
    benefits = normalizeBenefitsInput(
      payload.benefitsStr != null ? payload.benefitsStr : payload.privilegesStr
    )
  } else {
    benefits = normalizeBenefitsInput(payload.benefits || payload.privileges)
  }

  const normalized = normalizeLevel({
    level: payload.level,
    name: payload.name,
    threshold: payload.threshold,
    discountRate: payload.discountRate != null ? payload.discountRate : payload.discount,
    icon: payload.icon,
    benefits
  })
  if (!normalized) return fail('等级无效')

  const docId = String((event && event.id) || payload._id || '').trim()
  const data = {
    level: normalized.level,
    name: normalized.name,
    threshold: normalized.threshold,
    discountRate: normalized.discountRate,
    icon: normalized.icon || '/assets/icons/medal_gold.png',
    benefits: normalized.benefits,
    _updateTime: Date.now()
  }

  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data })
      return { success: true, level: toClientRow({ ...data, _id: docId }) }
    }

    const existing = await db.collection(COLLECTION).where({ level: normalized.level }).limit(1).get()
    if (existing.data && existing.data.length) {
      const id = existing.data[0]._id
      const prevIcon = existing.data[0].icon
      if (!payload.icon && prevIcon) data.icon = prevIcon
      await db.collection(COLLECTION).doc(id).update({ data })
      return { success: true, level: toClientRow({ ...data, _id: id }) }
    }

    const added = await db.collection(COLLECTION).add({
      data: { ...data, _createTime: Date.now() }
    })
    return { success: true, level: toClientRow({ ...data, _id: added._id }) }
  } catch (e) {
    console.error('manageMemberLevels upsert', e)
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    return fail(e.message || '保存失败')
  }
}

async function removeLevel(event) {
  const docId = String((event && event.id) || '').trim()
  const levelNum = Number(event && event.level)
  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).remove()
      return { success: true }
    }
    if (Number.isFinite(levelNum)) {
      const existing = await db.collection(COLLECTION).where({ level: levelNum }).limit(1).get()
      if (existing.data && existing.data.length) {
        await db.collection(COLLECTION).doc(existing.data[0]._id).remove()
        return { success: true }
      }
      return fail('未找到该等级')
    }
    return fail('缺少 id 或 level')
  } catch (e) {
    console.error('manageMemberLevels remove', e)
    return fail(e.message || '删除失败')
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = String((event && event.action) || 'list')

  try {
    if (action === 'list') {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return await listLevels()
    }
    if (action === 'upsert') {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return await upsertLevel(event)
    }
    if (action === 'remove') {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return await removeLevel(event)
    }
    // 无鉴权只读兜底（一般不用；列表也要求超管）
    if (action === 'defaults') {
      return {
        success: true,
        levels: getDefaultLevels().map((row) => toClientRow(row)),
        source: 'default'
      }
    }
    return fail('未知 action')
  } catch (e) {
    console.error('manageMemberLevels', e)
    return fail(e.message || '服务异常')
  }
}
