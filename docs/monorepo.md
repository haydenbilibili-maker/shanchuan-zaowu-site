# Monorepo · 山海造物数字产品

本仓库统一维护 **官网（Astro）**、**Web ERP（Vue 3）**、**微信小程序** 三端源码。

```
shanchuanzaowu/
├── src/                 # Astro 官网页面与组件
├── public/admin/        # ERP 构建产物 → 部署到 /admin/
├── admin/               # ERP 源码（原 shanchuan-admin）
├── miniprogram/         # 小程序源码（原 shanchuanspecimens）
├── cloudbase/           # 云开发集合 schema / 安全规则
└── docs/                # 运维与配置文档
```

## 日常开发

| 端 | 命令 / 工具 | 说明 |
|----|-------------|------|
| 官网 | `npm run dev` | http://localhost:4321 |
| ERP | `npm run dev:admin` | http://localhost:5178（Vite） |
| 小程序 | 微信开发者工具 | 打开 **`miniprogram/`** 目录（非仓库根目录） |

## 构建与部署

```bash
# 仅构建 ERP → public/admin/
npm run build:admin

# 完整生产构建（ERP + 官网 → dist/）
npm run build
```

Cloudflare Pages 仍只部署 **`dist/`**（含 `dist/admin/`）。  
小程序仍通过微信开发者工具上传，不走 Pages。

## 云环境

三端共享 CloudBase envId：`cloud1-8gnkty5bfff9f0bf`（上海）。

- Web 财务：`finance_records` · 配置见 `docs/admin-a1-cloudbase.md`
- 店长账本桥接：`store_ledger` · 见 `cloudbase/schema/store_ledger.md`
- 小程序云函数：`miniprogram/cloudfunctions/`

## 从独立仓库迁入

源码自以下路径 **rsync 复制**（不含 `node_modules`、`.git`）：

- ERP：`Business_Projects/shanchuan-admin` → `admin/`
- 小程序：`WeChatProjects/shanchuanspecimens` → `miniprogram/`

原独立仓库可保留作归档；后续以本 monorepo 为准。

## 回灌记录

### 2026-09-14 · 小程序安全修复回灌

小程序侧的安全加固（云端口令 `manageStaff.verifyUiGate`、`staffGuard` 角色鉴权、客户端写操作全部收回云函数、
`database-rules/`、三个分包重构）先在 `WeChatProjects/shanchuanspecimens` 落地，本仓 `miniprogram/` 当时仍是旧版镜像，
形成「规则是新的、代码是旧的」矛盾，故执行一次完整回灌。

回灌命令（在仓库根执行，`--delete` 保证镜像一致，不复制依赖与 Git 元数据）：

```bash
rsync -a --delete \
  --exclude='node_modules/' --exclude='.git/' --exclude='.DS_Store' \
  ~/LifeOS_Workspace/Business_Projects/WeChatProjects/shanchuanspecimens/ \
  miniprogram/
```

结果：云函数 81 → **121**；分包 `business` → `business`/`manager`/`feature`；`miniprogram/README.md` 随之删除
（小程序侧以 `miniprogram/docs/README.md` 为文档索引）；主包 1.58 MB → **1.19 MB**；客户端直写数据库实测 **0 处**。

配套动作：`cloudbase/rules/user_collection.json` 已与小程序侧收严版对齐为 `write:false`（其余 29 份共用规则两边一致）。
注意此后规则有**两份副本**——`cloudbase/rules/`（本仓权威，含 Admin 专属集合）与 `miniprogram/database-rules/`
（小程序侧自带，随回灌覆盖）；修改共用集合的规则时需同时改两处。

## 待办（合并后）

1. ~~将 `financeSync` / `storeLedgerSync` 回灌到 `admin/src/utils/`~~（已完成）
2. ~~小程序店长账本读写改为 `store_ledger` 集合~~（已完成）
3. 云函数 `npm install`：在 `miniprogram/cloudfunctions/<name>/` 按需安装依赖
4. **部署** `syncFinanceData` 云函数（微信开发者工具上传）
