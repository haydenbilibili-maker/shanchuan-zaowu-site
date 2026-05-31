# 山海造物小程序 · 平台能力说明

> **文档用途**：供 Claude、Cursor 等 AI 助手与工程师快速理解本仓库「当前已实现」的能力边界、技术栈与模块划分。  
> **品牌与视觉原则**：见 `docs/brand-vi-manual-v2.md`；界面 Design Token 见根目录 `.cursorrules` 与 `app.wxss`。

---

## 1. 产品定位

- **形态**：微信小程序 + **微信云开发**（云函数 + 云数据库 + 云存储）。
- **业务域**：自然标本电商与内容社区——含商品浏览与下单、预约/票务、馆藏与购物车、社区互动、会员与积分、优惠券与拼团/秒杀、AI 标本鉴定、店长/内容管理端（小程序内嵌）、AR 等能力（以代码实现为准）。
- **语言**：面向用户界面以简体中文为主；品牌英文规范见品牌手册。

---

## 2. 技术栈概览

| 层级 | 技术 |
|------|------|
| 客户端 | 微信小程序原生（WXML / WXSS / JS），`style: v2`，`lazyCodeLoading: requiredComponents` |
| 自定义 Tab | `custom-tab-bar`（cover-view） |
| 富文本 | 组件内嵌 `mp-html`（详情/文章等） |
| 服务端 | 微信云函数（Node.js，`wx-server-sdk`） |
| AI 鉴定 | 云函数 `identifySpecimen` 使用阿里云 **DashScope（通义）** 多模态/文本接口（需环境变量 `DASHSCOPE_API_KEY`） |
| 监控与工具 | `utils/errorMonitor.js`、`utils/performance.js`、`utils/cache.js`、`utils/imageLoader.js` 等 |

**云环境 ID**：在 `app.js` 的 `wx.cloud.init({ env: '...' })` 中配置；换环境时需同步改云函数部署环境与数据库。

---

## 3. 小程序页面与分包

### 3.1 主包页面（`pages/`）

| 模块 | 路径示例 | 能力摘要 |
|------|----------|----------|
| 首页 | `pages/index/index` | 轮播、推荐、票务卡片、展览位等（数据多来自 `getHomeConfig` / 数据库） |
| 馆藏 | `pages/category/index` | 馆藏 Tab（档案 + 可购商品） |
| 社区 | `pages/community/index` | 社区内容流、互动 |
| 预约 | `pages/booking/index` | 预约/活动报名，调用 `createBooking`、`updateBooking`、`cancelBooking`、`sendBookingReminder` 等 |
| 购物车 | `pages/cart/index` | 购物车与结算链路 |
| 我的 | `pages/user/index` | 会员信息、签到、等级、入口聚合 |
| 成就 | `pages/user/achievements/index` | 成就体系，`getUserAchievements` |
| 消息 | `pages/user/messages/index` | 山海有信站内信，`getUserMessages` |
| 联系专员 | `pages/user/support/index` | 咨询主题、微信/电话/留言、FAQ，`getSupportConfig` |
| 详情 | `pages/detail/index` | 商品详情、评论组件 |
| 评论 | `pages/comment/index` | 评论发表，`submitComment`、`getComments`、`likeComment` |
| 搜索 | `pages/search/index` | 搜索，`getHotSearchKeywords` 等 |
| AI 鉴定 | `pages/identify/*` | 拍照/选图 → `identifySpecimen` → 结果/分享海报 `generateSharePoster` |
| 收藏夹 | `pages/collection/*`、`pages/collection-detail/index` | 用户藏品夹，`getCollections`、`toggleCollection`、`createCollectionFolder`、`moveCollectionItems` 等 |
| 拼团/秒杀 | `pages/group-buying/index`、`pages/seckill/index` | `createGroupBuying`、`joinGroupBuying`、`seckillOrder` |
| 文章/视频 | `pages/articles/*`、`pages/videos/index` | 内容栏目，`getArticles` |
| 自定义 Tab | `custom-tab-bar/index` | 底部导航 |

### 3.2 分包 `subpackages/business`（`name: business`）

减轻主包体积，与订单、积分、证书、店长后台、关于页、AR 等相关：

- `my-bookings`、`ticket`、`orders`、`order-detail`
- `points`、`coupons`、`certificate`
- `manager`（管理后台）、`framer`
- `about`、`ar`

预加载：`app.json` 中 `preloadRule` 对首页与「我的」预加载 `business` 包。

---

## 4. 云函数清单（按职责）

以下为仓库内 **已存在** 的云函数目录名，具体入参/出参以实现代码为准。

### 4.1 身份与基础

- **`login`**：获取用户 OpenID，供客户端 `app.js` 初始化身份上下文。

### 4.2 商品、订单与支付相关

- **`makeOrder`**：创建订单、库存扣减、优惠券核销等与 `products`、`user_coupons` 等集合交互。
- **`refundOrder`**：退款流程。
- **`seckillOrder`**：秒杀下单。
- **`createGroupBuying`** / **`joinGroupBuying`**：拼团创建与参团。

