# 馆内直播（MVP）配置手册

面向运营 / 开发：开通腾讯云 CSS、配置推拉流域名、写入云函数环境变量、开通微信侧权限，并完成端到端验收。

山海造物小程序直播能力：店长/超管推流（`live-pusher`）+ C 端拉流（`live-player`），入口受内容开关 `showLive` 控制。

**主播日常操作**：授予 `live_host` 角色的同事请在小程序「我的 → 主播工作台」（路径 `subpackages/business/live/studio/index`）进入场次与开播控制台；超管仍在「超管工作台」保留馆内直播看板与全量配置能力。

> 控制台文案、类目清单会随腾讯云 / 微信更新。文中路径以 2026 年常见界面为准；若按钮名称略有差异，以官方最新文档为准。

---

## 0. 架构与字段对应（先看清再动手）

```
超管「内容开关」showLive
        │
        ▼
content_display_flags（getContentDisplayFlags）
        │
        ├─ false → C 端隐藏首页直播 Banner；watch 页拒绝进房（观看中平滑踢出）
        └─ true  → 首页 getActive；有可拉流场次则抢插 Banner 第一帧

店长/超管「开播」→ manageLiveSession.start
        │  鉴权：staffGuard + manageLive
        │  用环境变量签发 URL；可带封面 coverUrl / 预约 scheduledAt
        ▼
腾讯云 CSS（RTMP 推 / HTTPS-FLV 拉）
        │
        ├─ live-pusher ← pushUrl（仅主播端）
        └─ live-player ← pullUrl（观众端，无 pushUrl）
              │
              ├─ heartbeat → 近似在线人数（presence TTL）
              └─ live_messages → 本场留言墙（限频 + 粗滤）
```

### 本项目生成的地址格式（`streamUrls.js`）

| 用途 | 格式 | 谁拿到 |
|------|------|--------|
| 推流 | `rtmp://{LIVE_PUSH_DOMAIN}/{LIVE_APP_NAME}/{streamName}?txSecret=…&txTime=…` | 仅主播（`start` / `create` / `getHostSession`） |
| 拉流（默认） | `https://{LIVE_PLAY_DOMAIN}/{LIVE_APP_NAME}/{streamName}.flv?txSecret=…&txTime=…` | C 端 `getActive` |
| 拉流（备用） | `rtmp://{LIVE_PLAY_DOMAIN}/{LIVE_APP_NAME}/{streamName}?…` | 入库字段 `pullUrlRtmp`，观众页当前用 HTTPS-FLV |

鉴权算法（与腾讯云 CSS MD5 鉴权一致）：

```text
txTime   = 过期时刻的 Unix 秒时间戳，转成大写十六进制
txSecret = md5( LIVE_AUTH_KEY + streamName + txTime )
```

过期时长由 `LIVE_AUTH_EXPIRE_SEC` 控制（默认 `86400`，代码下限 `300` 秒）。

### 环境变量 ↔ 控制台字段对照表

| 云函数环境变量 | 从腾讯云哪里抄 | 填什么（示例占位） | 必填 |
|----------------|----------------|--------------------|------|
| `LIVE_PUSH_DOMAIN` | 云直播 → 域名管理 → **推流域名** | 仅主机名，无 `rtmp://`、无路径：`push.example.com` | 出画必填 |
| `LIVE_PLAY_DOMAIN` | 云直播 → 域名管理 → **播放域名** | 仅主机名：`play.example.com` | 出画必填 |
| `LIVE_APP_NAME` | 推/播地址中的 AppName | 建议统一填 `live`（与代码默认一致） | 否，默认 `live` |
| `LIVE_AUTH_KEY` | 推流域名 / 播放域名 → 鉴权 **主 KEY** | 字母数字串，**推与播两边请设成同一个值** | 强烈建议 |
| `LIVE_AUTH_EXPIRE_SEC` | 自定（不必抄控制台） | `86400`（秒） | 否 |

