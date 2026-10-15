# 源码注记（从主包源码迁出的长注释原文）

> 2026-10-01 A 流细节雕刻：主包超 1.5M 推荐线，把主包源码里的长块注释**原文**迁到这里（docs/ 不入包），
> 源码保留首行摘要、全部「⚠️」约束行与「注记 编号」指针。迁移前后 esbuild 压缩产物逐字节一致（代码零改动）。
> 改源码时按编号回这里查完整背景；新增长注释请直接写在本文件、源码只留一行。

## utils/wishWall.js

### W1 · `/** 与云函数 manageWishWall 保持一致（客户端先校验一次，省一次无效请求） */`

```text
需求 28：「马上有」弹幕祈福墙 —— 客户端纯函数基座
单独成模块的原因：弹幕布局、文案校验、商品命中判定都是**可测的纯逻辑**，
混在 Page 里就只能靠肉眼在真机上确认。三类逻辑各有历史坑：
  1. 轨道分配若随机，同一屏两条会重叠 → 必须确定性分配 + 轨道内错开；
  2. 时长若固定，长文案会跑得比短文案快 → 必须按字数换算，保持**视觉匀速**；
  3. 商品命中若只看标题子串，未来任一标题含「马上有」的藏品都会长出祈福墙
     → 优先看显式字段 `wishWallEnabled`，子串只作过渡兜底。
```

### W2 · `const LANES = 6`

```text
弹幕轨道数。
4 → 6（2026-09-18 真机截图）：380rpx 高的浅纸墙只摊 4 行 28rpx 小字，看着空、
同一时刻能看见的心愿也太少。改 6 轨 + 字号 32rpx 后，轨间距 (380-44)/5 ≈ 67rpx、
行盒 32×1.3 ≈ 42rpx（余 ~25rpx），既不挤也不会糊成一片；
26 条心愿下每轨排 4–5 条，墙上同时有 6 条在走。
⚠️ 改这个数必须同时改 `.ww-wall-rail.rail-N` 的条数与百分比（守卫按 LANES 对账）。
```

### W3 · `const LIST_LIMIT = 30`

```text
一面墙最多回多少条（与云函数 `manageWishWall` 的 `LIST_MAX` **必须相等**）。
两处用途：① 请求 `limit`；② 列表到底时判断该说「共 N 条」还是「仅展示最近 N 条」。
所以它必须与服务端同源 —— 守卫会直接读云函数源码比对，防漂移。
```

### W4 · `const DAILY_LIMIT = 5`

```text
每人每日可写条数（与云函数 `manageWishWall` 的 `DAILY_LIMIT` **必须相等**）。
客户端只用它做「还能写几条」的预告，**不做拦截** —— 最终判定始终在服务端。
守卫会直接读云函数源码比对，防漂移。
```

### W5 · `function dailyQuota(rows, nowMs, limit) {`

```text
今日额度：服务端按 **Asia/Shanghai 自然日 + 本面墙** 统计该 openid 的条数，
且**不分可见 / 已收起**（被馆方收起的也算当天用量）。客户端按同一口径预告。
```

### W6 · `const SPEED_RPX_PER_SEC = 96`

```text
视觉速度：rpx/秒。时长 = (屏宽 + 文案宽) / 速度
2026-09-24：90 → 78 → 72（出图复核偏慢）。
2026-09-26 B 站式：72 → 96 —— 流速更接近滚动弹幕观感；时长仍落在 6–26s 守卫窗内。
```

### W7 · `const CHAR_RPX = 33`

```text
单字占宽 ≈ 33rpx。
⚠️ 这个数必须跟着 `.ww-danmaku` 的 font-size 走（字号 + 0.02em 字距 ≈ 字号 ×1.03）：
它是**同轨不重叠**的唯一依据（clearMs 按它算），估小了后一条会在前一条尾部还在屏内时进场。
2026-09-18：字号 28 → 32rpx（真机截图里 4 轨 ×28rpx 摊在 380rpx 的浅纸墙上显得空且小），
这里同步 28 → 33。守卫按"字号 ×1.03 ≈ CHAR_RPX"实算断言，两边不会再各自漂移。
```

### W8 · `const SLIP_PAD_RPX = 28`

