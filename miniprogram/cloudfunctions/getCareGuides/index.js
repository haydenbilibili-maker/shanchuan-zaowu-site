const cloud = require('wx-server-sdk')
const { GUIDES, CATEGORY_CARDS, GENERAL_TIPS } = require('./defaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { category, guideId } = event || {}

  try {
    let query = db.collection('care_guides').where({ status: 'active' })
    if (guideId) {
      query = db.collection('care_guides').where({ guideId, status: 'active' })
    } else if (category) {
      query = db.collection('care_guides').where({ category: String(category).toUpperCase(), status: 'active' })
    }
    const res = await query.limit(20).get()
    if (res.data && res.data.length) {
      return {
        success: true,
        guides: res.data,
        categoryCards: CATEGORY_CARDS,
        generalTips: GENERAL_TIPS,
        source: 'db'
      }
    }
  } catch (e) {
    console.warn('care_guides read failed:', e.message)
  }

  if (category) {
    const cat = String(category).toUpperCase()
    const guide = GUIDES[cat] || GUIDES.GENERAL
    return { success: true, guide, guides: Object.values(GUIDES), source: 'default' }
  }

  return {
    success: true,
    guides: Object.values(GUIDES),
    categoryCards: CATEGORY_CARDS,
    generalTips: GENERAL_TIPS,
    source: 'default'
  }
}
