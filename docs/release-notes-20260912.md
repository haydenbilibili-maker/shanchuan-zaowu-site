# Admin / 官网 · 版本封板说明（2026-09-12）

> **Admin 包版本**：`0.2.0`（`package.json` / `admin/package.json`）  
> **生产发布**：Cloudflare Pages `shanchuan-zaowu-site`（含 `functions/` 与 `manageGift` 白名单）

## 本版摘要

- 权益与营销 Hub：礼赠运营配置 + **礼赠履约看板**翻栏
- 店员细粒度能力（含 `giftOps` / 核销拆权）与错误文案区分（登录 vs 权限 vs 运维密钥）
- 命令面板：Element Plus 图标替换 emoji，防叠字；侧栏近期入口图标对齐
- 代金券渠道默认 `all`、欢迎礼默认与小程序对齐

## 已知风险

- Admin SPA「主理人在线」≠ 云函数已鉴权；管理写操作依赖 `ADMIN_OPS_KEY`（Pages 环境变量须与云函数一致）
- 资金核对类问题以小程序订单字段 `walletRefundPendingReconcile` 为准，Admin 本版未做独立账本纠偏工具

## 抽检

1. 打开 Admin → 权益与营销 →「礼赠履约」「礼赠运营」两 Tab  
2. ⌘K 命令面板：图标与文字无叠字  
3. 无超管权限账号读礼赠配置：提示权限/运维密钥，而非「请先登录」

---

*与小程序业务版 **1.1.0** 同日封板*