```text
挂签条左右垫 + 钉头的固定占宽（rpx）。
2026-09-26「活墙」：弹幕从裸字升级为纸签条，几何变宽；若不计入 clearMs，同轨会叠签。
2026-09-26 B 站式：纸签改薄皮（更像弹幕皮肤），垫宽 40 → 28。
只进宽度估算，不改 CHAR_RPX / 字号守卫口径。
```

### W9 · `const LANE_GAP_MS = 300`

```text
同一轨道内两条弹幕之间的**视觉间隙**（毫秒）。
⚠️ 历史事故：这个常量曾经是「两条弹幕的进场间隔」的全部依据，取值 900ms ——
而单条弹幕穿越要 6–26 秒，于是同一条轨道上后面 3 条在前一条还在屏内时就冲进来，
4 条轨道各叠 4 条，整面墙糊成一坨（业务方原话：灾难现场）。
正确口径：下一条必须等**上一条的尾部离开右边缘**才可进场（见 danmakuClearMs），
这个常量只负责「尾部离开后再留一点空白」。
2026-09-26 B 站式：520 → 300 —— 同轨更密，仍靠 clearMs 防撞。
```

### W10 · `const CYCLE_PAUSE_MS = 1100`

```text
一轮弹幕里，最后一条结束后到重开一轮之间的停顿。
弹幕墙不能一轮播完就死；由页面用定时器重开（纯逻辑只提供这个时刻）。
```

### W11 · `function normalizeWishText(raw) {`

```text
归一化祈福文案（与云函数同口径）。
弹幕是单行滚动：换行会撑破轨道，零宽字符能让内容在审核视图里「看起来不一样」。
```

### W12 · `function normalizeProductKey(raw, fallback) {`

```text
归一化作用域 key（与云函数 `normalizeProductKey` 同口径）。
这是「全站拓展」的支点：每面祈福墙由一个字符串作用域隔离，
第二面墙 = 藏品记录上多一个 `wishWallKey`，**不需要改任何代码**。
非 `[a-z0-9_-]` 一律剔除以防注入，超长截断到 40（与集合字段约定一致）。
```

### W13 · `function resolveWishWallKey(product) {`

```text
该藏品所属的祈福墙作用域。
优先显式 `wishWallKey`；没有就落到「马上有」这面墙 ——
与 `isWishWallProduct` 同一思路：显式字段优先，不给未来的墙留隐式耦合。
```

### W14 · `function buildWishWallUrl(product, opts) {`

```text
构建祈福墙跳转 URL（入口组件唯一出口）。
带上 `productKey` 是「全站拓展」的关键：页面据此决定读哪面墙，而不是写死 mashangyou。
```

### W15 · `function parseWishWallScene(scene) {`

```text
解析**门店 / 物料小程序码**带进来的 `scene`（wxacode.getUnlimited，≤32 字符）。
为什么做成纯函数：门口立牌上那张码一旦生成就是**印刷品**，改不了 ——
所以"这张码的内容，页面到底认不认"必须能被**自动验证**（见 scripts/check-wall-qr.mjs：
它读 qr-assets 旁边的清单，把里面的 scene 直接喂给本函数，解析不出目标墙就红）。
约定（与 identify / onboarding 两页一致）：scene 是 `k=v&k2=v2` 形式，形如
  `from=store_qr&k=mashangyou`
只认白名单里的键，其余忽略；解析不出来就返回空对象（**不猜、不抛**）。
@param {string} scene
@returns {{from:string, productKey:string}} 缺失字段为空串
```

### W16 · `function shanghaiDayKey(ms) {`

```text
上海自然日的日期键 `YYYY-MM-DD`（与云函数 `shanghaiDayKey` 同口径）。
仪式彩蛋按天复现：同一天进来看到同一句，跨天才换。
```

### W17 · `function lampStreak(litDays, todayKey) {`

```text
连续点灯天数（含今日）。
今日未点灯即返回 0 —— 「连续」不能靠昨天充数，否则断了也显示连续，仪式就失去反馈。
@param {string[]|object} litDays 已点灯的日期键数组，或 { 'YYYY-MM-DD': ... } 映射
@param {string} todayKey
@returns {number}
```

