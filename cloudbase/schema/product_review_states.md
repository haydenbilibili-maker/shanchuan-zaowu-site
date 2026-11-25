# product_review_states · 藏品版本审核快照（白名单 / 审核下架 / 恢复）

> 2026-11-25 新增（产品负责人「藏品-风险管理 → 新版本审核一键上架与下架」）。
> 只有一份文档 `_id = main`，由云函数 `manageProductReview` 独占读写（仅超管可调用）。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写 |
| 云函数（服务端 SDK） | ✅ `manageProductReview` 读写（每次写动作先写 `staff_audit_logs`） |

规则文件：`cloudbase/rules/product_review_states.json` = `{ "read": false, "write": false }`

## 字段

- `whitelistIds` 审核白名单：生成那一刻**在架**的全部商品 id（= 已审核无风险集合）
- `whitelistAt` / `whitelistBy` 白名单生成时间与操作者 openid
- `reviewOffIds` 最近一次「审核下架」被我们下架的 id（**只记成功的**，失败留待重试）
- `reviewOffAt` 进入审核下架的时间
- `status` `idle` | `off`（`off` = 正处于审核下架状态，可用「审核上架」恢复）
- `createTime` / `updateTime`

## 写入方

`manageProductReview` 的 `buildWhitelist` / `offShelfForReview` / `restoreAfterReview` 三个动作。

## 硬规则（2026-11-25 产品负责人）

首页四个馆（昆虫馆 / 动物馆 / 植物馆 / 海洋馆）**每个馆至少要有 1 件在架商品**：
生成白名单与审核下架都会先算一遍，任一馆为空则拒绝执行并返回空馆名单。

## 商品侧字段

- 进入审核下架：`isOffShelf: true`、`shelfReviewHidden: true`、`shelfUpdatedAt`
- 恢复上架：`isOffShelf: false`、`shelfReviewHidden: false`、`shelfUpdatedAt`
- `shelfReviewHidden` 是幂等安全阀：恢复只上架「我们下的」，审核前已下架的不动。

## 守卫

`check:review-shelf`（R1–R10 + 3 条注入）。
