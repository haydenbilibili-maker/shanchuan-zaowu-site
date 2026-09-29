# studio_packaging_prices · 包装方式价目表（出货算价用）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）
SSOT：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md`（v1.2）§4.2

## 用途

出货单自动算价的**包装费**来源：`包装方式 + 尺寸 → 单价`。

- **读**：小程序「逐行可编辑页」的包装选择器（经 `manageStudioSettlement.searchPriceBook`）
- **写**：Admin ERP「价目表配置」模块（模块 id `81`）；**写权限仅超管**
- **客户端不得直连**：规则 `{"read":false,"write":false}`
- ⚠️ **不要与 `custom_configs` 混用**：那里 `type:'packaging'` 的 `priceDelta` 是**C 端定制加价**，
  本表是**B 端成本价**，语义相反。两者严禁互相回写。

## 控制台步骤

1. 数据库 → 新建集合 → `studio_packaging_prices`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/studio_packaging_prices.json`](../rules/studio_packaging_prices.json)
3. 云函数 `manageStudioSettlement` 已登记于 `miniprogram/cloudbaserc.json`（首次调用会自动建集合）

## 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | **匹配键**：包装方式（`玻璃罩` / `冰箱贴` / `框` / `造景`） |
| `normName` | string | ✅ | `name` 归一化值，**唯一约束与持久匹配用它** |
| `displayName` | string | | 展示名，空则回落 `name` |
| `aliases` | string[] | | 别名，最多 20 个。`相框` → `框`；**不得跨包装重复** |
| `size` | string | ✅ | 尺寸，**自由文本**（`20*10` / `15*8`），留空落 `默认`；乘号已在归一化时统一 |
| `isDefaultSize` | boolean | ✅ | 同一 `normName` 下**恰好一行**为 `true`；文本没写尺寸时用它取价 |
| `unitPrice` | number | ✅ | 包装件单价（元 / `unit`），≥ 0 |
| `qtyPerUnit` | number | ✅ | 每件成品消耗的包装数，默认 `1` |
| `unit` | string | | `个` / `套` |
| `status` | string | ✅ | `active` \| `inactive`；停用行不参与匹配 |
| `note` | string | | 备注 |
| `image` | string | | 资料图（2026-09-29 起）：云存储 fileID（`cloud://…`，目录 `studio-pricebook/packaging/`），空串 = 无图；只在入参显式带 `image` 时写。只作展示，不进算价、不进出货单快照 |
| `sort` | number | | 排序（升序） |
| `deleted` | boolean | | 软删标记 |
| `createdAt` / `createdBy` / `updatedAt` / `updatedBy` | | | 审计 |

## 完整性约束

与原材料价目表同口径（共享 `pricingCore.validatePriceBook`）：

- 同一 `normName` 下**恰好一行** `isDefaultSize === true`
- `normName + size` 唯一
- `unitPrice >= 0`、`qtyPerUnit > 0`
- 别名归一化后**不得跨包装冲突**

## 推荐索引

| 字段 | 说明 |
|------|------|
| `deleted` + `normName` | 载入匹配 |
| `status` + `sort` | 列表筛选 |

## 与「裸名报红」的关系

出货单文本里**没写包装**的行（如 `华艳色蟌-2`）按裁决 3 **报红要求人工选包装**，
本表就是让人工选择时的候选来源。不存在「默认包装」兜底 —— 这是产品的刻意选择，不是缺陷。
