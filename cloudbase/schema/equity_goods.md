# equity_goods · 虚拟权益商品

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- ERP：「权益与营销」页签的**虚拟权益商品**列表（`admin/src/components/Marketing.vue`，
  下架走 `deleteItem(row, 'equity_goods')`）
- 云函数：写入经 Pages 代理 → `manageStoreContent`（不得浏览器直写）
- C 端：**当前无任何读取方**

## 权限

```json
{ "read": "auth != null", "write": false }
```

同 `vip_cards`：ERP 前端匿名登录，故写必须走代理；两处允许名单都要含本集合，
由 `npm run check:proxy-allowlist` 守卫。

## 字段

以 `Marketing.vue` 的 `buildVirtualPayload()` 为准。

## 历史

- **2026-09-16 创建**（审计 P0-11 同批）。
