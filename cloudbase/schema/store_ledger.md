# store_ledger · 店长后台账本（小程序 ↔ Web 中台桥接集合）

与 `finance_records`（ERP 财务核算）配对使用：

| 集合 | 读者 | 用途 |
|---|---|---|
| `finance_records` | Web `/admin/` 财务模块 | 管理层日营收、订单、净利核算 |
| **`store_ledger`** | **店长小程序 · 账本** | 门店日营收行（含渠道、毛/净额） |

## 合并键

`storeId|date`（无 storeId 时用 `default|date`）

## 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `storeId` | string | 门店 ID |
| `storeCode` | string | 如 `CCYS001` |
| `date` / `bizDate` | string | 营业日 `YYYY-MM-DD` |
| `revenue` | number | 营收（与 netAmount 对齐） |
| `grossAmount` | number | 毛流水 |
| `refundAmount` | number | 退款 |
| `netAmount` | number | 净额 |
| `orderCount` | number | 订单数 |
| `channel` | string | `offline_pos` / `miniprogram` / `other` |
| `raw` / `remark` | string | 备注或原始凭证摘要 |
| `source` | string | `web_admin` / `store_manager` / `store_ledger` |
| `_updateTime` | number | 冲突合并依据 |

## 同步行为（Web 端已实现）

1. **同步到云端**（财务页按钮）→ 写 `finance_records` + **镜像写 `store_ledger`**
2. **从云端下载** / 自动同步 → 读 `finance_records` + 读 **`store_ledger`**，按 `_updateTime` 合并 → 更新 `shanhai_v12` 与门店 bundle `sc_store_bundle_v1.revenueEntries`

## 云开发控制台

在环境 `cloud1-8gnkty5bfff9f0bf` 新建集合 **`store_ledger`**，权限参考 `cloudbase/rules/store_ledger.json`（与 finance 相同：`auth != null`）。

## 小程序侧

店长账本读写 **`store_ledger`**（`miniprogram/utils/storeLedger.js` + 店长页 `manager/index.js`）。  
云函数 `syncFinanceData` 上传时镜像 **`finance_records`**。字段与上表一致；`date` 与 `bizDate` 同时写入。

Web 端逻辑：`admin/src/utils/financeSync.js`、`admin/src/utils/storeLedgerSync.js`。
