# 山川造物 · 官网 v0.2

> 把山川带回家 · *Bring Nature Home*

技术栈：**Astro 5 + Tailwind v3.4 + TypeScript**，部署目标 **Cloudflare Pages**。

视觉基线：`/senses` 页（五感）。视觉主题：**双主题自适应 · Cabinet of Curiosities × Day-Night**

- **深色模式**（默认）—— 夜里点灯翻档案 · 暗黄铜博物馆
- **浅色模式** —— 白天在工坊整理标本 · 微暖白 + 深色文字的"日间博物馆"

不是"两种风格选其一"——是同一品牌的**两种时刻**。
切换逻辑：系统偏好 → localStorage 记忆 → Header 月亮 / 太阳手动覆写。

---

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev    # http://localhost:4321/

# 3. 主要 routes
#    /            首页（vision hero + 4 audience + 1% 承诺导航）
#    /senses      五感视觉基线页
#    /about /products /space /commitment /values /talent
#    /properties /investors /franchise /operations /plan /tech /notes
```

## 构建与预览

```bash
npm run build      # 输出到 dist/（18 个 HTML 页面）
npm run preview    # 本地预览构建产物
```

---

## 项目结构

```
shanchuanzaowu/
├── astro.config.mjs       # Astro 配置（Tailwind 集成）
├── tailwind.config.mjs    # 设计 token：黄铜 + ink 暗调 + paper 米白 + VI 色
├── tsconfig.json          # TS strict
├── public/
│   ├── favicon.svg        # 山字 + 黄铜 logo
│   ├── images/
│   │   ├── senses/        # 五感页占位图（待补充真实素材）
│   │   └── hero/          # 首页 / OG 图（待补充）
│   └── audio/             # 30s 环境音（待录制）
└── src/
    ├── styles/global.css      # 设计系统 + token + paper-texture
    ├── components/            # 14 个组件
    │   ├── Layout.astro           # 全站骨架（含 IntersectionObserver 淡入）
    │   ├── Header.astro           # 极简导航（含移动端抽屉）
    │   ├── Footer.astro           # paper 米白 + VI 色页脚（4 列）
    │   ├── PageHero.astro         # 通用页头（居中）
    │   ├── SectionHeader.astro    # 段落头（左/居中可选）
    │   ├── SenseSpread.astro      # 五感单元（图/文左右切换）
    │   ├── AudienceCard.astro     # 受众入口卡（首页 4 张）
    │   ├── CommitmentBar.astro    # 承诺导航条（中心句 + 6 观 + → /commitment）
    │   ├── ContactBlock.astro     # 通用联系块（mailto）
    │   ├── PullQuote.astro        # 大字引文
    │   ├── Principle.astro        # 罗马数字 + 标题 + 实践清单（战略原则用）
    │   ├── NoListItem.astro       # × 不做项（红线清单用）
    │   ├── PledgeBlock.astro      # 承诺方框（positive / negative 两种 variant）
    │   └── WIPNotice.astro        # 占位通知（v0.2 升级前的 dignified 占位）
    └── pages/                 # 18 个页面
        ├── index.astro            # 首页（vision hero + 4 audience + 1% 承诺）
        ├── about.astro            # 我们是谁（创始团队 + 6 战略原则 + 30 年）
        ├── products.astro         # 产品线（自然小匣 / 衍生品 / 主题展柜 / 双 IP）
        ├── space.astro            # 空间体系（叙事根 + toolkit 框架 + 8 模块）
        ├── senses.astro           # 五感页（视觉基线）
        ├── commitment.astro       # 1% 承诺（含物理层落地 → /hardcore-tech）
        ├── values.astro           # 6 观（空间 / 承诺 / 青年 / 科技 / 内容 / 人才）
        ├── talent.astro           # 人才与店长培训 toolkit
        ├── properties.astro       # 给物业方
        ├── investors.astro        # 给投资人（含三道护城河 callout）
        ├── franchise.astro        # 加盟说明
        ├── operations.astro       # 运营方法论
        ├── plan.astro             # 路线图
        ├── tech.astro             # 科技观（4 原则 → 软 / 硬双实证）
        ├── digital-ops.astro      # 数字化能力（软实证 · 30+ 页 / 27 模块 / 17 AI 场景）
        ├── hardcore-tech.astro    # 硬核科技应用蓝图（硬实证 · 11 项 + 不做 3 项 + 三年路线）
        ├── notes.astro            # 公众号文章列表
        └── notes/
            └── founders-letter.astro  # 公众号 001 · 写在工作室开门之前
