# 山川造物 · 官网 v0.2

> 把山川带回家 · *Bring Nature Home*

技术栈：**Astro 5 + Tailwind v3.4 + TypeScript**，部署目标 **Cloudflare Pages**。

视觉基线：`/senses` 页（五感）。视觉主题：**深色 · Cabinet of Curiosities**（v0.2 升级，从 cream 底升级为 ink 底，奇珍柜调性）。

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

## 设计 Token 速查（v0.2 · 深色主题）

| 类别 | Token | 值 | 用途 |
|---|---|---|---|
| 黄铜 · 深 | `brass-deep` | `#8A7530` | 深处分隔 / 暗强调 |
| 黄铜 · 中 | `brass-mid` | `#C4A76C` | 链接 / 主要强调 / 分隔线 |
| 黄铜 · 浅 | `brass-light` | `#E8DDC2` | 微妙高光 |
| 黄铜 · 亮 | `brass-bright` | `#DDC890` | 深底上的点缀（感官标签 / vision 字） |
| 底色 · 主 | `ink` | `#1A1814` | html / main / Header / Footer |
| 底色 · 次 | `ink-elevated` | `#232020` | 卡片 / 浮起面板 / 移动菜单抽屉 |
| 底色 · 极深 | `ink-deep` | `#0F0D0B` | 戏剧化时刻（偶用） |
| 文字 · 主 | `cream` / `text` | `#F2EDE4` | 正文 / 标题（深底上的米白） |
| 文字 · 次 | `text-soft` | `#B8B0A4` | 副标题 / 引文 / 导航默认 |
| 文字 · 弱 | `text-dim` | `#6B6560` | 注释 / 小字 |
| 字体 · 中文衬线 | `font-serif` | Source Han Serif SC → Songti SC → 宋体 | |
| 字体 · 英文衬线 | `font-serif-en` | Cormorant Garamond → Lyon Text → Georgia | |
| 字号 · 大标题 | `text-display-lg` | clamp(3rem, 6vw, 5rem) | |
| 间距 · 章节 | `section` | clamp(4rem, 10vw, 8rem) | |
| 宽度 · 长读 | `max-w-editorial` | 38rem | |

**注**：v0.2 起整站只有一个色（深色），不做亮 / 暗模式切换。

---

## 待补充素材清单（v0.1 → v0.2）

- [ ] `public/images/senses/` 5 张占位图（视/听/嗅/触/味）
- [ ] `public/audio/ambient-30s.mp3` 30 秒环境音录制
- [ ] `public/images/hero/home-hero.jpg` 首页主视觉 / OG 分享图
- [ ] 自托管思源宋体（如系统宋体回退不理想）
- [x] `/notes/founders-letter` —— 创始人信《写在工作室开门之前》（v0.1 已上线 · 公众号 001）
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

## 视觉决策检验点（v0.2 深色主题）

跑起来 `/senses` 后，请检查：

1. 黄铜在深底（ink）上是否"贵重感"——不应该是"暗淡"或"金属灰"，应有温暖金光
2. 中文字体（思源宋体 / 系统宋体）在 cream 字色（#F2EDE4）下能否舒服阅读 30 秒以上
3. Cormorant Garamond italic 在深底上是否优雅，不模糊
4. `brass-divider`（mid 色 30%-70% 渐变）在 ink 底上是否"有，但不抢"
5. 五感页 5 个章节滚动节奏是否舒缓，没有暗-暗切换的疲劳感
6. 移动端（< 768px）深色阅读在弱光环境下是否过亮
7. Footer 顶部黄铜细线是否做出主区与页脚的"温和过渡"，而非"硬切"

---

`v0.2 · 2026.05 · Astro Scaffold + Dark Theme (Cabinet of Curiosities)`