**不要**把 `https://`、`rtmp://`、尾斜杠写进环境变量。  
**不要**把 Key 写进仓库 / `cloudbaserc.json`。

本项目目前只用**一个** `LIVE_AUTH_KEY` 同时签推流与拉流地址 → 推流域名主 KEY 与播放域名主 KEY **必须相同**。

未配置 `LIVE_PUSH_DOMAIN` + `LIVE_PLAY_DOMAIN` 时：开关、建场、结束流程仍可用；`start` 返回 `configured:false` 且无可用 `pushUrl`，无法出画。

---

## 1. 腾讯云 CSS（云直播）开通

控制台入口：[云直播 CSS](https://console.cloud.tencent.com/live)

### 1.1 开通产品与账号准备

1. 使用已**实名认证**的腾讯云账号登录。
2. 进入「云直播」，按提示开通服务（可能涉及计费确认；直播按流量/带宽计费，以控制台为准）。
3. 地域：云直播为全球/中国区产品能力，域名接入以控制台「域名管理」为准；一般国内业务使用**已 ICP 备案**的域名。
4. 建议准备：
   - 两个不同的二级域名（推流、播放**不能用同一个域名**）
   - 播放域名的 HTTPS 证书（PEM：证书链 + 私钥）
   - 域名 DNS 管理权限（做 CNAME）

占位示例（下文统一用）：

| 角色 | 自有域名示例 |
|------|----------------|
| 推流 | `push.example.com` |
| 播放 | `play.example.com` |

### 1.2 推流域名（对应 `LIVE_PUSH_DOMAIN`）

#### 默认测试域名 vs 自有域名

- 控制台可能提供类似 `xxxx.tlivepush.com` 的**默认/测试推流域名**，仅适合联调，**不建议正式业务长期使用**。
- 正式环境请添加**自有推流域名**（需按腾讯云要求完成归属验证 / 备案相关校验，以控制台提示为准）。

#### 操作步骤

1. 云直播控制台 → **域名管理** → **添加域名**。
2. 域名类型选择 **推流域名**。
3. 填写：`push.example.com`。
4. 添加成功后，列表会出现系统分配的 **CNAME 目标**（常见形态为 `*.tlivepush.com` 一类，以控制台显示为准）。
5. 到域名 DNS 服务商新增解析：

| 主机记录 | 类型 | 记录值 |
|----------|------|--------|
| `push`（若域名为 `push.example.com`） | `CNAME` | 控制台给出的 CNAME 目标 |

6. 等待生效（常见 15–30 分钟）。可用：

```bash
dig push.example.com
# 或
nslookup push.example.com
```

确认已指向云直播 CNAME。控制台域名状态变为「已配置 / 正常」后再继续。

#### 备案注意

- 中国大陆节点推流/播放，域名通常需 **ICP 备案**（且备案主体与腾讯云账号主体关系需符合平台要求）。
- 未备案域名可能导致无法添加或无法推流，以控制台报错为准。

#### 推流鉴权（对应 `LIVE_AUTH_KEY`）

1. 域名管理 → 点开推流域名 `push.example.com`。
2. 进入 **推流配置** → **鉴权配置**（或「访问控制 / Key 鉴权」）。
3. **开启**推流鉴权（默认往往已开）。
4. 设置 **主 KEY**（字母数字，最长以控制台限制为准，常见 ≤256）。
5. 加密方式选择 **MD5**（本项目 `streamUrls.js` 使用 MD5，不要选成仅 SHA256 却不改代码）。
6. 把主 KEY **原样复制**，稍后同时用于播放域名，并写入 `LIVE_AUTH_KEY`。

本项目推流 URL 示例（开播后由云函数生成，无需手写）：

```text
rtmp://push.example.com/live/sh_xxxx_yyyy?txSecret=...&txTime=...
```

其中 `live` = `LIVE_APP_NAME`，`sh_xxxx_yyyy` = 场次 `streamName`。

### 1.3 播放域名（对应 `LIVE_PLAY_DOMAIN`）

> 2018-10 之后开通的云直播账号，播放需使用**自有已备案域名**，不能只靠默认播放域名长期商用。

#### 操作步骤

1. 域名管理 → **添加域名** → 类型选 **播放域名**。
2. 填写：`play.example.com`（**必须与推流域名不同**）。
3. 拿到 CNAME 目标（常见 `*.txlivecdn.com` 一类）→ DNS 做 CNAME：

| 主机记录 | 类型 | 记录值 |
|----------|------|--------|
| `play` | `CNAME` | 控制台播放域名 CNAME |

4. 等待 CNAME 生效。

#### HTTPS（小程序拉流必做）

本项目 C 端默认拉：

```text
https://play.example.com/live/{streamName}.flv?...
```

因此播放域名必须配置 HTTPS：

1. 准备 **PEM** 证书（证书全文 + 私钥；Nginx 型）。
2. 域名管理 → `play.example.com` → **高级配置** → **HTTPS 配置** → 上传证书与私钥。
3. 保存后等待生效（官方说明常见约 **2 小时**量级，以控制台为准）。
4. 浏览器访问 `https://play.example.com`（即使 404，也应是有效 TLS，而不是证书错误）。

#### 播放鉴权

1. 同一播放域名 → **访问控制 / Key 鉴权** → 开启。
2. **主 KEY 填成与推流域名完全相同**的值 → 即同一个 `LIVE_AUTH_KEY`。
3. 鉴权配置修改后可能需约 **30 分钟**生效。

拉流 URL 示例：

```text
https://play.example.com/live/sh_xxxx_yyyy.flv?txSecret=...&txTime=...
```

### 1.4 AppName（对应 `LIVE_APP_NAME`）

- 腾讯云地址结构：`协议://域名/AppName/StreamName`
- 本项目默认 AppName = **`live`**
- 推流、播放、环境变量三处保持一致即可；一般**无需**在控制台单独「创建 App」，推流时带上路径即会使用该 AppName
- 若你希望改成 `museum` 等，则环境变量设 `LIVE_APP_NAME=museum`，且推/播地址生成器自测时也要填同一 AppName

### 1.5 用控制台地址生成器做一次「人工对照」

在推流域名详情 → **推流地址生成器**：

1. 加密选 MD5  
2. AppName 填 `live`  
3. StreamName 填测试名如 `test001`  
4. 过期时间选一段时间后生成  

得到的 `rtmp://push.example.com/live/test001?txSecret=…&txTime=…` 应与云函数算法一致（同一 KEY / 同一 txTime 时 `txSecret` 相同）。  
播放侧可用「播放地址生成」勾选 **HTTPS-FLV**，对照：

```text
https://play.example.com/live/test001.flv?txSecret=…&txTime=…
```

### 1.6 复制清单（填云函数前勾一下）

```text
LIVE_PUSH_DOMAIN=push.example.com
LIVE_PLAY_DOMAIN=play.example.com
LIVE_APP_NAME=live
LIVE_AUTH_KEY=（推流主KEY，且与播放主KEY相同）
LIVE_AUTH_EXPIRE_SEC=86400
```

---

## 2. 把环境变量配到本项目云函数 `manageLiveSession`

环境 ID：`cloud1-8gnkty5bfff9f0bf`

### 2.1 推荐：云开发控制台（图形界面）

1. 打开 [微信云开发 / CloudBase 控制台](https://console.cloud.tencent.com/tcb) → 选中环境 `cloud1-8gnkty5bfff9f0bf`  
   （或从微信开发者工具 → 云开发 → 云函数）
2. **云函数** → 找到 **`manageLiveSession`** → 点击函数名进入详情  
3. 打开 **函数配置** / **环境变量**（名称因控制台版本可能叫「配置管理」）  
4. 新增上表 5 个变量（至少前 2 个 + Key）  
5. **保存**

### 2.2 改完要不要重新部署？

| 操作 | 是否需要 `tcb fn deploy` |
|------|---------------------------|
| **只改环境变量**（控制台保存） | **一般不需要**重新上传代码；下次冷启动会读到新值。为稳妥可在控制台「测试」触发一次，或隔几分钟后再开播验证 |
| **改了 `manageLiveSession` 代码** | **需要**重新部署 |
| 用 CLI/`cloudbaserc` 带 `envVariables` 部署 | 可能**覆盖**控制台变量；**本仓库 `cloudbaserc.json` 未写入 LIVE_* 密钥**，避免误覆盖 |

查看当前函数信息（不含密文时可看是否已挂变量名）：

```bash
cd /path/to/shanchuanspecimens
tcb fn detail manageLiveSession
```

本地可用 `tcb fn env pull manageLiveSession` 拉变量到本地文件（注意勿提交含 Key 的文件）。

### 2.3 部署命令（仅代码变更时）

```bash
tcb fn deploy manageLiveSession --force
```

开关相关若改过：

```bash
tcb fn deploy getContentDisplayFlags --force
```

---

## 3. 微信小程序侧配置

### 3.1 主体与类目（使用 `live-player` / `live-pusher` 的前置条件）

依据[微信官方 live-player 文档](https://developers.weixin.qq.com/miniprogram/dev/component/live-player.html)：

- **个人主体小程序不支持**推拉流组件；需企业等主体。  
- 需先具备微信开放的类目（如社交-直播、教育-在线视频课程、部分医疗/金融/汽车/政府等），再开通组件权限。  
- **本店「馆内讲解/柜前直播」若类目不在表内，需先走类目变更或咨询微信侧是否可开权限**——**以微信公众平台最新类目表为准**。  
- 部分「直播」类目首次审代码可能需主管部门确认，耗时可能约 7 天量级。

### 3.2 开通组件接口权限（不是单独「直播插件」）

本项目使用**原生组件** `live-pusher` / `live-player`，**一般不需要**再装第三方直播插件。

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)  
2. **开发** → **开发管理** → **接口设置**（部分文档写作「开发设置 → 接口设置」）  
3. 找到与 **实时播放音视频 / live-player**、**实时录制音视频 / live-pusher** 相关的开关 → **开通**  

未开通时，真机上组件可能直接失败或无权限。

### 3.3 `app.json` 隐私权限说明（仓库已声明）

已配置：

- `scope.camera`：推流画面  
- `scope.record`：推流麦克风  

主播端开播页会尝试 `wx.authorize`；用户拒绝时需引导到系统设置打开摄像头/麦克风。

### 3.4 服务器域名 / 合法域名

路径：**开发** → **开发管理** → **开发设置** → **服务器域名**

| 类型 | 建议配置 | 说明 |
|------|----------|------|
| **request 合法域名** | `https://play.example.com` | HTTPS-FLV 拉流域名；**不要带路径** |
| **socket 合法域名** | 通常本 CSS 方案可不配腾讯 IM 那套；若后续接 TRTC/IM 再另加 | **以微信最新说明为准** |
| **uploadFile / downloadFile** | 按现有云开发需求，与直播无强绑定 | — |

说明：

- 本项目推流为 `rtmp://push.example.com/...`，由 `live-pusher` 原生通道推送，**一般不要求**把推流域名写进 request 合法域名；若真机报域名相关错误，再对照微信最新文档或开发者社区补充。  
- **开发阶段**可在开发者工具勾选「不校验合法域名」做联调，**体验版/正式版必须配好**。  
- 每月修改域名次数有限，一次规划好 `play.example.com`。

云开发相关域名（`tcb.qcloud.la` 等）保持原有配置即可，与 CSS 播放域名是两套。

### 3.5 真机调试注意事项

| 项 | 说明 |
|----|------|
| 开发者工具 | **不支持**真实 `live-pusher` / `live-player` 出画；开播页会提示改用真机 |
| 预览 | 用真机扫码预览；主播与观众用**两个微信号**更易验收 |
| 权限 | 首次需允许摄像头、麦克风；iOS/Android 设置里可再查 |
| 基础库 | 建议调试基础库 ≥ 2.0；`live-player` 自 1.7.0 起，同层渲染等能力更高版本才有 |
| 网络 | 推流建议 Wi-Fi；弱网易触发断连码（如推流 `-1307`、拉流 `-2301`） |
| 安全 | 勿把完整 `pushUrl` 打到分享卡片或用户可见日志 |

### 3.6 「直播」类目 / 插件小结

| 问题 | 结论 |
|------|------|
| 要不要装直播插件？ | **原生组件即可**，本项目未依赖第三方直播插件 |
| 要不要开通类目？ | **要**（企业主体 + 开放类目表内类目） |
| 要不要接口设置？ | **要**（开通 live-player / live-pusher） |
| 不确定时 | **以[微信公众平台](https://mp.weixin.qq.com/)与[官方组件文档](https://developers.weixin.qq.com/miniprogram/dev/component/live-player.html)最新说明为准** |

---

## 4. 数据与开关（配置域名之外仍需具备）

| 项 | 状态 / 操作 |
|----|-------------|
| 集合 `live_sessions` | 已可用脚本 `scripts/provision-live-sessions.cjs` 创建；权限 **PRIVATE**（仅云函数读写，保护 `pushUrl`） |
| 内容开关 `showLive` | 超管工作台 → **内容开关** → 打开「馆内直播入口」→ 保存 |
| 云函数 | `manageLiveSession`、`getContentDisplayFlags` 已部署过则只需补环境变量 |

`live_sessions` 主要字段：`title` / `status`(`idle`\|`live`\|`ended`) / `streamName` / `pullUrl` / `pushUrl`(仅库内+主播接口) / `hostOpenid` 等。

---

## 5. 端到端验收清单

按顺序勾选：

### A. 云直播侧

- [ ] 推流域名 `push.example.com` CNAME 已生效  
- [ ] 播放域名 `play.example.com` CNAME 已生效  
- [ ] 播放域名 HTTPS 证书已生效  
- [ ] 推流、播放鉴权均开启，**主 KEY 相同**  
- [ ] 控制台地址生成器可生成带 `txSecret` 的 RTMP / HTTPS-FLV 地址  

### B. 云函数侧

- [ ] `manageLiveSession` 已配置 `LIVE_PUSH_DOMAIN` / `LIVE_PLAY_DOMAIN` / `LIVE_AUTH_KEY`（及可选 AppName、过期秒数）  
- [ ] 变量值为**纯主机名**，无协议头  
- [ ] （可选）控制台测试调用 `action: "start"` 返回的 `session.pushUrl` / `pullUrl` 域名正确  

### C. 微信侧

- [ ] 小程序类目满足推拉流开放范围  
- [ ] 接口设置已开通 live-player / live-pusher  
- [ ] request 合法域名含 `https://play.example.com`  
- [ ] 真机可弹出摄像头/麦克风授权  

### D. 业务验收

1. [ ] 超管打开「内容开关 → 馆内直播」并保存  
2. [ ] **真机**店长/超管工作台 → **开播** → 填写标题 → 开始推流  
3. [ ] 开播页提示推流中（或 `configured: true` 且有画面预览）  
4. [ ] 另一用户打开首页 → 出现直播条 → 进入观看页有声画  
5. [ ] 关闭 `showLive` → 首页条消失；直达 watch 页被拦截  
6. [ ] 主播点「结束直播」→ 观众侧不可再看；库内 `pushUrl` 已清空  

### E. 常见失败对照

| 现象 | 优先排查 |
|------|----------|
| `configured:false` / 无 pushUrl | 环境变量域名未配或未生效 |
| 推流鉴权失败 | KEY 不一致、加密非 MD5、txTime 过期、CNAME 未好 |
| 能推不能播 | 播放 HTTPS 未生效、request 域名未加、播域名鉴权 KEY 不同 |
| 组件直接不可用 | 类目/接口设置未开通、个人主体 |
| 仅模拟器黑屏 | 正常，请换真机 |

---

## 6. 产品边界与已知限制

| 项 | 结论 |
|----|------|
| 谁开播 | 店长 + 超管（`manageLive`） |
| C 端入口 | 有有效直播时抢插首页 Banner 第一帧；需 `showLive` + 可拉流场次 |
| 回放 / 弹幕 / 带货 | 本场留言墙 + 场内公告 + **电商挂车**（加购/购买复用现有下单） |
| 并发 | 同时仅 1 场 `status=live` |
| 模拟器 | 不可真实推拉流 |
| 安全 | `pushUrl` 不下发普通用户；结束后清空 |

---

## 7. 相关文件

- `cloudfunctions/manageLiveSession/`（含 `streamUrls.js`、`moderation.js`）
- `cloudfunctions/getContentDisplayFlags/`（`showLive`）
- `utils/contentDisplayFlags.js`
- `subpackages/feature/live/watch/`（C 端 `live-player` + 留言墙 / 分享）
- `subpackages/business/live/broadcast/`（主播 `live-pusher` + 封面/预约）
- `pages/index/`（有直播时 Banner 第一帧抢插）
- `subpackages/business/manager/`（开播入口 + 内容开关）
- `scripts/provision-live-sessions.cjs`（集合创建）
- 集合：`live_sessions`、`live_messages`（留言墙）、`live_reminders`（开播提醒登记）

---

## 9. 本轮变更摘要（体验增强）

相对首版 MVP，本轮已落地：

| 能力 | 说明 |
|------|------|
| 主播预览 | 开播前 `live-pusher` 本地预览（无 url / 未 autopush） |
| 美颜 | 默认关，可切换；推流中可改 |
| 断线提示 | 推流状态码映射可读文案 +「重试推流」 |
| 结束确认 | 明确提示观众无法继续、pushUrl 将清空 |
| 未配置拦截 | 无 `LIVE_*` 时弹窗「暂未配置推流」，不再误标为 live |
| 并发提示 | `LIVE_BUSY` 带出对方标题与主播名 |
| 场次看板 | `getDashboard`：配置/开关/他人直播/本场状态 |
| 观众空态 | 加载中 / 开关关闭 / 未配置 / 无直播 / **主播已结束** |
| 信号灯 | 首页 Banner「直播中」与观看页共用 `.signal-light.live` 脉冲红；Banner 另加深底/左蒙版、黄铜细线框、轻扫描线与信号条，呈 ON AIR 频道感 |
| 静音 | 观看页次要按钮样式，可切换 |
| 公告 | 开播可填一条短公告（≤80 字），观众页展示；非弹幕 |
| 安全 | `publicSession` / `getActive` 剥离 `pushUrl`；结束后清空；前端二次丢弃 |
| 滑动修复 | 去掉 `disableScroll`；表单移出 stage overlay；`scroll-view` 整页可滚 |
| 脏状态 | `status=live` 但未配 LIVE_* / 无推拉地址 → 自动 ended，不再显示「直播中」 |

新增云函数 action：`getDashboard`、`updateNotice`。

### action 一览（manageLiveSession）

| action | 谁 | 含 pushUrl？ |
|--------|-----|---------------|
| `getActive` / `getSession` | 任意（受 showLive） | 否（含 `shelf` 摘要） |
| `like` / `heartbeat` / `postMessage` / `listMessages` / `registerReminder` / `cancelReminder` | 任意登录用户 | 否 |
| `create` / `start` / `getHostSession` / `getDashboard.mine` / `updateMeta` / `updateShelf` / `setSpotlight` | 店长/超管 | 是（仅本人） |
| `end` / `forceEnd` / `updateNotice` / `listRecent` / `getDashboard.active|recent` | 店长/超管 | 否 |

### 第三轮变更摘要

| 能力 | 说明 |
|------|------|
| 稳定性 | 推/拉错误码扩展；主播弱网自动重试一次；结束后 `endedToken` + 观众轮询更快感知 |
| 店长看板 | 直播状态卡（配置/开关/本场）+ 一键结束 |
| 观众 | 公告变更提示、弱网文案、返回确认、点赞热度 |
| 文档 | 阿里云域名 `carbonchain.xin` ↔ 腾讯云 CSS CNAME 对照 |

### 第四轮变更摘要

| 能力 | 说明 |
|------|------|
| 首页 | Banner 第一帧抢插「直播中」（信号蒙版 + `.signal-light.live`）；去掉下方独立直播条 |
| 留言墙 | 集合 `live_messages`；≤40 字；约 4s 限频；粗敏感词；仅本场；主播端可见 |
| 在线人数 | `heartbeat` 写入 `presence.{key}`；TTL ~45s 计数（近似） |
| 主播端 | 翻转镜头、手电筒（后置）、`netstatus` 码率/网速提示 |
| 运营 | 开播封面上传（cloud `live/covers/`）；预约开播时间展示（非订阅提醒） |
| 分享 | `onShareAppMessage` 带 `sessionId`；`getSession` 进房 |
| 开关关闭 | 观看中关闭 `showLive` → 平滑 `closedMidway` 态，避免反复 toast |
| 电商挂车 | `shelfProductIds[]` + `spotlightProductId`；`updateShelf` / `setSpotlight`；观众半屏挂车加购/购买（复用购物车与确认下单） |

需新建集合（若尚未创建）：`live_messages`（建议权限 PRIVATE，仅云函数读写）。  
建议索引：`sessionId + ts`、`sessionId + openid + ts`（限频查询）。

### 挂车数据模型（`live_sessions`）

| 字段 | 说明 |
|------|------|
| `shelfProductIds` | string[]，最多 20，商品 `_id` 顺序即挂车顺序 |
| `spotlightProductId` | 可选，本场「讲解中」高亮一件（须在挂车内） |
| `shelfUpdatedAt` | 毫秒时间戳，便于前端感知变更 |
| `session.shelf`（响应） | `{ items[], spotlightProductId, count, purchasable, updatedAt }`；`items` 含名/价/封面/库存/是否可购/`skus[]`（多规格） |

`purchasable`：仅 `showLive` 开且场次 `status=live` 且有 `pullUrl` 时为 true；结束或关开关后观众加购/购买提示不可购。

### 第五轮变更摘要

| 能力 | 说明 |
|------|------|
| 挂车体验 | 讲解中脉冲高亮；售罄/下架禁用加购购买；主播「上一件/下一件讲解」快切 |
| 防刷 | 点赞本场一次；心跳 ≥12s；留言 ≥5s + 本场每人上限 40；挂车写 `shelfAudit` |
| 预约提醒 | `registerReminder` / `cancelReminder` → 集合 `live_reminders`；开播尽力通知 |
| 订阅消息 | 环境变量 `LIVE_REMIND_TMPL_ID`（待微信后台审模板后填写）；未配置则仅登记落库 |
| 观看统计 | `stats`：赞/留言/进房/峰值在线/提醒数；主播端推流面板展示 |
| 体验 | 挂车半屏 z-index 抬高；横屏提示建议竖屏 |

#### 预约提醒模板（待审）

1. 微信公众平台 → 订阅消息 → 申请「直播开播提醒」类模板（字段建议：活动名称 thing1 / 开播时间 time2 / 温馨提示 thing3）。  
2. 将模板 ID 写入云函数环境变量：`LIVE_REMIND_TMPL_ID=…`  
3. 重新部署 `manageLiveSession`。  
4. C 端「开播提醒我」：已配置模板时先弹 `requestSubscribeMessage` 再 `registerReminder`；未配置时仍可登记并提示「模板待审」。  
5. 开播 `start` → `notifyReminders`：有模板则尽力 `subscribeMessage.send`，无模板仅将 `live_reminders` 标为 `notified`；主播端 toast 触达结果。

### 第六轮变更摘要

| 能力 | 说明 |
|------|------|
| 订阅授权位 | `getActive` / `getSession` 返回 `remindSubscribe`（`configured` / `templateId` / `hint`）；预约页授权弹窗 + 文案区分 |
| 开播触达反馈 | `start.remindNotify`；主播端展示已发/已标记人数 |
| 挂车规格半屏 | `shelf.items[].skus`；观众加购/购买多规格时半屏选 SKU，免跳详情；无规格仍直购 |
| 结束回看占位 | `endedReplay`（封面 +「回放筹备中」）；无预约时空态展示「最近一场」；`cloud://` 封面 HTTPS 化 |
| 留言体验 | `scroll-into-view` 滚底；公告条「主播置顶」样式；主播端文案改为置顶公告 |

挂车 `session.shelf.items` 增补字段：`skus[]`（id/price/stock/specLabel/image）、`skuDimensions`、`memberDiscountEnabled`、`categoryType`。

### 后续清单（仍待）

- 完整弹幕 / 实时长连接聊天室
- 更精确在线人数与 IP/设备级防刷
- **真·录制回放**（本轮仅为结束态封面占位）
- 挂车库存实时锁 / 讲解中一键加购再打磨
- 订阅消息模板审核通过后填写 `LIVE_REMIND_TMPL_ID` 并验证真机下发
- 多路并发 / 连麦
- Admin Web 场次运营台

---

## 10. 阿里云域名 + 腾讯云 CSS CNAME（示例）

现网可先用腾讯云默认推/播域做联调（如 `*.push.tlivecloud.com` / `*.liveplay.myqcloud.com`）。  
正式建议把**自有域名**（示例：`carbonchain.xin`，DNS 在阿里云）接到 CSS：

| 用途 | 建议主机名示例 | `LIVE_*` 填法 |
|------|----------------|---------------|
| 推流 | `livepush.carbonchain.xin` | `LIVE_PUSH_DOMAIN=livepush.carbonchain.xin` |
| 播放（HTTPS） | `live.carbonchain.xin` | `LIVE_PLAY_DOMAIN=live.carbonchain.xin` |

### 步骤（简版）

1. **腾讯云 CSS** → 域名管理 → 添加推流域名 `livepush.carbonchain.xin`、播放域名 `live.carbonchain.xin`（二者必须不同）。  
2. 控制台会给出 **CNAME 目标**（推流常见 `*.tlivepush.com`，播放常见 `*.txlivecdn.com`，以控制台为准）。  
3. **阿里云 DNS**（域名 `carbonchain.xin`）→ 解析设置 → 各加一条：

| 主机记录 | 类型 | 记录值 |
|----------|------|--------|
| `livepush` | CNAME | 腾讯云推流 CNAME 目标 |
| `live` | CNAME | 腾讯云播放 CNAME 目标 |

4. 播放域名上传 **HTTPS 证书**（可用阿里云免费 DV / 上传 PEM 到腾讯云 CSS）。  
5. 推流、播放鉴权主 KEY **设为相同** → 写入云函数 `LIVE_AUTH_KEY`（**勿写入仓库**）。  
6. 微信小程序 request 合法域名增加：`https://live.carbonchain.xin`。  
7. 更新环境变量后验证冷启动；开播地址应变为自有域名。

> 备案：国内节点需 ICP 备案主体与云账号要求一致。未备案前可继续用腾讯云默认播域联调，但小程序正式版 HTTPS 播放更推荐自有已备案域。

---

## 8. 官方文档（遇界面变更时查阅）

- 腾讯云： [域名管理与 CNAME](https://cloud.tencent.com/document/product/267/45252)、[推流配置 / 鉴权](https://cloud.tencent.com/document/product/267/32833)  
- 微信： [live-player](https://developers.weixin.qq.com/miniprogram/dev/component/live-player.html)、[live-pusher](https://developers.weixin.qq.com/miniprogram/dev/component/live-pusher.html)
