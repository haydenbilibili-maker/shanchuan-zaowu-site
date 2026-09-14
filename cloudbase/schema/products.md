# products · 商品 SKU

> 加厚于审计跟进 2026-09-14。写权限：客户端 `write: false`，经 `manageProducts` 等店长云函数。

## 用途

馆藏商品主数据；C 端只读列表/详情。

## 权限

见 `database-rules/products.json`：`read: true`，`write: false`。

## 核心字段（代码实证）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 商品 ID |
| `title` / `name` | string | 展示名 |
| `price` / `originalPrice` | number | 售价 / 原价 |
| `stock` | number | 库存 |
| `categoryId` | string | 分类 |
| `isOffShelf` | boolean | 下架 |
| `images` / `cover` | array/string | 主图 |
| `species` / `latin` | string | 物种信息 |
| `framerId` | string | 装裱师（可选） |
| `protectionType` | string | 防护/裱装类型 |
| `tags` / `giftScenes` | array | 标签与礼赠场景 |
| `updatedAt` | number/date | 更新时间 |

## 维护

店长改价/库存/上下架勿绕过 `manageProducts`。
