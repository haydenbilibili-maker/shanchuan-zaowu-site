# 采购商工作台 · 可交付终版（小程序 B2B）

> 蓝图：[`admin/docs/供应商工作台_Phase1_技术蓝图_2026-09-24.md`](../../admin/docs/供应商工作台_Phase1_技术蓝图_2026-09-24.md)  
> 路径根：`/subpackages/extra/supplier/`（Hub 标题「采购商工作台」）

## 硬切割

禁止挂接 `purchase-ops` / `shipment-ops` / `studio-bills` 及工作室集合账本。

## 终版能力清单

| 能力 | 状态 | 说明 |
|------|------|------|
| 价目图文选购 + 加购 | ✅ 可用 | `price_list_items` active |
| 确认采购单 + 联系人必填 | ✅ 可用 | 直写 `purchase_orders` · `source=buyer_workbench` |
| 我的采购单列表 / 筛选 / 履约文案 | ✅ 可用 | 缺索引时客户端降级排序 |
| 待对公登记 | ⚠️ 需部署云函数 | `payB2bPurchase` action=`markOfflinePending` |
| 微信支付拉起 | ⚠️ 需部署 + 商户号 | `payB2bPurchase` + `b2bPayCallback` + `WX_PAY_SUB_MCH_ID` |
| 超管验收标记已付 | ⚠️ 需环境开关 | `B2B_ALLOW_PREVIEW_MARK=1` 或 `ALLOW_MOCK_PAY=1` |
| 供货方需求/发货/结算真数据 | ⚠️ 最小契约 | `party=supplier_fulfillment` + `supplierId` 只读；演示仅超管；写回待下版 |
| 独立 buyer 角色进 staffGuard | ✅ 已写入 | manageStaff 花名册可选 buyer/franchisee/channel/supplier |

## 部署清单（支付）

1. 微信开发者工具 → 云开发 → 上传并部署：
   - `cloudfunctions/payB2bPurchase`
   - `cloudfunctions/b2bPayCallback`
2. 两函数环境变量（可与 C 端共用商户号，**回调名不同**）：
   - `WX_PAY_SUB_MCH_ID` = 子商户号  
   - 可选：`B2B_ALLOW_PREVIEW_MARK=1`（超管验收标记）  
3. 确认 `cloudbaserc.json` 已登记上述函数名（仓库已含）  
4. **勿**改 `payCallback` / `payOrder`；B2B 回调必须是 `b2bPayCallback`  
5. 真机验收 `requestPayment`（开发者工具常不完整）

## 入口与身份

| 身份 | 如何进 | Hub 表现 |
|------|--------|----------|
| 超管 | 「我的」瓷砖 | 预览；供货方区可折叠；可开演示 |
| `buyer` / `franchisee` / `channel` | 同瓷砖（客户端） | 仅采购主路径；无供货方区 |
| `supplier` | 同瓷砖 | 供货方区默认展开 |
| 普通店长 | 无入口 | — |

口令文案：`B2B工作台验证`。

## 采购商人眼验收（全路径）

1. 「我的」→ **采购商工作台** → 见流程条 1–2–3 与「向总部采购」  
2. **供货价目选购** → 缩略图 → 数量 → 加入 → 底栏「去下单」  
3. **确认采购单** → 填联系人（必填）→「仅下单」或「下单并支付」  
4. **我的采购单** → 结果横幅 + 支付芯片 +「下一步」说明  
5. 待支付：微信支付 / 待对公；无商户号或未部署时见明确指引（非静默失败）  
6. Admin「订货履约」出现来源「采购商台」  
7. 确认无法进入工作室采购/出货/账单页  

## 需产品负责人点名

1. ~~`buyer`/`franchisee`/`channel` 写入 staffGuard / manageStaff~~ → **2026-09-24 已做**  
2. B2B 是否长期共用 C 端 `WX_PAY_SUB_MCH_ID`  
3. ~~对公到账 Admin 确认 UI~~ → **2026-09-24 已做**  
4. 区间价 SKU 下单规则  
5. 供货方确认/发货**写回**（本批仅只读契约）  
6. 普通店长（自营店）是否开放本台  

## 稳定期说明

未改 `makeOrder` / `payOrder` / `payCallback` / C 端 `orders` 契约。支付为旁路新云函数。
