# CloudBase 安全规则文件

环境：`cloud1-8gnkty5bfff9f0bf`

## 用法

1. 打开 [云开发控制台](https://console.cloud.tencent.com/tcb) → 数据库 → 选择集合
2. **权限设置** → **自定义安全规则**
3. 粘贴与同名的 `.json` 内容（如 `home_configs.json` → 集合 `home_configs`）

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

小程序侧权威副本与应用脚本：`WeChatProjects/shanchuanspecimens/database-rules/`。

完整集合清单见 [docs/cloudbase-collections.md](../../docs/cloudbase-collections.md)。
