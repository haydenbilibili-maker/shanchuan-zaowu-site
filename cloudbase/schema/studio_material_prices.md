# studio_material_prices · 原材料价目表（出货算价用）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）
SSOT：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md`（v1.2）§4.1

## 用途

出货单自动算价的**材料费**来源：`材料（含姿态） + 等级 → 单价`。

- **读**：小程序「逐行可编辑页」的材料选择器（经云函数 `manageStudioSettlement.searchPriceBook`）
- **写**：Admin ERP「价目表配置」模块（模块 id `81`），经 `/api/cloud-fn` 代理 →
  云函数 `manageStudioSettlement` 的 `priceBook.*`；**写权限仅超管**
- **客户端不得直连**：规则 `{"read":false,"write":false}`
- 仓库里另外两个容易混淆的东西**不要混用**：
  - `studio_raw_inventory`（原材料**库存台账**，飞书同步，有 `unitPrice` 采购价）—— 是**库存**不是价目
  - `custom_configs`（`type:'packaging'` + `priceDelta`）—— 是**C 端定制加价**，与这里的**B 端成本价**语义相反

## 控制台步骤

1. 数据库 → 新建集合 → `studio_material_prices`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/studio_material_prices.json`](../rules/studio_material_prices.json)
3. 云函数 `manageStudioSettlement` 已登记于 `miniprogram/cloudbaserc.json`（首次调用会自动建集合）

## 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | **匹配键**：材料名，**含姿态**（`独角仙展翅` / `独角仙没展翅` 是两个材料、两个价） |
| `normName` | string | ✅ | `name` 归一化值（全角→半角、去空白与零宽字符、乘号统一、拉丁大写）。**唯一约束与持久匹配用它** |
| `displayName` | string | | 展示名，空则回落 `name` |
| `aliases` | string[] | | 别名（简称/笔误），最多 20 个。`大蓝闪` → `大蓝闪蝶`；**不得跨材料重复** |
| `grade` | string | ✅ | 等级，**自由文本**（`A1`/`A2`/`极品`…），留空落 `默认` |
| `isDefaultGrade` | boolean | ✅ | 同一 `normName` 下**恰好一行**为 `true`；文本没写等级时用它取价 |
| `unitPrice` | number | ✅ | 单价（元 / `unit`），≥ 0。落库时按「分」取整 |
| `qtyPerUnit` | number | ✅ | 每件成品消耗的材料单位数，默认 `1`（蓝图裁决 19：建字段、不启用） |
| `unit` | string | | `只` / `张` / `套` |
| `category` | string | | `工具` \| `标本`（与 `studio_raw_inventory` 同枚举） |
| `status` | string | ✅ | `active` \| `inactive`；**停用行不参与匹配**（历史单靠快照不受影响） |
| `note` | string | | 备注 |
| `image` | string | | 资料图（2026-09-29 起，小程序「出货中心 → 资料」上传）：云存储 fileID（`cloud://…`，目录 `studio-pricebook/material/`），空串 = 无图；**只在入参显式带 `image` 时写**，ERP / 批量导入不传则不动。只作展示，不进算价、不进出货单快照 |
| `sort` | number | | 排序（升序） |
| `deleted` | boolean | | 软删标记；删除走 `deleted:true` 而非物理删（便于回查历史） |
| `createdAt` / `createdBy` / `updatedAt` / `updatedBy` | | | 审计 |

## 完整性约束（由 `manageStudioSettlement` 写入前校验 + `check:price-book-integrity` 守）

- 同一 `normName` 下**恰好一行** `isDefaultGrade === true`（否则「没写等级」时取不到价）
- `normName + grade` 唯一
- `unitPrice >= 0`、`qtyPerUnit > 0`
- 别名归一化后**不得跨材料冲突**

## 推荐索引

| 字段 | 说明 |
|------|------|
| `deleted` + `normName` | 载入匹配（价目表体量小，整表载入后内存匹配） |
| `status` + `sort` | 列表筛选 |

## 与算价的同源保证

归一化与完整性校验复用共享内核 `pricingCore.js`
（`manageStoreShipment/pricingCore.js` 为 canonical，本函数目录留逐字节副本，由 `check:shared-modules` 守）。
**写入方能过校验 = 算价方能匹配**，不会出现「保存时说过、算价时匹配不上」。
