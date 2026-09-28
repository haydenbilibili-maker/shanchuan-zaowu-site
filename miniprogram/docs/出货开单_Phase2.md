# 出货开单 / 出货单 · Phase 2（小程序）

> ⚠️ **2026-09-28 已按产品点名合并为「出货中心」**（下文「并存、不合并」作废）：
> 物理路径沿用 `/subpackages/extra/shipment-ops/index`（`?tab=create|list|overview|library`），
> `/subpackages/extra/shipment-sku/index` 仅作重定向壳。详见
> [`admin/docs/出货中心_融合_2026-09-28.md`](../../admin/docs/出货中心_融合_2026-09-28.md)。

> 蓝图：[`admin/docs/出货开单_Phase2_完成度升级_2026-09-24.md`](../../admin/docs/出货开单_Phase2_完成度升级_2026-09-24.md)  
> 算价口径：[`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md`](../../admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md)

## 硬切割

- **出货开单**（SKU）仅超管；与老「出货单」粘贴路径并存、不合并。
- 禁止挂到供应商 / 主播工作台。
- 结算状态只读；权威在工作室账单。
- 客户端不算钱；`createFromSkus` 只送 `skuId`+数量（+可选行费率/造景覆盖）。

## 入口

| 能力 | 路径 | 身份 |
|------|------|------|
| 出货开单 | `/subpackages/extra/shipment-sku/index` | 超管 |
| 出货单（观测+列表+详情） | `/subpackages/extra/shipment-ops/index` | 超管 / 店长（本店） |
| ERP 核对 | 模块 79 | 后台 |

## 物流状态机（既有）

`draft → confirmed/pending/shipped`；`pending → shipped`；`shipped → received/completed`；`received → completed`。  
详情页按 `meta.statuses[].next` 展示按钮；运单字段 `expressCompany` / `trackingNo`。

## 人眼验收

1. 开单结果卡有单号；再开一单 / 查出货单。
2. 列表快捷筛选 + 结算/核价角标。
3. 详情保存物流 → 流转已发货。
4. 算价未启用时禁提交并有提示。
