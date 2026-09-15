# 数据库安全规则（版本化）

环境：`cloud1-8gnkty5bfff9f0bf`

本目录存放 **NoSQL 集合自定义安全规则** 源文件。规则只约束客户端直连 `wx.cloud.database()`；云函数不受限。

## 应用

```bash
node scripts/configure-products-orders-security-rules.cjs
node scripts/configure-users-coupons-security-rules.cjs
node scripts/configure-ops-content-security-rules.cjs
node scripts/configure-recent-collections-security-rules.cjs
# 只读快照：加 --dry-run
# ERP 仍 CDN 直写的集合：加 --include-deferred（慎用）
```

## 集合级规则一览

| 集合 | 语义 | 写入路径 |
|------|------|----------|
| `products` / `orders` | 读开放/登录；`write:false` | `manageProducts` / 订单云函数 |
| `users` / `user_coupons` | 仅本人读；`write:false` | `upsertUserProfile` 等 |
| `banners` `categories` `activities` `framers` `articles` `cms_wikis` | 公开读；`write:false` | `manageStoreContent` |
| `rewards` `care_guides` `custom_*` `pet_memorial_orders` `bookings` `configs` `framer_recruit_applications` | 登录可读；`write:false` | `manageStoreContent` / `verifyBooking` / 对应云函数 |
| `likes` `collections` `collection_folders` `identification_*` `user_collection` | openid 隔离（C 端直写保留） | 客户端本人范围 |
| `vip_levels` `curated_collections` `point_records` | 读可控；写关或 openid | 会员/积分云函数 |


| `store_ledger` `daily_revenues` `finance_records` | 登录可读；`write:false` | `syncFinanceData`（店长 `upsert_store_ledger_day` / 删日） |
| `collections` `likes` `collection_folders` | **本人 openid 读写**（购物车/点赞保留客户端能力；文章赞藏已走 `toggleCollection`） | 商品收藏(`favorite`)/想要候补(`wishlist`) 优先 `toggleCollection`；定金意向走 `createDepositIntent` → `deposit_intents` |
| `deposit_intents` | **仅本人可读**；`write:false` | `createDepositIntent`（wishlist 页可本人直读展示标记） |
| 工作室/采购/出货/员工域等（见 `configure-recent-collections-security-rules.cjs`） | **read/write false** 或登录可读禁写 | 对应 manage* / getStudioDashboard 云函数 |
| `analytics_daily` | 登录可读；**write:false** | `trackUserBehavior` 写；ERP 摘要走 `getAnalyticsDashboard.behaviorSnippet` |

### 为何 likes/collections 不完全 write:false？

购物车改数量、文件夹整理仍依赖本人直写；若一律改云函数需额外迁移 `pages/cart` 全链路。当前规则已禁止改他人文档。文章点赞因需改 `articles.stats`（集合已不可客户端写），已强制经 `toggleCollection.engage=articleLike`。

## 注意

- 店长页运营写库必须走 `manageStoreContent`（已 staffGuard）。
- 字段级愿望稿见 `*.field-level.desired.json`（平台暂无法可靠落库含 `request.data` 的规则）。
