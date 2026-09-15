# 礼赠运维：催填 / 过期退款 / 自提核销 / 订阅 / 索引

环境：`cloud1-8gnkty5bfff9f0bf`  
云函数：`manageGift`、`getGiftSceneProducts`、`refundOrder`、`makeOrder`、`payCallback`、`confirmPayment`、`manageProducts`

## 定时器

`manageGift/config.json` 已配置触发器 `giftDailySweep`（每天 10:00）：

- 执行 `dailySweep` = `nudgeSweep` + `expireSweep`
- 需在云开发控制台确认触发器已启用
- 建议配置环境变量 `GIFT_EXPIRE_INTERNAL_KEY`（或复用 `PAY_CALLBACK_INTERNAL_KEY`），供定时器无用户身份时鉴权

## 手动执行

```bash
# 自动催填 D+3 / D+6
tcb fn invoke manageGift -e cloud1-8gnkty5bfff9f0bf --params '{"action":"nudgeSweep"}'

# 过期扫描并全额退
tcb fn invoke manageGift -e cloud1-8gnkty5bfff9f0bf --params '{"action":"expireSweep"}'

# 合并
tcb fn invoke manageGift -e cloud1-8gnkty5bfff9f0bf --params '{"action":"dailySweep"}'
```

带 internalKey（与环境变量一致）时可不登录：

```json
{ "action": "dailySweep", "internalKey": "<GIFT_EXPIRE_INTERNAL_KEY>" }
```

## 规则摘要

| 项 | 规则 |
|---|---|
| 填址有效期 | 支付成功起默认 7 日（`giftMeta.expireAt`） |
| 自动催填 | D+3、D+6 各 1 次（`nudgeAutoDay3` / `nudgeAutoDay6`） |
| 手动催填 | 送礼人每日最多 1 次 |
| 过期 | → `expired_refunding` → `refundOrder.giftExpireRefund` 全额退 → `refunded` |
| 自提核销 | 扫码 `GIFT:{claimCode}` → `manageGift.verifyPickup` → `received` |
| 可礼赠商品 | `products.giftEligible !== false`（缺省视为可礼赠） |
| 礼赠场景标签 | `products.giftScenes: string[]`（英文 key，与兴趣 `tags` 分离；字典见 `utils/giftScenes.js`） |

## 礼赠场景选品

云函数：`getGiftSceneProducts`

```bash
tcb fn invoke getGiftSceneProducts -e cloud1-8gnkty5bfff9f0bf --params '{"scene":"wedding","limit":6}'
tcb fn deploy getGiftSceneProducts --force
tcb fn deploy manageProducts --force
```

匹配规则：

1. 仅 `giftEligible !== false` 且未下架
2. **优先** `giftScenes` 含该场景 key 的商品
3. 不足时兜底：同品类（可选）→ 热门/可礼赠（`matchSource: fallback`）
4. 存量无标签不强制补标；列表可用 `manageProducts.list` 传 `giftScene`

## 礼笺语音

| 项 | 说明 |
|---|---|
| 录制 | 编排页按住说话（`RecorderManager` aac，最长 60s）→ `wx.cloud.uploadFile` → `gift/voice/` |
| 字段 | `giftMeta.voiceFileID`、`giftMeta.voiceDuration`（秒）；与 `cardBody` 可并存，至少其一 |
| 下单 | `makeOrder.normalizeGiftMeta` 写入；支付履约透传既有 meta |
| 播放 | 领取页「听 TA 说」；`manageGift.getShare` / `getGiftVoice` 鉴权后下发临时链 |
| 权限 | 送礼人 / 有效 shareToken / 已绑定收礼人；防 fileID 遍历 |
| 客户端模块 | `subpackages/feature/gift/giftVoice.js`（与落笔文字动画解耦） |

## 自提领取码

| 项 | 说明 |
|---|---|
| 生成时机 | `makeOrder`（`store_pickup`）+ 支付履约兜底 |
| 码形 | 短 hex 大写；二维码 payload=`GIFT:{claimCode}` |
| C 端 | 支付成功页展示码 + QR |
| 店员 | `staff/field` 核销 Tab 扫码（与 `BOOKING:` / `COUPON:` 分流） |
| 权限 | `verifyGiftPickup`（店员/店长默认；曾挂在 verifyBooking，现已拆分） |

## 订阅消息

微信模板审核通过前：

1. 山海有信已覆盖催填 / 发货 / 领取 / 过期节点
2. 客户端 `subpackages/feature/utils/giftSubscribe.js` 中常量空时 **静默跳过** `requestSubscribeMessage`（`skipped: true`），success 页展示克制提示「进度将经山海有信送达」
3. 云函数 **未配置环境变量时不调用** `subscribeMessage.send`（不假接成功）
4. 催填 / 支付后授权失败或用户拒绝：不弹错误 toast，有信仍可达

