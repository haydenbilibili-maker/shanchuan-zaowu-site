/**
 * 确保评价集合 comments 存在（微信云开发首次写入也会自动建表；
 * 本脚本用于显式创建 + 常用索引提示）。
 *
 * 用法：
 *   node scripts/ensure-comments-collection.cjs
 *
 * 需已登录 CloudBase CLI，环境 cloud1-8gnkty5bfff9f0bf。
 */
const { execSync } = require('child_process')

const ENV_ID = process.env.TCB_ENV || 'cloud1-8gnkty5bfff9f0bf'

console.log(`确保 comments 集合（env=${ENV_ID}）…`)
console.log(`
说明：
1. 集合名：comments
2. 首条评价由 submitComment 写入时会自动创建集合（若尚未存在）
3. 建议在云开发控制台为以下字段建组合索引（提升查询）：
   - targetType + targetId + status + createdAt
   - orderId + userId + targetType + status
   - status + createdAt（店长审核列表）

字段约定（商品评价）：
  targetType: 'product'
  targetId: productId
  orderId: 已签收订单 ID
  userId: openid
  rating: 1-5
  content, images[]
  status: pending | approved | hidden | rejected
  productTitle, likes, likedBy, merchantReply, isPinned
`)

try {
  // 探测环境连通；集合创建以控制台/首次写入为准
  execSync(`tcb env:list`, { stdio: 'inherit' })
  console.log('\n请在云开发控制台确认 comments 集合；若不存在，提交一条测试评价即可自动创建。')
} catch (e) {
  console.warn('CLI 探测失败，可忽略：首次 submitComment 成功写入时会自动建集合。')
}
