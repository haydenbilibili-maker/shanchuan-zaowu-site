/**
 * 会员画像 / CRM 等模块共用的 CDN 数据拉取（避免 bundle db.get().catch 报错）
 */
import { fetchCollectionLimit, fetchCollectionSorted, fetchCollectionWhere } from '../cloud'

export async function loadPortraitSourceData(options = {}) {
  const { userLimit = 1000, orderLimit = 1000, behaviorLimit = 1000 } = options
  const [users, orders, behaviors] = await Promise.all([
    fetchCollectionSorted('users', {
      limit: userLimit,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0),
    }),
    fetchCollectionLimit('orders', { limit: orderLimit }),
    fetchCollectionLimit('user_behaviors', { limit: behaviorLimit }),
  ])
  return { users, orders, behaviors }
}

export async function loadPortraitForOpenid(openid) {
  if (!openid) return { users: [], orders: [], behaviors: [] }
  const [users, orders, behaviors] = await Promise.all([
    fetchCollectionWhere('users', { _openid: openid }, 1),
    fetchCollectionWhere('orders', { _openid: openid }, 50),
    fetchCollectionWhere('user_behaviors', { userId: openid }, 200),
  ])
  return { users, orders, behaviors }
}
