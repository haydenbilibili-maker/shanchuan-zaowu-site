# wish_wall_messages · 马上有祈福弹幕（需求 28）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序 C 端：`manageWishWall`（`list` 公开读 / `post` 发布 / `mine` 我的）
- 小程序超管工作台 → 磁贴**「内容开关」**(tab 16) →「祈福墙内容管理」：
  `manageWishWall`（`staffList` / `staffSetStatus` / `staffRemove` / `staffStats` / `staffSeedAi`）
- 「内容管理」(tab 9) 顶部另有**直达条**进入同一治理页（两处共用同一个跳转）
- 运营开关：`content_display_flags.showMaShangYou`（缺配置默认**关**）

## 为什么 `write: false`

弹幕是 UGC。若允许客户端直写，任何人都能绕过长度校验、频控与（可选的）内容安全检测，
写进任意 `status` / `pinned` 值。因此**集合只读，全部写入经云函数**：

| 字段 | 谁能写 |
|---|---|
| `text` / `createTime` / `_openid` | `manageWishWall.post`（服务端校验后） |
| `status` / `pinned` | 仅 `staffSetStatus`（超管/店长） |

## 控制台步骤

1. 新建集合 `wish_wall_messages`
2. 权限 → [`../rules/wish_wall_messages.json`](../rules/wish_wall_messages.json)（`read: true` / `write: false`）
3. 建议索引：`productKey + status + createTime(desc)`（公开列表）、`_openid + createTime(desc)`（频控与「我的」）
   > 索引缺失不会导致功能不可用：频控查询失败时**放行**（宁多一条，也不要因索引缺失完全发不出去），列表有内存排序兜底。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 发布者 openid（频控与「我的」按它查） |
| `openid` | string | 同上，冗余一份便于管理端展示 |
| `productKey` | string | 作用域。当前只启用 `mashangyou`；**全站拓展**时按藏品 `wishWallKey` 写入（同一集合装多面墙） |
| `text` | string | 祈福文案，2–30 字，已折叠空白、去零宽字符 |
| `nickname` | string | 展示昵称。用户发布：**服务端**取 `users.nickName`，缺省「匿名藏家」；基础内容：固定「山海造物」 |
| `avatar` | string | 头像，服务端取 `users.avatarUrl` |
| `status` | string | `visible` \| `hidden`（管理端可切换） |
| `pinned` | boolean | 是否置顶 |
| `source` | string | `user`（用户手写）\| `ai`（AI 创作的基础内容）\| `seed`（人工基线兜底） |
| `aiGenerated` | boolean | 是否由 AI 生成（`source === 'ai'`） |
| `seedBatch` | string | 基础内容批次号，便于按批回收/替换 |
| `securityChecked` | boolean | 发布时是否走过内容安全（`WISH_WALL_SECURITY=on` 时为 true） |
| `createTime` / `updateTime` | date | |
| `updatedBy` | string | 最后一次改状态的操作者 |

### 基础内容（`source: ai | seed`）

- `_openid` / `openid` 留**空串**：基础内容不属于任何用户，不参与用户频控与「我的」；
- 与用户弹幕**同表同字段**，故超管端内容开关面板照常可隐藏/删除 —— 不存在"免治理通道"；
- 播种入口：超管工作台 → 磁贴「内容开关」→ 祈福墙内容管理 →「AI 生成一批心愿」
  （AI 不可用时自动改用 `manageWishWall/wishSeeds.js` 的人工基线文案）。

## 内容治理（业务口径 2026-09-16）

**不接 UGC 审核**，由「超管工作台 · 内容开关面板」承载治理：列表可见全部状态、可隐藏/恢复/删除。

⚠️ 仍保留一行开关：云函数环境变量 `WISH_WALL_SECURITY=on` 时走微信 `security.msgSecCheck`，
命中 `risky` 直接拒绝发布。若平台复核或客诉要求补审核，改环境变量即可，**无需改代码发版**。
（`manageWishWall/config.json` 已声明 `security.msgSecCheck` 权限。）