### W18 · `const LAMP_TIERS = [`

```text
灯位层级：连续点灯天数 → 点亮的盏数与称号。
为什么要有层级：只有"点亮/没点亮"两种状态时，连续多天来的人得到的反馈和第一天一模一样，
仪式就没有累积感。层级把"坚持"变成看得见的东西（1 盏 → 3 盏 → 5 盏长明）。
阈值刻意低（1/3/7 天）：祈福墙不是养成玩法，第 7 天就该给到顶格反馈。
```

### W19 · `function lampTier(streak) {`

```text
@param {number} streak 连续点灯天数（0 = 今日未点灯）
@returns {{tier:number, lamps:number, label:string, nextAt:number, daysToNext:number}}
  `nextAt` = 下一层级所需天数（0 = 已到顶格），`daysToNext` = 还差几天
```

### W20 · `const SOLAR_TERMS = [`

```text
二十四节气（常用日期表）。
⚠️ 这是**公历近似日**（每年可能差 ±1 天，精确值需天文历）。用途是"今天是不是节气"的
仪式提示，不是历法计算 —— 所以固定表就够，且**确定性**（可在测试里断言）。
逐条写出来而不是算：节气算法（太阳黄经）在这个量级上得不偿失。
```

### W21 · `function markMine(items, mine) {`

```text
用「我的心愿」（`mine` 接口）给公开列表打标。
为什么要这样做：公开列表**刻意不返回 openid**（最小暴露），所以 C 端无法自己判断
「哪条是我写的」。`mine` 返回的是我自己的记录（含 `_id`），用 `_id` 集合去标记就够了 ——
不必为了一句"我的"把 openid 暴露到公开列表里。
@param {Array<object>} items 公开列表（已装饰）
@param {Array<object>|Set<string>} mine 我的记录数组，或我的 _id 集合
@returns {Array<object>} 带 `isMine` 的新数组（不改原对象）
```

### W22 · `function decorateMineRows(mine, now) {`

```text
「我的心愿」视图的数据：把 `mine` 的记录装饰成与公开列表同构的形状。
含被馆方收起的（`status === 'hidden'`），这样用户能看见"我的哪条没公开"。
```

### W23 · `function isWishWallProduct(product) {`

```text
该藏品是否挂祈福墙。
优先显式字段（ERP 侧后续可加 `wishWallEnabled`），标题子串只作过渡兜底 ——
否则任何标题带「马上有」的藏品都会长出祈福墙，且改名即失效。
```

### W24 · `function danmakuClearMs(text) {`

```text
上一条的**尾部离开右边缘**所需时间 —— 这才是同一轨道下一条可以进场的时刻。
几何：弹幕从「头部贴着右边缘」起步，走完全程 (屏宽 + 文案宽) 用 durationMs；
尾部进屏只需要头部走完「文案宽」这一段，故时间为 duration × 文案宽 / (屏宽 + 文案宽)。
```

### W25 · `// 弹幕配色档位与 emoji（2026-09-19）：**必须确定性** —— 用 FNV-1a(rotateIndex) 按 id 取，`

```text
弹幕布局：确定性分配轨道 + **按轨道占用**排期。
两条硬约束（都有过事故）：
  1. 同一轨道内，下一条的进场时刻 ≥ 上一条的进场时刻 + clearMs + LANE_GAP_MS
     （旧实现只加了 900ms 固定间隔 → 同轨叠 4 条）；
  2. 同屏轨道均匀分布且不贴边（避免顶部被导航栏裁、底部被舞台边裁）。
不使用随机数：同一份数据两次渲染必须得到同一布局（否则每次 setData 都会跳位置），
也才能在测试里断言。
@param {Array<{_id?:string,text?:string}>} items
@param {{lanes?:number, gapMs?:number, cycle?:number, boostId?:string}} [opts]
       cycle：重开轮次。会进 key，从而让 DOM 重建、动画重播（同 key 不会重播）。
       boostId：刚落愿的那条（B 站「发弹幕即时上墙」）—— 给负 delay 中段曝光 + boost 标记。
@returns {Array<object>} 每项含 key/text/lane/topPercent/durationMs/delayMs/clearMs/endAt/isCycleEnd
```