```

---

## 设计 Token 速查（v0.2 · 双主题自适应）

所有 token 通过 `:root` / `:root[data-theme='light']` CSS 变量切换。组件代码**不需要写 `dark:` 前缀**——`bg-ink text-cream` 等既有写法在两种模式下都自动响应。

### 色板对照（深色 ↔ 浅色 · 浅色全部满足 WCAG AA 对比度）

| Token | 深色模式 | 浅色模式 | 用途 |
|---|---|---|---|
| `brass-deep` | `#8A7530` | `#4A3A14` | 深处分隔 / 暗强调 |
| `brass-mid` | `#C4A76C` | `#6B5524` | 链接 / 主要强调 / 分隔线 |
| `brass-light` | `#E8DDC2` | `#8A7530` | 微妙高光 |
| `brass-bright` | `#DDC890` | `#A88B40` | 深底点缀（感官标签 / vision 字） |
| `ink` (DEFAULT) | `#1A1814` | `#FAFAF5` ← VI 微暖白 | html / main / Header |
| `ink-elevated` | `#232020` | `#F2EDE4` | 卡片 / 浮起面板 / 抽屉 |
| `ink-deep` | `#0F0D0B` | `#EBE5D7` | 戏剧化时刻 |
| `cream` / `text` | `#F2EDE4` | `#2C2C2C` ← VI 墨绿黑 | 正文 / 标题主色 |
| `text-soft` | `#B8B0A4` | `#6B5F4F` | 副标题 / 引文 |
| `text-dim` | `#6B6560` | `#998B73` | 注释 / 小字 |

**v0.2 双主题预定义色族**（当前未广泛使用，等真实页面调用）：
`green` · `cabinet`（博物蓝）· `coral`（标本红 · 不做×符号）· `purple`（矿物紫）—— 浅色下都向深处平移一档。

### Footer 独立色族（**不参与双主题切换**）

Footer 是"翻到出版物末页"的物理体验，需要稳定的米白纸张感。这一组色在两种主题下都保持不变：

| Token | 值 | 用途 |
|---|---|---|
| `paper` | `#F2EDE4` | Footer 底色（比浅色 main 深一档保留边界） |
| `nature-green` | `#2D6A4F` | Footer 标题 / hover |
| `earth-brown` | `#8B6F47` | Footer 拉丁学名 |
| `mineral-purple` | `#7B68AE` | 备用（VI 矿物紫） |
| `ink-text` | `#2C2C2C` | Footer 正文（VI 墨绿黑） |

### 字体 / 间距

| 类别 | Token | 值 |
|---|---|---|
| 中文衬线 | `font-serif` | Source Han Serif SC → Songti SC → 宋体 |
| 英文衬线 | `font-serif-en` | Cormorant Garamond → Lyon Text → Georgia |
| 大标题 | `text-display-lg` | clamp(3rem, 6vw, 5rem) |
| 章节间距 | `section` | clamp(4rem, 10vw, 8rem) |
| 长读宽度 | `max-w-editorial` | 38rem |

### 双主题运作原理（一句话）

1. `src/styles/global.css` 定义 `:root` 深色变量 + `:root[data-theme='light']` 浅色变量
2. `tailwind.config.mjs` 所有 colors 通过 `var(--color-xxx)` 或 `rgb(var(--rgb-xxx) / <alpha-value>)` 引用
3. `Layout.astro` head 内联 `is:inline` 脚本初始化 `data-theme`（防 FOUC）
4. `Header.astro` 太阳 / 月亮按钮切换 + `localStorage` 记忆

---

## 待补充素材清单（v0.1 → v0.2）

