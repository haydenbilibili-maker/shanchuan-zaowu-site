# 店长 / 超管：新订单触达说明

> 📖 **要新建/配置模板？** 见 `docs/小程序订阅通知模板配置教程.md`（逐字段参数、平台操作步骤、错误码排查）。
> 本文只说明**已上线**的订单模板。

支付履约成功后，系统向超管与店长发送 **工作流站内信**（`staff_order_paid`），并尽力下发 **微信订阅消息**。前端在进入店长台 Hub 或「我的」时对未读新订单加强弹窗（同单本地去重，不狂弹）。

## 触达通道

| 通道 | 机制 | 失败影响 |
|------|------|----------|
| 山海有信 · 工作流 | `dispatchMessage` → `user_messages`（queue=`workflow`） | 失败不阻断履约 |
| 工作台弹窗 | 店长台 Hub /「我的」`showModal` + 轻振动 | 仅本机 |
| 微信订阅消息 | `cloud.openapi.subscribeMessage.send` | **未授权 / 无额度 → 43101**；字段不符 → 47003 |

## 已配置的订阅消息模板

| 项 | 值 |
|----|-----|
| 模板 ID | `MLNyj-ejvgFLt5mBWXEtIUJL59ZaJREtWhLJq6SRbtk` |
| 场景说明 | 有新的订单提示店长 |
| 云函数 env | `STAFF_ORDER_PAID_TMPL_ID` → `payCallback`、`confirmPayment` |
| 客户端常量 | `utils/staffOrderSubscribe.js` 同 ID（用于 `requestSubscribeMessage`） |

### 字段映射（与公众平台「详细内容」一致）

| 关键词 | 含义 | 来源 | 限制 |
|--------|------|------|------|
| `character_string1` | 订单编号 | `order.orderNo` | ≤32，数字/字母/符号 |
| `thing2` | 商品 | 商品标题摘要 | ≤20 字，截断 |
| `time5` | 下单时间 | `createTime` / `payTime` | 如 `2026年9月14日 11:15` |
| `thing3` | 收货人名 | `address.name`；礼赠待填址 / 自提有占位 | ≤20 |
| `thing4` | 收货地址 | 省市区+详情；礼赠待填址 / 自提有占位 | ≤20，截断 |

下发 `data` 示例：

```json
{
  "character_string1": { "value": "SH20260914001" },
  "thing2": { "value": "帝王蝴蝶标本×1" },
  "time5": { "value": "2026年9月14日 11:15" },
  "thing3": { "value": "张三" },
  "thing4": { "value": "上海市徐汇区某某路1号" }
}
```

组装逻辑：`cloudfunctions/payCallback|confirmPayment/staffOrderSubscribe.js`。

## 店长 / 超管如何授权（必做）

微信 **一次性订阅消息** 规则：

1. `requestSubscribeMessage` **必须由用户点击同步触发**（不能在页面 onShow / 异步请求回调里调）
2. 每次点「允许」只攒 **1 次** 下发额度；发完即尽，需再次允许
3. 若勾选「总是保持以上选择 · 拒绝」，之后不再弹窗 → 需到小程序设置里改回

### 推荐操作

1. 使用店长或超管微信打开 **正式版** 小程序  
2. 进入 **店长工作台 Hub**  
3. 点经营菜单 **「订通知」**（或下方「新订单微信通知」）→ 弹窗勾选模板并 **允许**  
4. 或：从「我的」点工作台入口、点「订单」、或在新订单弹窗点「去处理 / 稍后」时也会尝试弹授权  
5. 下一笔支付成功后，应收到微信 **服务通知**

未授权时：站内信 + 工作台弹窗仍可用。

### 排障（查 `notification_logs`，channel=`subscribe`）

| skipReason / 现象 | 含义 | 处理 |
|-------------------|------|------|
| `USER_REFUSED_OR_NO_QUOTA(43101)` | 未允许或额度已用尽 | 再点「新订单微信通知」允许 |
| `ARG_ERROR(47003)` | 模板字段/内容非法 | 核对方字段与截断 |
| `TMPL_PENDING` | 云函数未配模板 ID | 配 `STAFF_ORDER_PAID_TMPL_ID` 并部署 |
| 从未出现 success 记录 | 授权从未成功 | 确认在 **点击** 路径弹过授权且点了允许 |

## 相关文件

- `cloudfunctions/payCallback/staffNotify.js` / `staffOrderSubscribe.js` / `fulfillOrder.js`
- `cloudfunctions/confirmPayment/`（同上）
- `cloudfunctions/dispatchMessage/templates.js`（`staff_order_paid` 文案）
- `subpackages/manager/manager/managerPageConfig.js`（工作台弹窗 / `enableStaffOrderWxNotify`）
- `pages/user/index.js`（「我的」弹窗）
- `utils/staffOrderSubscribe.js` / `utils/managerAuth.js`（客户端授权，点击触发）
- `cloudbaserc.json`（`envVariables.STAFF_ORDER_PAID_TMPL_ID`）

## 部署

```bash
./scripts/tcb-fn-deploy.exp payCallback cloud1-8gnkty5bfff9f0bf
./scripts/tcb-fn-deploy.exp confirmPayment cloud1-8gnkty5bfff9f0bf
```

客户端改动（授权入口）随小程序发版 / 预览生效，无需单独部署。

## 验证清单

1. `tcb fn detail payCallback` / `confirmPayment` 环境变量含 `STAFF_ORDER_PAID_TMPL_ID`  
2. 店长真机点 Hub「新订单微信通知」→ 出现订阅授权并允许  
3. 下一笔支付 → 工作流站内信 + 微信服务通知；`notification_logs` 出现 `status=success`  
4. 若仍无服务通知：看 `skipReason` 是否仍为 43101（再授权一次）  