### 4.3 预约与到店

- **`createBooking`** / **`updateBooking`** / **`cancelBooking`**：预约/活动报名与变更。
- **`sendBookingReminder`**：预约提醒（如订阅消息或内部逻辑）。
- **`addToWaitlist`**：候补队列。

### 4.4 用户、会员与运营

- **`getUserStats`** / **`getUserStatistics`**：用户等级、积分、成长值等统计（注意：可能存在两套统计口径，以调用处为准）。
- **`earnPoints`** / **`redeemReward`**：积分获取与兑换。
- **`getUserAchievements`**：成就数据。
- **`getUserMessages`**：站内消息。
- **`receiveCoupon`** / **`transferCoupon`** / **`getBestCoupon`**：优惠券领取、转赠与最优券。
- **`trackUserBehavior`**：行为埋点。

### 4.5 内容与社区

- **`getArticles`**：文章列表/详情数据源。
- **`getComments`** / **`submitComment`** / **`likeComment`**：评论体系。
- **`getWikiData`** / **`getArchiveData`**：馆藏/档案类数据。
- **`getHotSearchKeywords`** / **`getRecommendations`** / **`getHomeConfig`**：搜索热词、推荐、首页配置。

### 4.6 收藏与「想要」

- **`getCollections`** / **`toggleCollection`** / **`createCollectionFolder`** / **`updateCollectionFolder`** / **`moveCollectionItems`** / **`getCollectionRecommendations`**：用户收藏夹与推荐。
- **`toggleWant`**：「想要」标记类能力。

### 4.7 AI 与分享

- **`identifySpecimen`**：标本图像识别 + 文案生成 + 记录落库（依赖 DashScope API Key）。
- **`generateSharePoster`**：鉴定结果分享海报后端数据/合成辅助。
- **`generateShareCard`**：商品分享卡片文案等（返回供前端 Canvas 使用）。

### 4.8 管理与运维

- **`manager` 相关能力**：实际管理逻辑主要在 **小程序端 `pages/manager`（及分包镜像）** 内通过云函数与数据库交互；云函数侧含 **`syncFinanceData`** 等与经营数据同步相关能力（以函数内实现为准）。
- **`logError`**：前端/云端错误上报。

---

## 5. 数据存储（推断）

云函数代码中出现的集合名包括但不限于：

- `products`（商品与库存）
- `user_coupons`（用户优惠券）
- 以及订单、预约、用户、评论、文章、鉴定记录等业务集合（**以各云函数 `db.collection('...')` 为准**）。

**说明**：本文件不替代数据库设计文档；做迁移或新增字段时应检索 `cloudfunctions/**/*.js` 中的集合名与字段。

---

## 6. 客户端工具与组件

### 6.1 `utils/`

| 文件 | 用途 |
|------|------|
| `errorMonitor.js` | 错误监控，可联动 `logError` |
| `performance.js` | 性能计时 |
| `cache.js` | 缓存策略 |
| `imageLoader.js` | 图片加载优化 |
| `identifyImage.js` | 鉴定相关图片处理 |
| `speciesCategory.js` | 物种/品类映射 |
| `financeSync.js` | 财务数据同步（与店长/经营相关） |
| `util.js` | 通用工具 |

### 6.2 `components/`

- **`ProductCard`**、**`TicketCard`**：商品/票务卡片。
- **`SpeciesCard`**：物种展示。
- **`CommentList`**：评论列表。
- **`Calendar`**：日历/预约相关。
- **`mp-html`**：富文本渲染。

---

## 7. 权限与隐私（`app.json`）

- **`requiredPrivateInfos`**：`chooseAddress`（收货地址）。
- **`permission`**：`scope.camera`（AR、AI 鉴定拍照）、`scope.writePhotosAlbum`（保存 AR 合成图等）。

---

## 8. AI 助手使用本仓库时的建议

1. **改业务先找调用链**：从前端 `wx.cloud.callFunction({ name: '...' })` 定位到 `cloudfunctions/<name>/index.js`。
2. **环境变量**：`identifySpecimen`、`assistProductCopy`、`assistExhibitionCopy` 依赖 **`DASHSCOPE_API_KEY`**；未配置时云函数返回明确错误，不会静默降级为 mock。
3. **店长后台**：能力集中在 **管理相关页面 + 云函数 + 数据库**，并非独立 Web ERP；与 `docs/brand-vi-manual-v2.md` 中「Studio Mode / ERP」为产品规划用语时，以本仓库实际页面为准。
4. **一致性**：全局样式变量在 `app.wxss`；品牌文案忌中英混排单行，参见品牌手册。

---

## 9. 版本与维护

- **小程序基础库**：`project.config.json` 中 `libVersion`（如 `3.11.2`）为工具链参考。
- **文档更新时机**：新增页面/云函数、变更支付或鉴权流程、变更数据库集合时，应同步更新本节或补充链接到更细的模块文档。

---

*文档生成自代码库结构梳理，如有与线上一致性差异，以已部署云函数与微信后台配置为准。*
