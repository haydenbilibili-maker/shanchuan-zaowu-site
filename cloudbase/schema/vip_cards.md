# vip_cards · 会员权益卡

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- ERP：「权益与营销」页签的**会员权益卡**列表（`admin/src/components/Marketing.vue`）
- 云函数：**不经云函数** —— 写入经 Pages 代理 `/api/cloud-fn` → `manageStoreContent`（`staffGuard` 仅店长/超管）
- C 端：**当前无任何读取方**（全仓 grep 仅 ERP）

## 权限

```json
{ "read": "auth != null", "write": false }
```

**为什么 `write: false`**：ERP 前端是**匿名登录**（`signInAnonymously`），
若写成 `write: "auth != null"` 等于任何拿到匿名身份的人都能写。仓库里所有 ERP 管理类集合
（`rewards` / `banners` / `activities` …）都是 `write: false` + 经 `manageStoreContent` 代理写。

**两处允许名单必须同时包含本集合**（缺一侧即不可用）：
- 前端 `admin/src/utils/cloudbaseCdnDb.js` 的 `STORE_CONTENT_WRITE_COLLECTIONS`（决定走不走代理）
- 云函数 `manageStoreContent` 的 `ALLOWED_COLLECTIONS`（服务端真正执法）
- 守卫：`npm run check:proxy-allowlist`（集合级 + 函数级两份名单逐项比对）

## 字段

以 `Marketing.vue` 的 `buildVipPayload()` 为准（字段以代码实证，未在此处猜测）。

## 历史

- **2026-09-16 创建**：审计 P0-11 发现「ERP 在读，云开发里不存在」→ 页面列表恒空、
  保存必然失败，而界面看起来正常。同期创建 `equity_goods` / `feishu_shipments`。
