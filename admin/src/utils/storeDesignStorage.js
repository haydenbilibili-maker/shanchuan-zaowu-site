import { db, loginToCloud, COLLECTIONS, getCollectionData } from '../cloud'

function now() {
  return Date.now()
}

export function createEmptyDesignVersion({ storeId, storeCode = '', storeName = '' } = {}) {
  return {
    storeId: storeId || '',
    storeCode,
    storeName,
    versionName: `V${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    status: 'draft', // draft | active | archived
    goals: {
      photoRateTarget: 0.7,
      conversionTarget: 0.35,
      aovTarget: 800,
    },
    constraints: {
      areaM2: null,
      ceilingHeightM: null,
      columns: '',
      wallMaterial: '',
      lighting: '',
      power: '',
      fireSafety: '',
      notes: '',
    },
    zones: [
      { key: 'entry', name: '入口区', description: '', traffic: 60, conversion: 20 },
      { key: 'exhibit', name: '展陈区', description: '', traffic: 85, conversion: 35 },
      { key: 'experience', name: '体验区', description: '', traffic: 70, conversion: 30 },
      { key: 'checkout', name: '收银区', description: '', traffic: 50, conversion: 60 },
      { key: 'rest', name: '休息区', description: '', traffic: 35, conversion: 10 },
    ],
    narrative: {
      theme: '自然美学 · 黑金质感',
      keyStory: '',
      photoSpots: [],
      interactions: [],
    },
    displayPlan: {
      summary: '',
      zonePlans: [],
    },
    bom: [],
    budget: {
      currency: 'CNY',
      capexTotal: 0,
      notes: '',
      items: [],
    },
    schedule: {
      durationDays: 7,
      milestones: [],
    },
    ai: {
      lastPrompt: '',
      lastResult: null,
      updatedAt: 0,
    },
    createdAt: now(),
    updatedAt: now(),
  }
}

export async function listDesignVersions(storeId) {
  if (!storeId) return []
  const ok = await loginToCloud()
  if (!ok) throw new Error('云端连接失败')
  try {
    return await getCollectionData(COLLECTIONS.STORE_DESIGN_VERSIONS, {
      where: { storeId },
      orderBy: { field: 'updatedAt', order: 'desc' },
      limit: 200,
    })
  } catch (e) {
    // 集合不存在或权限限制时，降级为空列表，避免页面被 SDK 内部错误打断
    const msg = e?.message || String(e)
    // cloudbase js-sdk 在某些“集合不存在/权限不足”场景会抛 TypeError: setting 'promise'
    if (
      msg.includes('not exist') ||
      msg.includes('不存在') ||
      msg.includes('collection') ||
      msg.includes("setting 'promise'") ||
      msg.includes('setting "promise"') ||
      msg.includes('promise')
    ) {
      return []
    }
    throw e
  }
}

export async function createDesignVersion(doc) {
  const ok = await loginToCloud()
  if (!ok) throw new Error('云端连接失败')
  const data = { ...(doc || {}), createdAt: now(), updatedAt: now() }
  const res = await db.collection(COLLECTIONS.STORE_DESIGN_VERSIONS).add(data)
  return { _id: res.id, ...data }
}

export async function updateDesignVersion(id, patch) {
  if (!id) throw new Error('缺少版本 id')
  const ok = await loginToCloud()
  if (!ok) throw new Error('云端连接失败')
  const next = { ...(patch || {}), updatedAt: now() }
  // cloudbase update API 在不同版本存在参数差异；此处使用对象形式更稳妥
  await db.collection(COLLECTIONS.STORE_DESIGN_VERSIONS).doc(id).update(next)
  return next
}

export async function cloneDesignVersion(source) {
  if (!source) throw new Error('缺少源版本')
  const copy = JSON.parse(JSON.stringify(source))
  delete copy._id
  copy.versionName = `${String(source.versionName || 'V').trim()}-copy`
  copy.status = 'draft'
  copy.createdAt = now()
  copy.updatedAt = now()
  return await createDesignVersion(copy)
}

export async function archiveDesignVersion(id) {
  return await updateDesignVersion(id, { status: 'archived' })
}

