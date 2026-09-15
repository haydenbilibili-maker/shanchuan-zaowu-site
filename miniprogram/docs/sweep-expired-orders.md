/**
 * 超时待支付清扫（sweepExpiredOrders）
 *
 * ## 行为
 * - 每 5 分钟扫描 `status=pending_pay` 且 `payExpireTime < now` 的订单
 * - 原子置 `void`（cancelReason=expired_sweep）后：钱包回账 → 释放库存预占 → 解锁券 → 站内信
 * - 顺带修复已 void 但 `stockHoldReleased=false` 的预占残留
 *
 * ## 部署
 * ```bash
 * # 微信开发者工具 CLI（端口以 IDE 实际监听为准）
 * cli cloud functions deploy --env <envId> --names sweepExpiredOrders --remote-npm-install --project . --port <port>
 * ```
 * 部署后在云开发控制台 → 云函数 → sweepExpiredOrders → 触发器，确认
 * `sweepExpiredPendingOrders`（cron：每 5 分钟）已启用。
 *
 * ## 手动触发
 * ```js
 * wx.cloud.callFunction({ name: 'sweepExpiredOrders', data: { action: 'sweep', limit: 40 } })
 * ```
 *
 * ## 索引
 * 建议为 `orders` 建复合索引：status ASC + payExpireTime ASC。
 * 无索引时函数会回落为按 status 拉取再本地过滤。
 *
 * ## 边界
 * - 不处理礼赠填址超时 / 退款（逆向链路）
 * - 与 cancelOrder(expired) 并存；客户端打开订单列表仍可即时清自己的过期单
 */