- [ ] `public/images/senses/` 5 张占位图（视/听/嗅/触/味）
- [ ] `public/audio/ambient-30s.mp3` 30 秒环境音录制
- [ ] `public/images/hero/home-hero.jpg` 首页主视觉 / OG 分享图
- [ ] 自托管思源宋体（如系统宋体回退不理想）
- [x] `/notes/founders-letter` —— 创始人信《写在工作室开门之前》（v0.1 已上线 · 公众号 001）
- [x] `public/images/founders/lianshu.png` —— 廉澍肖像（已上线 · 4:5 · 116KB · 蓝底正装棚拍）
- [x] `public/images/founders/lihe.png` —— 李贺肖像（已上线 · 4:5 · 169KB · 草原远眺户外照）
- 创始人肖像同时出现在 `/about` 创始团队 I（4:5 上下双列）+ `/investors` 团队 VIII（图文卡片双列）
- [ ] 把 `mailto:hello@shanchuanzaowu.com` 替换为真实邮箱（v0.1 内测期）或等域名 + Email Routing 配好（v0.2）

素材到位后只需把文件放进对应目录、并在 `src/pages/senses.astro` 里取消注释 `image=` / `audio=` 属性即可。

---

## 部署 · Cloudflare Pages

**最小 7 步**（完整 SOP 见《山川造物·官网 v0.1·上线与域名布置方案 v0.1》）：

1. 本地 `npm run build` 通过（生成 dist/ + 18 页）
2. GitHub 创建私有仓库 `shanchuan-zaowu-site`
3. `git push -u origin main`
4. Cloudflare Dashboard → Workers & Pages → Create → Connect to Git
5. 配置：
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION = 20`
6. 首次部署 → 临时域名 `shanchuan-zaowu.pages.dev`
7. 上线后逐项检查 15 routes / 移动端 / 链接 / PageSpeed

> 域名（`shanchuanzaowu.com`）+ 邮箱（Cloudflare Email Routing）在 v0.2 阶段再买。
> v0.1 用 `*.pages.dev` 临时域名 + `mailto:` 链接（域名买之前邮件会退信，仅小范围内测）。

---

## 已知坑位 · 避免重犯

### `.fade-in` 不要包超长容器
全局 IO 用 `threshold: 0`（v0.1 修复），但**仍建议**给每个独立段落加 `.fade-in`，
而不是把整个 `<section>` 内容塞进一个 fade-in 块。理由：
- 长读体验更好（章节渐次出现而非一次性扫过）
- 容错更高（即使未来再调 IO 阈值，每个 fade-in 块都不会太大）

参考 `/about` 的写法（4 个独立 fade-in 段），不要参考 `/notes/founders-letter`
的早期写法（一个 fade-in 包整篇 4500 字 → 触发 bug）。

### 写"能力清单"前先过品牌一致性这道闸
小程序 / ERP 代码里可能有**已开发但永远不会启用**的功能（拼团 / 秒杀 / 盲盒 /
限量饥饿营销 / 隐藏款……）——这些是底层电商平台自带的常规模块，技术债
意义上的"过度开发"。落到官网展示时**绝对不要列出来**，否则会跟品牌反复
强调的红线（见 `/notes/founders-letter` §I "不做" 清单 + `/products` 不做清单
+ `/investors` "我们不要的资本"）直接对撞。

判断闸：每写一条"已实现能力"，问一句——"这件事品牌愿意在朋友圈转发吗？"
不愿意，就不写。代码里有，是另一回事。

宏观数字（30+ 页面 / 27 模块 / 25+ 云函数）保留不变是 OK 的——那是"已开发"
层面的实证；只在功能描述层避免提及与红线冲突的模块即可。

### 双主题 token 迁移的三个雷区

v0.2 双主题改造时踩过的三个坑，未来扩展色族 / 加新 opacity 修饰时留意：

1. **被 `/数字` opacity 修饰的 token 必须用 `rgb(var(--rgb-xxx) / <alpha-value>)` 格式** ——
   不能直接用 `var(--color-xxx)`。Tailwind 无法把 var 自动转 rgba。
   迁移前先 `rg "(bg|border|text|from|to)-[\w-]+/\d+"` 把所有 opacity 修饰扫一遍，
   命中的 token 必须配 `--rgb-xxx` tuple 变量。当前已配的是
   `ink` / `ink-elevated` / `ink-deep` / `cream` / 全部 `brass-*`。
2. **Footer 米白纸张色族（paper / nature-green / earth-brown / ink-text）刻意不参与双主题** ——
   这是 VI 印刷物料色族，承担"翻到出版物末页"的物理体验。如果让它跟随主题，
   浅色模式下 Footer 跟 main（都用 #FAFAF5）会同色合并丢失边界。
   解决方案：`paper` 设为 `#F2EDE4`（比浅色主底深一档），保证两种模式都有 Footer 边界。
