# CloudBase 安全规则文件

环境：`cloud1-8gnkty5bfff9f0bf`

## 用法

1. 打开 [云开发控制台](https://console.cloud.tencent.com/tcb) → 数据库 → 选择集合
2. **权限设置** → **自定义安全规则**
3. 粘贴与同名的 `.json` 内容（如 `home_configs.json` → 集合 `home_configs`）

### 批量应用（推荐，无需手工粘贴）

```bash
cd admin
node scripts/apply-database-rules.mjs --dry-run        # 只读预演：打印当前规则与差异
node scripts/apply-database-rules.mjs --only a,b,c     # 只应用指定集合
node scripts/apply-database-rules.mjs --create-missing # 集合不存在则先创建再加规则
node scripts/apply-database-rules.mjs                  # 应用本目录全部规则
node scripts/apply-database-rules.mjs --probe orders   # 探查某集合权限接口原始返回
```

- 凭据：`admin/.env` 的 `TCB_SECRET_ID` / `TCB_SECRET_KEY`（勿提交）。
- 已完成写入后**逐条读回校验**，不一致会报错并非零退出；已一致的集合自动跳过（可 `--force` 强制重写）。
- 2026-09-15 首次使用：35 个集合中 28 条已一致、7 条实际收紧（含 `comments`、`coupons` 原为"登录即可写"）、9 个缺失集合已创建并上锁，复核 35/35 一致。

## 模板说明

| 文件 | 用途 |
|------|------|
| `_template_anonymous_rw.json` | A1 默认：已登录（含匿名）可读可写 |
| `_template_public_read_auth_write.json` | 全员可读，仅登录可写 |
| `_template_user_openid_scoped.json` | 用户数据按 `_openid` 隔离（A2+） |
| `purchase_orders.json` | B2B 订货单：**仅本人可读**（`doc._openid == auth.openid`），**write:false**。**不放行 Web 匿名**（匿名登录对公网任何人开放，匿名 = 任何人）：ERP 列表读经 `payB2bPurchase.adminList`、写经 `manageStoreContent`（均仅超管）；小程序建单/列表/支付经 `payB2bPurchase`。⚠️ **线上尚未应用**：须新版 ERP + 新版小程序都上线后才能应用，顺序见 `miniprogram/docs/供应商工作台_微信支付配置指南_2026-09-28.md` §8 |
| `price_list_items.json` | 供货价目：登录可读，**write:false**（服务端定价的唯一价格来源；ERP 写经 `manageStoreContent`，仅超管）。✅ **2026-09-28 23:09 已应用到线上** |

### 线上回滚值（B2B 两集合，2026-09-28 应用前读自线上）

| 集合 | 线上原规则（回滚值） | 当前线上 | 回滚方法 |
|------|------------------|---------|---------|
| `price_list_items` | `{"read":"auth != null","write":"auth != null"}` | `{"read":"auth != null","write":false}`（23:09 应用） | 把 `price_list_items.json` 临时改回原值 → `cd admin && node scripts/apply-database-rules.mjs --only price_list_items`（**回滚即恢复公网匿名可改价**，只在关键功能故障时短时使用） |
| `purchase_orders` | `{"read":"auth != null","create":"auth != null","update":"auth != null","delete":false}` | 仍为原规则（**公网匿名可建单/改单**，23:10 匿名探针实测 update 被放行） | 应用后若故障，同法改回原值 `--only purchase_orders` |

> 应用 `price_list_items` 后的实测：匿名 `count` 可读（43 条）；匿名对不存在 `_id` 的 `update` / `delete` → `DATABASE_PERMISSION_DENIED`（探针见 `.tmp/probe-price-write-deny.mjs`，只打不存在的文档，不会改到数据）。
> 旧版 ERP「报价单配置」编辑价目会失败（直写被拒），新版 ERP（写经 `manageStoreContent`）上线后恢复 —— 产品负责人已接受。
| `products.json` / `orders.json` | 商品全员可读、订单登录可读；**write:false**（仅云函数可写） |
| `users.json` / `user_coupons.json` | 仅本人可读；**write:false**（资料/券经云函数） |
| `banners.json` 等运营集合 | 公开或登录可读；**write:false**（`manageStoreContent`） |
| `staff_members.json` / `workspace_acl.json` | **read/write 均 false**（RBAC 数据源，仅云函数 `manageStaff` 可访问） |
| 2026-09-15 批量补齐（35 份） | 31 份**仅云函数访问**的业务集合 → `false/false`（工作室库存、采购/出货、员工域、法人/内容/消息等）；4 份 ERP 客户端只读 → `read: auth != null` + `write: false`（`analytics_daily` / `custom_drafts` / `support_tickets` / `user_behaviors`）。分类依据：全仓客户端代码（小程序 4 个目录 + `admin/src`）真实数据调用扫描 |

小程序侧权威副本与应用脚本：`WeChatProjects/shanchuanspecimens-只上传/database-rules/`。

完整集合清单见 [docs/cloudbase-collections.md](../../docs/cloudbase-collections.md)。