### W26 · `function danmakuEmoji(seedId) {`

```text
一条心愿该配哪个 emoji（**唯一规则**）。
2026-09-20 抽出：首页入口的跑马灯也要带 emoji，而规则原本内联在 `buildDanmakuRows` 里 →
复制一份到首页就是"两处规则会漂"。现在 builder 与首页入口都调这里。
盐 `'e:'` 与配色用的盐不同：**刻意让颜色与 emoji 不绑成固定搭配**。
必须确定性（按 id 取，不用随机）—— 否则每次 setData 都会换，且与守卫的确定性铁律冲突。
@param {string} seedId 心愿 _id（缺失时调用方给稳定兜底值）
@returns {string} emoji 或空串（池里第一项就是空串，即"这条不带 emoji"）
```

### W27 · `function splitTagColumns(items, columns) {`

```text
愿签两列瀑布分列：按下标奇偶（**确定性** —— 两次渲染同一分布，也才能在测试里断言）。
为什么不用 flex-wrap 两列：文案长度 2–30 字差异大，按行对齐会留出成片空洞；
瀑布列内纵向堆叠才贴得住。
```

### W28 · `function wishTimeMs(value) {`

```text
时间解析：兼容云函数回包里出现过的全部形态。
⚠️ 历史缺陷：这里原本直接 `new Date(value)`，而云函数回包的日期可能是 `{ $date: … }`
（本仓已有 4 处按此兼容：couponHelper / storeLedger / member-crm / live studio）。
该形态下 `new Date(obj)` = Invalid Date → **愿签的时间静默变成空串**，
且「今日额度」会数成 0（明明写满了还提示"还可写 5 条"）——
后者是本轮新增能力，故必须先把这个口径修对。
```

## components/WishWallEntry/index.js

### E1 · `const {`

```text
需求 28：「马上有」祈福墙 · **可复用入口组件**
为什么做成组件而不是留在详情页里的一小段 wxml：
  需求要求「为后续此入口的**全站拓展**做好长线预留」。入口的判定逻辑是
  「内容开关 开 **且** 当前藏品命中」，两处条件、两处会漂：
  详情页写一遍，下一个页面再抄一遍，早晚出现"开关关了但某个页面还亮着"。
  收成一个组件后，全站拓展 = 在新页面的 json 里注册 + 一行标签，判定只有一份。
组件只负责「是否显示 + 点进去」；**开关值仍由宿主页面传入**（`enabled`），
因为开关是页面级 SWR 缓存的产物，组件自己再拉一次会多打一次云函数。
```

### E2 · `function resolveCopy(productKey, brand, desc, hasProduct) {`

```text
入口文案：显式传入优先，留空则按**这面墙**自动。
默认墙（`mashangyou`）才配得上「马上有」这个署名；别的墙用别人的商品名是错的，
所以非默认墙不显示品牌署名，说明文案也不点名。
登记了展品的墙（config/wallExhibit）说**展品那一句** —— 与墙头展签、墙的分享卡同一句，
首页 / 详情 / 墙内三处不再各说各话。未登记展品的墙才走下面的通用说明：
`hasProduct`：详情等带商品上下文的入口强调「写愿后再回看本品」；首页默认墙没有商品，不提「这件」。
纯函数，便于断言（组件内联判断在测试台里跑不起来）。
```

### E3 · `externalClasses: ['ext-class'],`

```text
宿主可传类名控制外间距：入口从「藏品参数之后」搬到「主图正下方」后，
上下间距由宿主页面决定（组件自己只管内容）。惯例同 components/NavBack 的 ext-class。
```

### E4 · `defaultWall: { type: Boolean, value: false },`

```text
**默认墙入口**（2026-09-20）：首页这类**没有商品上下文**的页面用它。
为什么不做成"不传 product 就默认显示"：那样任何页面**忘了传 product** 都会亮出入口，
而入口是转化钩子 —— 宁可漏亮，不可错亮。所以要求宿主**显式**声明"我就是要默认墙"。
```

### E5 · `brand: { type: String, value: '' },`

```text
品牌署名 / 说明文案：**留空 = 按这面墙自动**（见下方 resolveCopy）。
多面墙之后「马上有」不再是唯一的墙 —— 把品牌写死在组件里，
第二面墙的入口会写着别人的商品名，那是错的。
```