### 配置位（审核通过后 · 控制台）

| 位置 | 键 | 用途 |
|---|---|---|
| 云函数 env：`manageGift` / `confirmPayment` / `payCallback` | `GIFT_NUDGE_TMPL_ID` | 支付成功提醒填址/分享、手动/自动催填 |
| 同上 | `GIFT_FULFILL_TMPL_ID` | 收礼人填址完成 → 送礼人 |
| 同上 | `GIFT_EXPIRE_TMPL_ID` | D+6 即将过期、超时退款（可空，回退 NUDGE） |
| 客户端常量（同名） | 同上 | success / 催填前弹授权；须与云端一致 |

### 运维步骤（仅控制台可配密钥/模板）

1. 微信公众平台 → 订阅消息 → 申请并审核通过模板，记下模板 ID  
2. 云开发控制台 → 云函数 → 分别打开 `manageGift` / `confirmPayment` / `payCallback` → 环境变量 → 写入上表三键（`GIFT_*_TMPL_ID`）  
3. 客户端：编辑 `subpackages/feature/utils/giftSubscribe.js` 顶部三个常量，填入同名模板 ID（授权弹窗依赖）  
4. `tcb fn deploy manageGift confirmPayment payCallback --force`  
5. 真机：支付成功页应弹出授权；催填 / 填址 / 过期路径验证下发  

真发节点（有模板 ID 才 send）：

- 支付成功且 `invite_address` → `paid_await_address`
- 手动催填 / 自动 D+3 → `nudge`；D+6 → `expire`
- 填址提交 → `fulfill`
- 过期退款 → `expire`

**禁止**：未配置模板 ID 时调用假模板或伪造下发成功。

参考直播占位：`docs/live-streaming.md` 的 `LIVE_REMIND_TMPL_ID`。

## 店长履约看板

入口：店长工作台 → 门店现场 → **礼赠管理**（`subpackages/manager/gift-manage`）→ 履约看板；或直达 **礼赠履约**（`subpackages/manager/gift-ops`，无管理入口时回退）

云函数：`manageGift.listBoard` / `getBoardDetail` / `getSettings` / `saveSettings`

| 栏位 | 条件摘要 |
|---|---|
| 待填址 | `paid_awaiting_address` / 先付后填址未提交地址 |
| 待发货 | 礼赠已付且可发（非自提闸门） |
| 自提待核销 | `store_pickup` 且未 claimed |
| 已完成 | 签收 / 退款 / 过期等 |

管理端展示完整收件信息；C 端领取页展示脱敏手机与地址。待填址单仍不可在订单管理发货。

## 超管礼赠管理（运营总控）

入口：超管/店长工作台 → 门店现场 → **礼赠管理**

| 能力 | 说明 |
|---|---|
| 内容开关 | 只读联动 `content_display_flags.showGift`；超管可跳转内容开关 |
| 简易数据 | 今日 / 近 7 日礼赠单量、待办分桶（读 `listBoard` 同源采样） |
| 履约看板 | 跳转既有 `gift-ops` |
| 配置 | 集合 `gift_settings`：`addressFillTimeoutDays`（3/7/14）、`defaultDeliveryType`、`allowHidePriceToggle` |
| 催填摘要 | D+3 / D+6（展示；扫码逻辑仍按现网硬编码） |
| 订阅状态 | 读环境变量 `GIFT_*_TMPL_ID` 是否已配置（不假接） |
| 权限 | `getSettings` 需 `giftOps`（店长可读）；`saveSettings` 需 `manageGift`（仅超管） |

```bash
# 创建集合 gift_settings（控制台，权限仅云函数可写）
tcb fn deploy manageGift --force
# 超时天数对新下单生效（makeOrder 读 gift_settings）
tcb fn deploy makeOrder --force
```

## 索引建议（控制台手动创建，或见脚本说明）

集合 `orders`：

| 索引字段 | 用途 |
|---|---|
| `status` + `giftMeta.expireAt` | 过期扫描 |
| `giftMeta.shareToken` | 领取链接 |
| `giftMeta.claimCode` | 自提核销 |
| `status` + `paidTime` | 催填扫描 |

集合 `products`：

| 索引字段 | 用途 |
|---|---|
| `giftScenes`（数组） | `getGiftSceneProducts` / `manageProducts.list?giftScene=` |

控制台路径：云开发 → 数据库 → 对应集合 → 索引管理。

脚本说明见 `scripts/ensure-gift-indexes.cjs`（打印建议，不自动改生产索引）。
