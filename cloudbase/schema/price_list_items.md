# price_list_items · 官网线下供货报价单

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 官网：`/price-list/` 运行时匿名登录后读取 `status=active` 条目，覆盖静态种子渲染
- Admin ERP：「业务运营 → 报价单配置」（`PriceListManager.vue`，菜单 `57`）
- 订货履约：发布时可同步精简价目到 `configs/b2b_catalog`（店长 `listCatalog`）
- 采购商工作台：**B2B 采购单服务端定价的唯一价格来源**（云函数 `payB2bPurchase/b2bPricing.js`：
  仅 `status=active` 且 `price` 为单一数字（或 `min===max`）的条目可在线支付；区间价 / 空价 → `quote_required`）

## 权限（2026-09-28 收紧）

- `read: auth != null`（官网匿名、ERP 匿名、小程序均可读）；**`write: false`**
- ERP 写入经 `manageStoreContent` 代理（`superAdminOnly`，禁 `removeWhere`/`setDoc`）；此前 `write: auth != null`
  意味着任何登录用户可改价，会让服务端定价失效

## 控制台步骤

1. 数据库 → 新建集合 → `price_list_items`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/price_list_items.json`](../rules/price_list_items.json)
3. 或：`cd admin && npm run provision:price-list`

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `skuId` | string | 稳定 SKU（与官网 `PriceListItem.id` 对齐） |
| `name` | string | 品名 |
| `species` | string | 物种 |
| `prepMethod` | string | 制作：干制 / 浸液 / 塑化 / 其他 |
| `packaging` | string | 包装展示文案 |
| `packagingFilter` | string | 包装筛选枚举 |
| `bioFilter` | string | 题材筛选枚举 |
| `price` | number \| `{min,max}` \| null | 供货价 |
| `guidePrice` | number \| `{min,max}` \| null | 指导售价 |
| `specs` | string | 规格 |
| `note` | string | 备注 |
| `image` | string | 主图：官网绝对/相对路径或 `cloud://` |
| `images` | string[] | 多图（lightbox）；同步种子含多图 SKU |
| `imageAlt` | string | 图 alt |
| `sort` | number | 升序 |
| `status` | string | `active` \| `inactive` |
| `createTime` / `updatedAt` | number | 时间戳 |

## 推荐索引

| 字段 | 说明 |
|------|------|
| `status` + `sort` | 官网拉生效清单 |
| `skuId` | Admin 按 SKU 查重 |
