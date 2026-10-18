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
| `images` / `cover` | array/string | 主图（**只放图片**；`images[0]` = 全站封面） |
| `media` | array（可选） | 视频 / 实况：`[{ type: 'video'\|'live', url, poster, duration, width, height, size }]`，≤3 段、≤60s、≤50MB；只有详情页主图轮播读它，缺省 = 无视频。2026-09-28 新增，见 `miniprogram/docs/藏品视频与实况_2026-09-28.md` |
| `externalVideos` | array（可选） | 外平台实拍视频：`[{ platform: 'channels'\|'bilibili'\|'douyin'\|'xiaohongshu', title, url, bvid, feedId, finderUserName, feedToken, sameSubject }]`，≤3 条；视频号（sph ID + feedId）小程序内可嵌入（同主体或带 feedToken），其余平台只存 https 白名单链接、详情页显示卡片 + 复制链接。ERP 藏品档案库录入，店长端不送此字段。2026-10-18 新增，见 `miniprogram/docs/藏品视频_外平台与云存储评估_2026-10-18.md` |
| `species` / `latin` | string | 物种信息 |
| `framerId` | string | 装裱师（可选） |
| `protectionType` | string | 防护/裱装类型 |
| `tags` / `giftScenes` | array | 标签与礼赠场景 |
| `updatedAt` | number/date | 更新时间 |

## 维护

店长改价/库存/上下架勿绕过 `manageProducts`。
