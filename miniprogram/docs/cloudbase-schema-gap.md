# CloudBase 结构说明缺口

> 对应审计 **P2**：有权限规则、缺 `cloudbase/schema/*.md` 结构说明。  
> 规则源（小程序仓）：`database-rules/*.json`  
> Schema 权威目录（Admin 仓）：`shanchuanzaowu/cloudbase/schema/`

## 缺口清单（规则在小程序仓 / schema 在 Admin 仓对照）

下列集合在 `database-rules/` 有规则文件，但 Admin `cloudbase/schema/` **原先缺失**；**2026-09-14 已补最小结构说明 stub**（字段以代码实证为准，可后续加厚）：

| 集合 | schema 路径 |
|------|-------------|
| activities | `cloudbase/schema/activities.md` |
| articles | `cloudbase/schema/articles.md` |
| banners | `cloudbase/schema/banners.md` |
| bookings | `cloudbase/schema/bookings.md` |
| categories | `cloudbase/schema/categories.md` |
| cms_wikis | `cloudbase/schema/cms_wikis.md` |
| collection_folders | `cloudbase/schema/collection_folders.md` |
| collections | `cloudbase/schema/collections.md` |
| configs | `cloudbase/schema/configs.md` |
| curated_collections | `cloudbase/schema/curated_collections.md` |
| custom_inquiries | `cloudbase/schema/custom_inquiries.md` |
| daily_revenues | `cloudbase/schema/daily_revenues.md` |
| framer_recruit_applications | `cloudbase/schema/framer_recruit_applications.md` |
| identification_feedback | `cloudbase/schema/identification_feedback.md` |
| identification_records | `cloudbase/schema/identification_records.md` |
| likes | `cloudbase/schema/likes.md` |
| orders | `cloudbase/schema/orders.md` |
| pet_memorial_orders | `cloudbase/schema/pet_memorial_orders.md` |
| point_records | `cloudbase/schema/point_records.md` |
| products | `cloudbase/schema/products.md` |
| user_collection | `cloudbase/schema/user_collection.md` |
| user_coupons | `cloudbase/schema/user_coupons.md` |
| users | `cloudbase/schema/users.md` |
| vip_levels | `cloudbase/schema/vip_levels.md` |

已有较完整 / 已加厚 schema：`orders.md`、`products.md`、`users.md`、`bookings.md`、`store_ledger.md`、`care_guides.md`、`finance_records.md`、`framers.md`、`rewards.md` 等。

## 维护

新增集合时同步三处：`database-rules/<name>.json` ↔ Admin `cloudbase/rules/` ↔ `cloudbase/schema/<name>.md`。
