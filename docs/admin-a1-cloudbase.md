# A1 · 管理端财务数据云端持久化

> 目标：Web 管理端 `/admin/` 财务模块以 **微信云开发（CloudBase）** 为真源，`localStorage` 仅作离线缓存。

## 现状（无需改 shanchuan-admin 源码即可用）

当前 `public/admin/` 构建产物**已内置**：

| 能力 | 说明 |
|---|---|
| CloudBase SDK | envId `cloud1-8gnkty5bfff9f0bf`，region `ap-shanghai` |
| 匿名登录 | 启动时 `signInAnonymously()` |
| 财务同步 | `financeSync`：上传 / 下载 / 自动合并 |
| 财务页 | 解锁后 `loadData()` 自动 `autoSyncFinanceData()` |
| 手动按钮 | 「同步到云端」「从云端下载」 |

**localStorage 键**

| 键 | 内容 |
|---|---|
| `shanhai_v12` | 财务日记录数组 |
| `sc_finance_v12` | 财务设置（成本率、工资等） |
| `finance_sync_metadata` | 上次同步时间戳 |

**云集合**

| 集合 | 用途 |
|---|---|
| `finance_records` | 按 `date` 去重的日营收记录 |
| `finance_settings` | 全局财务参数 |

---

## 一次性：云开发控制台配置

登录 [腾讯云云开发控制台](https://console.cloud.tencent.com/tcb) → 环境 **`cloud1-8gnkty5bfff9f0bf`**。

### 1. Web 安全域名（必做，否则 Web 端无法连库）

**设置 → 安全配置 → Web 安全域名**，添加：

```
localhost:5173
localhost:4321
shanhaizaowu.com
www.shanhaizaowu.com
```

> 本地开发端口按实际 Vite/Astro dev 端口调整。未加 `shanhaizaowu.com` 时浏览器控制台会出现域名 / CORS 类错误（code 常见 `-502003`）。

### 2. 匿名登录（必做）

**设置 → 登录授权 → 匿名登录** → **开启**。

Web 管理端使用 `signInAnonymously()`，不依赖微信扫码。

### 3. 创建集合

**数据库** → 新建集合（若不存在）：

- `finance_records`
- `finance_settings`
- **`store_ledger`**（店长小程序账本，与 `finance_records` 双向同步）

索引建议（可选，数据量大时再加）：

- `finance_records`：`date` 降序

### 4. 数据库权限（A1 阶段）

A1 使用匿名登录 + 管理端口令（前端）。云库侧建议：

**方案 A · 快速上线（A1 推荐）**

两个集合权限均设为：**所有用户可读，仅创建者可读写**

或自定义安全规则（见 `cloudbase/rules/`）。

**方案 B · 后续升级（A2+）**

改为自定义登录 / 邮箱登录 + 按 `auth.uid` 或角色字段限制读写。

### 5. 验证

1. 部署后打开 **`https://shanhaizaowu.com/admin/cloud-check.html`**
2. 点击「开始检测」，四项应全部 ✅
3. 进入 `/admin/` → 财务 → 解锁 → 录入一条测试数据 → **同步到云端**
4. 换浏览器或清 localStorage 后 → **从云端下载**，数据应恢复

> **Web SDK 注意**：财务同步**不要**依赖云库 `orderBy` / 逐条 `where`（无索引时会报 `Cannot set properties of undefined (setting 'promise')`）。  
> 当前 `financeSync` 已改为 `limit` + 客户端排序/按 `date` 合并；若仍失败，硬刷新（Cmd+Shift+R）清掉旧 JS 缓存。

---

## 日常使用

```
录入/修改财务数据
    ↓
自动：解锁财务页时 autoSync（合并本地 + 云端）
    ↓
手动：点「同步到云端」强制上传（同时镜像至 `store_ledger` 供店长小程序）
    ↓
换设备：点「从云端下载」拉取最新（合并 `finance_records` + `store_ledger`）
```

冲突策略（已实现）：同 `date` 记录取 `_updateTime` 较新者。

---

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 控制台 `domain` / `-502003` | 未加 Web 安全域名 | 加上 `shanhaizaowu.com` |
| `匿名登录` / `auth` 错误 | 匿名登录未开 | 控制台开启匿名登录 |
| `permission` / `-502004` | 集合权限过严 | 放宽规则或确认已匿名登录 |
| `collection not found` | 集合未建 | 新建 `finance_records` 等 |
| 同步成功但换设备无数据 | 只写了 localStorage 未点上传 | 点「同步到云端」 |
| `setting 'promise'` / 记录同步失败 | 内置 bundle 的 CloudBase SDK 数据库 `.get()` 异常 | 已改用 CDN SDK（`index.html` + `financeSync`）；硬刷新 |
| 小程序有数据 Web 没有 | 集合名或 envId 不一致 | 核对 envId 与集合名 |

---

## 后续（A2 预告）

- 会员、藏品、CRM 模块接入同一 envId
- 匿名登录 → 自定义登录（邮箱 / 微信开放平台）
- 安全规则按 `storeId`、角色字段隔离多门店数据

## 源码仓库

长期改动请在 **`shanchuan-admin`**（Vite + Vue 3）中进行，构建后覆盖 `public/admin/`。  
本仓库 `cloudbase/` 与本文档为 **运维与验收** 用途。