### E6 · `compact: { type: Boolean, value: false },`

```text
紧凑单行版：主图正下方是"首屏最贵的一块地"，
三行卡片会把价格卡挤出首屏 —— 故首屏位只用一行（灯 + 品牌 + 标题 + 箭头），不显示 desc。
```

### E7 · `tone: { type: String, value: 'paper' },`

```text
**皮肤**：`paper`（默认，亮纸 + 铜字，祈福墙牌匾语言，详情页用）
/ `ink`（**墨底纸韵**：暖调墨黑底 + 纸纤维 soft-light + 内嵌铜金细框 + 手写体跑马灯，
  给首页这类**博物黑**页面用）。
为什么不是"压暗的纸"：产品负责人连否两版（亮纸 / 羊皮纸都"突兀"）→
根因是**亮度**而非色温：博物黑页面上任何亮块都会跳出来。
所以纸感改由**线索**表达（铜框 / 纤维 / 手写体），底色走暖调墨黑。
详见 index.wxss 的 .is-ink 注释。
为什么必须是组件内变体、而不是让宿主页面覆盖：组件 json 没有 `styleIsolation`，
默认 `isolated` → **页面样式进不来**（2026-09-20 实测确认）。故由宿主显式选皮肤。
```

### E8 · `wishes: { type: Array, value: [] }`

```text
**跑马灯文案**：真实心愿文本，由宿主拉取后传入（首页用）。
⚠️ 空数组 = 整行不渲染 —— **绝不编造**：宁可没有跑马灯，也不摆几条假心愿充场面
（本仓硬口径：不许编造社会证明）。
```

### E9 · `wishes(list) {`

```text
跑马灯：清洗 + 限长 + 复制一份（无缝循环）。
入参支持两种：字符串，或 `{ text, emoji }` —— 首页会带 emoji（与祈福墙弹幕**同一套规则**，
见 `utils/wishWall`，不在这里另造一套）。
时长按内容长度换算，让"长文案跑得久"（与祈福墙页 `danmakuDurationMs` 同一意图）——
固定时长会让短文案一闪而过、长文案挤成一团。
```

## utils/productStats.js

### S1 · `function getDisplaySoldCount(product) {`

```text
前端展示用销量：
- 孤品 / 镇店之宝：返回 null（卡片不展示销量，改打孤品标）
- 蝴蝶类：稳定随机 0–50
- 甲虫类：稳定随机 0–20
- 其它：真实销量
```

### S2 · `// 2026-09-18 产品负责人定：**7 天内**才算「新藏」。定这个数的实测依据（205 件线上商品）：`

```text
── 2026-09-18：新增「已售 0」的诚实展示口径 ──
问题：美化只覆盖昆虫类（蝴蝶随机 0–50 / 甲虫 0–20），**非昆虫的新品**落到真实值 0，
卡片就渲染出「已售 0」；而随机函数取到 0 时昆虫卡同样会显示「已售 0」。
处置（产品负责人 2026-09-18 拍板 方案 A：**零造假**）：
  真实销量为 0 时不再显示「已售 0」，改显示**真实成立**的状态 ——
  「建档时间在窗口内的新品」打「馆方新藏」标；否则**什么都不显示**（与孤品一致）。
⚠️ 刻意**没有**做的两件事（都写进了 docs/商品销量展示口径_2026-09-18.md）：
  1. 不往 DB 的 `soldCount` 写任何默认值 —— `admin/src/utils/b2bFulfillment.js`
     会做 `soldCount = 现有 + 数量`，假基数一旦入库就与真实销量永久混合，排序/报表从此不可信；
  2. 不回填"随机美化销量"到非昆虫类 —— 展示层虚构在售商品的销售状况仍属虚假宣传。
```

### S3 · `function productTimeMs(value) {`

```text
解析商品时间字段（云函数回包可能是 `{ $date }`；本仓已有 4 处按此兼容）。
裸 `new Date(obj)` 会得到 Invalid Date → 新品判定静默失效。
```

### S4 · `function isNewArrival(product, nowMs, days) {`

