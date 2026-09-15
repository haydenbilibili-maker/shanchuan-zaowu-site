/**
 * 馆藏 / 选品用分类树 — 服务端分页读 categories，与 Admin 写入同源
 */
const cloud = require('wx-server-sdk')
const { loadCategoryPickerTree } = require('./categoryTree')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const canonicalOnly = event && event.canonicalOnly !== false
  try {
    const tree = await loadCategoryPickerTree(db, { canonicalOnly })
    return {
      success: true,
      categoryRoots: tree.categoryRoots || [],
      categorySubMap: tree.categorySubMap || {},
      rootNames: tree.rootNames || []
    }
  } catch (e) {
    console.error('listCategories', e)
    return { success: false, msg: e.message || '分类加载失败' }
  }
}
