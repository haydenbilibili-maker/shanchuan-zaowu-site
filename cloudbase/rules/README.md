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
| `purchase_orders.json` | 采购意向：登录可 create/read/update，禁止 delete |
| `products.json` / `orders.json` | 商品全员可读、订单登录可读；**write:false**（仅云函数可写） |
| `users.json` / `user_coupons.json` | 仅本人可读；**write:false**（资料/券经云函数） |
| `banners.json` 等运营集合 | 公开或登录可读；**write:false**（`manageStoreContent`） |
| `staff_members.json` / `workspace_acl.json` | **read/write 均 false**（RBAC 数据源，仅云函数 `manageStaff` 可访问） |
| 2026-09-15 批量补齐（35 份） | 31 份**仅云函数访问**的业务集合 → `false/false`（工作室库存、采购/出货、员工域、法人/内容/消息等）；4 份 ERP 客户端只读 → `read: auth != null` + `write: false`（`analytics_daily` / `custom_drafts` / `support_tickets` / `user_behaviors`）。分类依据：全仓客户端代码（小程序 4 个目录 + `admin/src`）真实数据调用扫描 |

小程序侧权威副本与应用脚本：`WeChatProjects/shanchuanspecimens/database-rules/`。

完整集合清单见 [docs/cloudbase-collections.md](../../docs/cloudbase-collections.md)。