```text
是否新品：以**建档时间** `createTime` 为准。
选它的理由（不是随手挑）：C 端「最新」排序用的也是 `createTime` ——
拿同一字段说「新藏」，与用户已经看到的排序口径一致。
取不到时间 → **不算新品**（宁可什么都不显示，也不乱打标）。
```

### S5 · `function getSoldDisplay(product, nowMs) {`

```text
卡片/详情「销量位」的唯一出口。
@returns {{kind:'sold'|'new'|'none', text:string, count:number}}
  · 孤品/镇店之宝 → none（由孤品角标承载，不显示销量）
  · 展示销量 > 0  → sold「已售 N」
  · 展示销量 = 0 且是新建档 → new「馆方新藏」
  · 其余 → none（**不显示「已售 0」**）
不变量：`text` 永远不可能是「已售 0」（守卫 test:sold-display 钉住）。
```

## utils/easterEgg.js

### G1 · `const { STORAGE_KEY, LOCAL_ACHIEVEMENT, EGGS } = require('../config/easterEggs')`

```text
山海经彩蛋：发现、持久化、触发。
云同步预留 getSyncPayload / syncToCloud，不改积分账。
触发类型（`config/easterEggs.js` 的 triggers[].type）：
  - `longPress` / `secretKeyword` / `tapCount`：**用户主动**动作，已拾得的彩蛋可反复重看；
  - `pageEnter` / `wishPosted` / `lampStreak` / `wishCount`：**页面自动**触发。
    自动触发必须"只弹一次" —— 否则每次进同一页都会弹窗，
    彩蛋就从惊喜变成骚扰。故自动类型走 `skipIfDiscovered`（见 discover）。
后两类是**带门槛**的自动触发：`lampStreak` 需要连续点灯天数够（`minStreak`），
`wishCount` 需要我的心愿条数够（`minCount`）。门槛写在注册表里；
页面只负责报事实（`tryLampStreak({ streak })`），调门槛不必改页面。
```

### G2 · `function currentRoute(page) {`

```text
当前页面路由（`pageEnter` 类触发靠它匹配）。
组件/behavior 里 `this.route` 可能取不到，故回落到 getCurrentPages() 栈顶。
```

### G3 · `function triggerMatches(trigger, ctx) {`

```text
单条 trigger 是否命中当前上下文。
除了"类型 + 路由"，部分类型还带**门槛条件**（连续天数 / 条数）。
条件放在注册表里而不是页面里：页面只报"我现在连续 5 天"，
具体几天算彩蛋由注册表定 —— 调门槛不用改页面。
@param {{type?:string,pages?:string[],minStreak?:number,minCount?:number}} trigger
@param {{type?:string,route?:string,streak?:number,wishCount?:number}} ctx
```

### G4 · `function tryTriggerType(type, extras = {}) {`

```text
按**触发类型**批量判定（彩蛋注册表驱动，页面只报事件、不认 egg id）。
「全站拓展」就靠这里：新页面接彩蛋 = 在注册表里加一条 trigger，
页面侧只需 `tryPageEnter({ page: this })` 一行，不必改 easterEgg.js。
@param {string} type 见 AUTO_TRIGGER_TYPES
@param {object} [extras] 透传给 present/discover，如 { page, source }
@returns {object|null} 最后一个被触发的记录
```

## pages/index/index.js

### H1 · `async loadWishWallMarquee() {`

```text
首页祈福墙跑马灯（2026-09-20）：取**默认墙**最近的真实心愿文案。
四条约束：
  1. **只取真实心愿**（`manageWishWall` 的 list）。失败/空 → `wishWallWishes: []`，
     跑马灯整行不渲染 —— **绝不摆假文案充场面**（本仓硬口径：不许编造社会证明）；
  2. **一个页面会话只拉一次**：开关的水合缓存与 SWR 两条路径都会走到这里；
  3. **不传 productKey** = 默认墙（`manageWishWall` 用 `normalizeProductKey` 兜底到
     DEFAULT_PRODUCT_KEY），所以首页不需要任何商品上下文；
  4. 文案/emoji 都走**共享规则**（`utils/wishWall` 的 `normalizeWishText` / `danmakuEmoji`），
     首页**不另造一套**。为什么正文也必须归一化：换行与零宽字符在 `.trim()` 之后仍然"非空"，
     一条纯零宽的心愿会被当成有效条目凑满条数，跑马灯里就多出一个"看不见字"的假空位。
```

