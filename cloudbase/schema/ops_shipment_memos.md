# ops_shipment_memos · 飞书出货草稿 / 已结清历史备忘

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）
SSOT：`miniprogram/docs/出货中心首批SKU导入_2026-10-09.md` §8–§9

## 用途

产品负责人 2026-10-09 两条指令：
- 「将 9.21 至今的出货单全部写入小程序出货中心，作为**草稿**存入草稿箱；等待后续人工审核和修改」→ `kind: 'draft'`
- 「将 9.21 之前的出货单也全部写入，作为**已经结清账单的历史数据备忘**」→ `kind: 'history'`

- **写**：`manageStoreShipment` 的 `memo.*`（**仅超管**）+ 一次性导入脚本 `scripts/import-shipment-memos.mjs`
- **读**：超管（小程序 出货中心 →「单据」→ 草稿箱 / 历史）
- **客户端不得直连**：规则 `{"read":false,"write":false}`

## ⚠️ 为什么是独立集合，而不是 `ops_shipments` 加个状态

`ops_shipments` 的读取方（`shipmentDashboard.js` 看板、`getStudioDashboard` 日报、账单、对账、应收）
**只排除 `cancelled`**，草稿或历史写进去就会被计入件数和金额统计。独立集合 = 任何统计都读不到它。
守卫 `miniprogram/scripts/check-shipment-sku-page.mjs` G 节锁定：除 `manageStoreShipment/shipmentMemos.js`
与本集合三处登记外，**任何云函数 / ERP 代码都不得引用本集合名**。

草稿唯一的正式出口是 `memo.confirmDraft`：它调用的就是正式开单 `createFromSkus`
（金额、通知、结算口径与直接开单完全一致），成功后本行标 `confirmed` 并记 `confirmedShipmentId`。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | string | `draft` / `history` |
| `status` | string | 草稿：`draft` → `confirming`（转正式进行中，防双击）→ `confirmed`；历史恒为 `history` |
| `source` | string | `feishu-draft` / `feishu-history` |
| `historical` / `settled` | bool | 历史备忘恒为 `true`（**只是备忘标记，不写任何账单/结算字段**）；草稿为 `false` |
| `storeId` / `storeName` / `storeMatched` | string / string / bool | 门店沿用 `guessStoreId` 归属规则；认不出时 `storeMatched:false`、`storeId:''`（草稿在详情里选门店） |
| `customerName` | string | 飞书「客户名称」原文 |
| `shipmentDate` | string | `YYYY-MM-DD`（飞书毫秒时间戳 +8h 取日期） |
| `note` | string | 备注（草稿可改） |
| `lines[]` | array | 见下 |
| `importBatch` | string | `feishu-drafts-2026-10-09` / `feishu-history-pre-0921`（回滚按它删） |
| `importKey` | string | 幂等键 `kind\|日期\|客户原文`，同键不重复写 |
| `feishuRecordIds` | string[] | 本单包含的飞书出货表记录 id |
| `confirmedShipmentId` / `confirmedAt` / `confirmedBy` | string / number / string | 草稿转正式后回填 |
| `deleted` / `deletedAt` | bool / number | 软删 |
| `createdAt` / `updatedAt` / `createdBy` / `updatedBy` | | |

### `lines[]`

| 字段 | 说明 |
|------|------|
| `key` | 行键（= 飞书记录 id），编辑按它定位 |
| `feishuRecordId` / `rawName` / `rawSpec` / `qty` / `feishuUnitPrice` / `feishuAmount` / `feishuNote` | 飞书原文，**导入后不改**（qty 草稿可改） |
| `match` | `sku`（已对应到 SKU）/ `none`（**待匹配**） |
| `skuId` / `skuName` / `matchNote` / `hintKeyword` | 对应的 SKU；`hintKeyword` 是打开 SKU 选择器时的预填搜索词 |
| `refUnitPrice` / `refAmount` / `diff` | 系统按当时价目表的参考价与「参考 − 飞书」差额，**仅作对照**；算不出为 `null` |
| `removed` | 草稿里人工删除的行（保留原文，转正式时跳过） |

## 统计口径

本集合**不进任何统计**（看板、日报、账单、对账、应收、库存、通知）。历史备忘的金额以飞书原始金额为准，只展示不汇入。
