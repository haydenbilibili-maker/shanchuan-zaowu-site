/**
 * 内容开关：showStoredValue（对齐 getContentDisplayFlags）
 */
const FLAGS_COLLECTION = 'content_display_flags'

async function loadActiveFlagsDoc(db) {
  try {
    const res = await db.collection(FLAGS_COLLECTION)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    try {
      const res = await db.collection(FLAGS_COLLECTION).limit(20).get()
      const rows = (res.data || [])
        .filter((d) => d.status !== 'inactive')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      return rows[0] || null
    } catch (err) {
      return null
    }
  }
}

async function isStoredValueEnabled(db) {
  const doc = await loadActiveFlagsDoc(db)
  return !!(doc && doc.showStoredValue === true)
}

async function assertStoredValueEnabled(db) {
  const enabled = await isStoredValueEnabled(db)
  if (!enabled) {
    return {
      ok: false,
      code: 'STORED_VALUE_DISABLED',
      msg: '我的钱包暂未开放'
    }
  }
  return { ok: true }
}

module.exports = {
  FLAGS_COLLECTION,
  isStoredValueEnabled,
  assertStoredValueEnabled
}
