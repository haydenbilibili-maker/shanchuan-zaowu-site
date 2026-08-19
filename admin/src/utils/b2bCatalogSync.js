/**
 * B2B 供货价目 ↔ CloudBase configs/b2b_catalog
 * 与店长端 listCatalog 对齐：优先读云端 configs/b2b_catalog，fallback 本地 seed
 */
import { cdnDocGet, cdnSet } from '../cloud'
import { B2B_CATALOG } from './b2bCatalog'

const CONFIG_DOC = 'b2b_catalog'

export async function loadB2bCatalog() {
  try {
    const doc = await cdnDocGet('configs', CONFIG_DOC)
    const items = doc?.items || doc?.catalog
    if (Array.isArray(items) && items.length) {
      return { items, source: 'configs' }
    }
  } catch {
    /* fallback */
  }
  return { items: B2B_CATALOG, source: 'seed' }
}

/** 将 Admin 本地价目发布到云端，供店长端 listCatalog 读取 */
export async function publishB2bCatalog(items = B2B_CATALOG) {
  const payload = {
    items,
    catalog: items,
    updatedAt: Date.now(),
    updatedBy: 'admin',
  }
  await cdnSet('configs', CONFIG_DOC, payload)
  return payload
}
