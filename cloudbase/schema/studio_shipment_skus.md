# studio_shipment_skus · 出货 SKU 目录（可复用组合）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）
SSOT：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md` §16（v1.3 出货单工作流 SKU 化）

## 用途

产品负责人 2026-09-19 的改造指令：**出货单从「粘贴文本解析」改为「选 SKU 开单」**。
一个 SKU = **材料 × 等级 × 包装方式 × 尺寸** 的可复用组合，外加一个**默认手工费率**。

- **写**：`manageStudioSettlement` 的 `sku.*`，**仅超管**
- **读**：超管 / 店长（开单时要能选）
- **客户端不得直连**：规则 `{"read":false,"write":false}`

## ⚠️ 这个集合**不持有价格**

价格在**出货时**按当时的价目表（`studio_material_prices` / `studio_packaging_prices`）
配合费率算出来，并**快照进出货单**（`ops_shipments`）。理由（产品负责人裁决）：
他改价目表，**之后的新单**自动用新价；已出货的旧单保留当时的价 —— 若把价冻结在 SKU 上，
会出现"我改了价目表但 SKU 还是旧价"的困惑。
故在 `admin/src/utils/dataSources.js` 里本集合登记为 **`derived`**（引用价目表，不拥有价格）。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `skuName` | string | 可读名。**默认自动生成**：`材料[ 等级] · 包装[ 尺寸]`（如 `大蓝闪蝶 A1 · 玻璃罩 20*10`），可手改。**不含费率** —— 费率改了名字不该跟着变 |
| `skuKey` | string | **唯一键**：`规范化(材料名)\|规范化(等级)\|规范化(包装名)\|规范化(尺寸)\|造景标记`。**费率与造景金额都不进唯一键**（它们是默认属性、出货还能覆盖），否则"只想改默认费率/造景成本"会变成新建一个看起来一样的重复 SKU。**但「是否造景」要进键** —— 有造景与没造景是两种不同的货（2026-09-19 加，见蓝图 §17 裁决 36） |
| `materialId` / `materialName` | string | 指向 `studio_material_prices` 的行 |
| `materialGrade` | string | 等级（自由文本，默认 `默认`） |
| `packagingId` / `packagingName` | string | 指向 `studio_packaging_prices` 的行 |
| `packagingSize` | string | 尺寸（自由文本，默认 `默认`） |
| `laborRatePct` | number\|null | **默认手工费率**。`null` = 用全局配置；**`0` 是合法值**（这个 SKU 不收手工费），两者含义不同 |
| `hasScene` | boolean | **是否造景**（2026-09-19）。进唯一键；决定出货单里这一行的呈现方式 |
| `sceneCost` | number | **默认造景成本**（元/件）。**不进唯一键**；`hasScene=false` 时归 0。勾了造景却留空 → 创建接口**拒绝**（不静默写 0）。出货时快照进单据 `items[].sceneCost`，行上还能就地改 |
| `status` | `active\|inactive` | 停用后开单时不再出现在可选列表（历史单靠快照不受影响） |
| `sort` / `note` | | 排序 / 备注 |
| `createdAt/By` `updatedAt/By` | | 审计 |
| `deleted` | boolean | 软删标记 |

## 控制台步骤

1. 数据库 → 新建集合 → `studio_shipment_skus`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/studio_shipment_skus.json`](../rules/studio_shipment_skus.json)
3. 云函数 `manageStudioSettlement` 首次调用会自动建集合

## 推荐索引

| 字段 | 说明 |
|------|------|
| `deleted` + `status` + `sort` | 开单页拉可选列表 |
| `skuKey` | 建/改时的唯一性检查 |

## 与其它集合的关系

```
studio_material_prices ─┐
studio_packaging_prices ─┼─► studio_shipment_skus ─► ops_shipments（出货时算价 + 快照）
configs/studio_settlement ┘        （只引用）              └─► ops_settlement_bills（结算，不变）
```