3. **变量名加 `--color-` 前缀避免命名冲突** ——
   旧的 `:root` 用 `--ink` / `--brass-mid` 这种短名，跟 Tailwind 内置 `--tw-` 系列
   没冲突但容易跟其他第三方库撞车。v0.2 起统一加 `--color-` 前缀（`--color-ink`），
   RGB tuple 用 `--rgb-` 前缀（`--rgb-brass-mid`）。

### 内部蓝图落地公开页时：硬数据脱敏 + IP 名匿名化

`/hardcore-tech` 的源文档是内部讨论稿（"硬核科技应用蓝图 v0.1"）。
公开版做了三处统一脱敏，未来同类内部资料落地时请保持同样的尺度：

1. **设备品牌 / 型号全部隐去** —— 不写 Revopoint / Sony A7R / Bambu Lab /
   xTool / Anker / Tripo / Midjourney / Yuji LED 这类具体名。改为
   "桌面级 3D 扫描仪 / 高分辨率微距摄影系统 / AI 文案生成工具" 这类品类描述。
   理由：避免被读成"设备厂商背书"；保留"做了认真研究"的实证感即可。
2. **预算 / ROI / 招聘薪资全部隐去** —— 不写 ¥55000 / ¥80000 / ¥165000-330000 /
   月薪 8000-15000 这类金额。改为"第一年必上 / 第二年加入 / 第三年再议"
   这类节奏。完整版通过 ContactBlock 引导"邮件申请内部完整版"。
3. **未公开 IP 名匿名化** —— 蒲公英之星 / 海的回信 / 一朵山川 / 蝴蝶宇宙 /
   矿石系列 / 小黄家族 / 蓝先生 / 翠衣 等 IP 名在 IP 矩阵专栏正式发布前
   **不落地任何公开页**。改为"IP 形象系 / 玻璃罩类 / 瓶身类 / 昆虫蝴蝶系 /
   矿石系 / 贝壳系 / 插件化商品"等品类化描述。落地公开页时配上
   "本表使用品类化描述，IP 矩阵正式发布后可对应升级到具体 IP 名" 的脚注。

判断闸：每一份新内部资料公开化前，搜一遍 dist 里有没有"具体设备型号 /
具体金额 / 未公开 IP 名"——三处都为零命中，再 push。

---

## 视觉决策检验点（v0.2 双主题）

### 深色模式（默认）

1. 黄铜在深底（ink）上是否"贵重感"——不应该是"暗淡"或"金属灰"，应有温暖金光
2. 中文字体在 cream 字色（#F2EDE4）下能否舒服阅读 30 秒以上
3. Cormorant Garamond italic 在深底上是否优雅，不模糊
4. `brass-divider` 在 ink 底上是否"有，但不抢"
5. 五感页 5 个章节滚动节奏舒缓，没有暗-暗切换的疲劳感
6. Footer 顶部黄铜细线做出主区与页脚的"温和过渡"，而非"硬切"

### 浅色模式

跑 `npm run dev` → DevTools 改 `<html data-theme="light">`：

1. **首次访问跟随系统偏好**（macOS / Windows 调系统深浅看是否对应）
2. **Header 切换按钮点击立即切换 + 刷新页面后状态保持**
3. **浅色模式下，所有文字对比度足够**（深黄铜 #6B5524 / 文字深灰 #2C2C2C 都能轻松看清）
4. **浅色模式下，黄铜分隔线 brass-divider 不过弱也不过强**
5. **浅色模式下，commitment "1%" 巨字若有渐变是否依然有戏剧性**
6. **主题切换过渡平滑（400ms 过渡有舒缓感而不突兀）**
7. **浅色模式下 Footer 与 main 有边界**（paper #F2EDE4 vs main #FAFAF5 一档之差）

---

`v0.2 · 2026.05 · Astro Scaffold + Dual Theme (Day & Night for the Naturalist)`