### H2 · `resetWishWallMarquee() {`

```text
让跑马灯在下一次开关判定时**重新拉一次**（下拉刷新 / 错误重试共用）。
没有它，一次成功之后就永远停在旧心愿上 —— 而首页是 tab 页，会话可以很长。
```

## app.wxss

### APP-1 · `--color-error: #D13C41;`

```text
2026-09-21 分子级审计：error 作为**实心底**承载白字时只有 4.489（AA 需 4.5），
按同色相只降亮度到 4.74。#D64045 与 #D13C41 的色差 (~5/255) 肉眼不可辨，
语义与其余 `rgba(214,64,69,*)` 边框/底色仍同族（它们用的是字面量，不受本令牌影响）。
```

### APP-2 · `/* ⚠️ 必须**单行**：自定义属性值跨行在小程序 WXSS 编译器上是已知风险点（2026-09-19 iOS 实测踩坑） */`

```text
手写体（毛笔 / 签字笔感）：只给「用户亲手写下」的内容用 —— 祈福墙弹幕与愿签。
与站点其余字体一样走**系统字体栈**，不下载 webfont（无网络依赖、无首屏闪烁、不新增 CDN 资产）：
iOS/macOS 命中汉仪手写体与签笔（HanziPen SC / Hannotate SC）；Android 无楷体系列，
落到思源宋体再落 serif。故手写感在 iOS 最足，Android 是衬线兜底，两端可读性都成立。
```

### APP-3 · `--fs-16: 16rpx;`

```text
字阶令牌（契约 C7 · docs/契约C7_设计令牌与交互规范_2026-09-18.md §1）：14 档，命名即尺寸。
为什么必须令牌化（2026-09-18 实测）：全仓 4469 处 font-size / 49 种取值，令牌 0 条；
连本轮的统一组件 AppModal/AppToast 自己都带离群值（27rpx/29rpx，report:type:json 直指 orphanValues:2）。
不先冻令牌，每一个新组件都会固化一批新噪音。
纪律：**新代码不得写 font-size 字面量**；不在册的取值一律视为离群，按 C7 §1.3 映射表就近归位。
```

### APP-4 · `button.btn-secondary,`

```text
次要按钮 — 透明底 + 黄铜描边（与主按钮同 padding，避免双按钮行高度差）
WeChat：全局 button overflow:hidden + 1rpx 边框在 flex 行内容易吃掉一侧（常见左侧）
描边按钮用 1px + overflow:visible，并清掉 ::after 默认边框
```

### APP-5 · `@keyframes signal-blink {`

```text
==================== 信号灯系统（全平台统一） ====================
语义文档：docs/signal-lamp.md · 工具：utils/signalLamp.js
基类：.signal-light 或 .lamp
Token：lamp-success|warn|error|info|brass|forest|muted + .hollow / .blink / .dim
历史别名：.blink=绿脉冲 · .on=绿静 · .warn · .danger · .live
```

## pages/index/index.wxss

### PAG-1 · `.wish-wall-slot-home {`

```text
祈福墙入口槽位（2026-09-20）：banner 正下方。
横向 32rpx 与 .section-box 的既有节奏对齐；上边距只留 4rpx —— hero-section 自己已有 20rpx 底距，
两段相加 ≈ 24rpx，才是"紧挨 banner"该有的间距。
```

### PAG-2 · `color: var(--color-text-secondary);`

```text
2026-09-21 分子级审计：--color-text-muted 在不透明底 --color-bg-card 上仅 2.93（AA 需 4.5）
→ 与 ProductList / 分类页空态统一到 --color-text-secondary（6.02）
```

## components/WishWallEntry/index.wxss

### COM-1 · `.wish-wall-entry {`

```text
components/WishWallEntry/index.wxss 需求 28：祈福墙入口
═══════════════════════════════════════════════════════════════════
2026-09-26 v2「厅·墙·签」对齐：入口 = 嵌墙迷你铭牌（与墙内 .ww-plate / 双线浅纸同族）
  · 浅纸双线铜框 + 纤维；「马上有」铜铸铭牌带铆钉
  · 墨底版仍是「暗房里的纸」（#2C2822 起点守卫钉死），内嵌铜金细框
═══════════════════════════════════════════════════════════════════
```

