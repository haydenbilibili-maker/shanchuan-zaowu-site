# purchase_intents · 官网报价单采购意向

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 官网 [`/price-list`](../../src/pages/price-list.astro) 提交采购意向（`src/lib/purchaseIntent.ts`）
- ERP「采购意向」列表读/改状态（`admin/src/components/PurchaseIntents.vue`）

## 控制台步骤（无 CLI 时）

1. [云开发控制台](https://console.cloud.tencent.com/tcb) → 环境 `cloud1-8gnkty5bfff9f0bf` → **数据库** → **新建集合** → `purchase_intents`
2. 集合 → **权限设置** → **自定义安全规则** → 粘贴 [`../rules/purchase_intents.json`](../rules/purchase_intents.json)
3. 确认 **登录授权 → 匿名登录** 已开启；**Web 安全域名** 含官网与本地开发域名

## 安全规则要点（A1）

当前官网与 Web ERP 均使用 `signInAnonymously`，云库侧无法区分「访客」与「管理员」。

| 操作 | 规则 | 说明 |
|------|------|------|
| read | `auth != null` | 已登录（含匿名）可读；**未登录不可读全表** |
| create | `auth != null` | 官网匿名登录后可提交 |
| update | `auth != null` | ERP 改 `status` |
| delete | `false` | 禁止客户端删除 |

A2+（管理端改为 CUSTOM / EMAIL 登录后）可将 read/update 收紧为：

```json
{
  "read": "auth != null && auth.loginType != 'ANONYMOUS'",
  "create": "auth != null",
  "update": "auth != null && auth.loginType != 'ANONYMOUS'",
  "delete": false
}
```

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `contactName` | string | 联系人 |
| `contactPhone` | string | 电话/微信 |
| `company` | string? | 公司/店铺 |
| `note` | string? | 备注 |
| `items` | array | SKU 明细（skuId / name / quantity / price…） |
| `status` | string | `pending` \| `contacted` \| `closed` |
| `source` | string | 固定 `price-list` |
| `totalAmount` | number\|null | 估算合计（区间价按下限） |
| `createdAt` | number | 毫秒时间戳 |
| `createTime` | number | 与 createdAt 对齐 |
| `updatedAt` | number? | ERP 改状态时写入 |
| `_openid` | string | 登录态自动写入 |

## 推荐索引

| 字段 | 排序 | 说明 |
|------|------|------|
| `createdAt` | 降序 | 列表时间序 |
| `status` + `createdAt` | — | 按状态筛选 |

## CLI 开通

见 `admin/scripts/provision-purchase-intents.mjs`（需 `admin/.env` 中 `TCB_SECRET_ID` / `TCB_SECRET_KEY`）。
