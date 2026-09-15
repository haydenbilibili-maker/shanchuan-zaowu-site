# products / orders 数据库安全规则

环境：`cloud1-8gnkty5bfff9f0bf`  
配置脚本：`scripts/configure-products-orders-security-rules.cjs`  
版本化规则：`database-rules/`

## 改前（现网快照）

| 集合 | 权限 | 规则 |
|------|------|------|
| `products` | CUSTOM | `read: true`, `write: true` |
| `orders` | CUSTOM | `read: auth != null`, `write: auth != null` |

任意客户端可改商品上下架、订单退款相关字段。

## 改后（已 API 应用并回读确认）

| 集合 | 权限 | 规则 |
|------|------|------|
| `products` | CUSTOM | `read: true`, `write: false` |
| `orders` | CUSTOM | `read: auth != null`, `write: false` |

云函数仍可读写；客户端不可直写这两张表。

## 字段级尝试与 blocker

目标规则（`*.field-level.desired.json`）用 `request.data` 锁定：

- `products.isOffShelf`
- `orders` 退款态 / `refund*` 字段

实测：`modifyResourcePermission` 对含 `request.data` 的 CUSTOM 规则返回 `Success: true`，但 `describeResourcePermission` **仍为旧规则**（静默不落库）。  
不含 `request.data` 的 `read`/`write` 或简单 `create`/`update`/`delete` 可正常落库。

因此当前只能用集合级 `write: false` 达成「禁止客户端改敏感字段」；副作用是所有客户端直写一并禁止。

## C 端可用性

| 能力 | 状态 |
|------|------|
| 读商品列表/详情 | 可用（`read: true`） |
| 下单 | 可用（`makeOrder` 云函数） |
| 读自己的订单 | 可用（需登录；`auth != null`） |
| 申请/执行退款 | 可用（`refundOrder`） |
| 确认收货 | 可用（`confirmOrderReceipt` 云函数） |
| 店长端商品保存/生产态 | 可用（`manageProducts` / `managerShipOrder.advanceProduction`） |

## 复现命令

```bash
node scripts/configure-products-orders-security-rules.cjs --dry-run
node scripts/configure-products-orders-security-rules.cjs
```