### COM-2 · `.wish-wall-entry-mq {`

```text
── 跑马灯 ─────────────────────────────────────────────────────
```

### COM-3 · `.wish-wall-entry.is-ink .wish-wall-entry-mq {`

```text
墨底跑马灯 · 暗玻璃签条（2026-09-29 产品负责人：米白贴纸在博物黑首页上突兀）
  与入口卡同一套语言：深棕半透明底 + 细铜金描边 + 暖金手写字，不再出现任何亮块。
  · 左右渐隐遮罩：条目从卡边"浮出/隐没"，不再被硬切半个字；分隔线也跟着渐隐成一道金丝。
  · 错落明暗 is-v0/1/2：三档透明度，最暗档文字对底仍 ≥ 6:1。
  · 遮罩断点用百分比：不引入 calc(百分比 − rpx)（E26 真机精度）。
```

## components/ProductCard/index.wxss

### COM-1 · `.p-title { font-size: 26rpx; color: var(--color-text-primary); font-weight: 600;`

```text
2026-09-21 分子级审计：`.text-cut` / `.font-num` 定义在 app.wxss，但本组件 json **没有**
`styleIsolation`（默认 isolated）→ 全局 class 进不来（同目录 8 个组件都显式 apply-shared /
addGlobalClass，本组件没有）。故把这 3 条声明**写进组件自己的规则**：
两种读法（isolated 生效 / app.wxss 仍生效）下结果一致，属于「自持样式」。
```

## components/SensitiveBlurGate/index.wxss

### COM-1 · `:host {`

```text
⚠️ 自定义组件宿主默认是 inline、且不会被父级拉伸。
而卡片的图片外层多是 `padding-top:100%` 的**比例盒**：它的 **content 高度是 0**，
于是 `.sb-wrap { height: 100% }` 会被算成 0，叠加 `overflow: hidden` 就把卡片图片裁没了
——真机/模拟器表现就是「卡片空白、只剩深色底」（2026-09-17 商品图不展示的根因）。
用 absolute 铺满父级的 padding box，才能拿到比例盒的真实高度。
```

## components/HomeReco/index.wxss

### COM-1 · `.hr-body { width: 100%; }`

```text
几何（内容宽 686，2026-10-10 博物视觉重构后）：封面恒高 640（wide 图 430 + 展签 210 / side 图宽 360~420 + 右签，见 logic.coverGeo）；
次推卡 578（图 334 + 展签 242 + 边框）；swiper = 640 + 20 + 578 = 1238，改任一项同步它与骨架（check:home-reco「骨架与几何」与渲染台 --check 会量）。
```


## app.wxss（2026-10-15 质感 / VI 升级轮迁出）

### 注记 APP-6

```css
/* VIS 3.0 纪律 02「克制的金」质感令牌（2026-10-14）：金色只以发丝线出现，不发光。
     选中 / 强调 → 金线环（blur 0）；卡面 → 内发丝线；浮起 → 中性夜墨投影（不带金）。
     例外只给「光源」（灯 / 烛 / 火花 / 信号灯），登记在 scripts/audit-vis3-rules.mjs 的 R2_LIGHT_SOURCE。 */
```

### 注记 APP-7

```css
/* 兼容旧变量名：2026-10-15 已全站改用 VIS 3.0 名（VI 规范 v1 §3.6 / 升级路线 P2）。
     只剩两枚无等价新名的：淡金底 primary-light、暗铜边 border-gold。新代码不要再用。 */
```

### 注记 APP-8

```css
/* 同色淡底上的字（红字压红底 12–16%、蓝字压蓝底…）：原色压不过 4.5:1，取同色相提亮一档（三种深色面实测 4.75–6.8:1）。2026-10-14 质感轮 */
```

### 注记 APP-8b

```css
/* 错误红作**实心底**承载白字：VIS3 第 04 页「须用 #C9373C 以上深度」（白字 5.13:1；#D64045 仅 4.49） */
```

