# feishu_shipments · 飞书出货镜像

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- **飞书出货表的镜像落库目标**（`admin/src/utils/feishuSync.js` 的 `pullTable('shipment', …)`）
- ⚠️ **SSOT 不是本集合**：出货主库是 `ops_shipments`（`upsertOpsShipmentsFromFeishu`）。
  本集合只是镜像，供排查/对照。
- 飞书 API 调用走 Pages Function `/api/feishu-sync`（密钥在 Pages 环境变量，不进 SPA）；
  但**镜像写库走浏览器** → 经代理 → `manageStoreContent`。

## 权限

```json
{ "read": "auth != null", "write": false }
```

## 重要：镜像写入是 best-effort

`pullTable` 的逐条 upsert 包在 `try/catch` 里，注释明确写着
「镜像集合权限/缺失不应阻断 SSOT upsert（出货主库 ops_shipments）」。
所以**本集合写失败不会中断飞书同步** —— 这也是为什么它「不存在」了很久却没人发现。

创建它只是让镜像真正能落库（此前每条都静默失败）。若将来要停用镜像，
正确做法是删掉 `pullTable` 里的镜像分支，而不是留一个写不进去的集合。

## 字段

由 `mapRecord(rec, spec.fields)` 决定，另加 `recordId`（飞书 record_id）与 `syncedAt`（毫秒时间戳）。

## 历史

- **2026-09-16 创建**（审计 P0-11 同批）。
