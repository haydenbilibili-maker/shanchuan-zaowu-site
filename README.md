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
npm run build      # 输出到 dist/（15 个 HTML 页面）
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
    └── pages/                 # 15 个页面
        ├── index.astro            # 首页（vision hero + 4 audience + 1% 承诺）
        ├── about.astro            # 我们是谁（创始团队 + 6 战略原则 + 30 年）
        ├── products.astro         # 产品线（自然小匣 / 衍生品 / 主题展柜 / 双 IP）
        ├── space.astro            # 空间体系（叙事根 + toolkit 框架 + 8 模块）
        ├── senses.astro           # 五感页（视觉基线）
        ├── commitment.astro       # 1% 承诺（含财务对照 + 备忘）
        ├── values.astro           # 6 观（空间 / 承诺 / 青年 / 科技 / 内容 / 人才）
        ├── talent.astro           # 人才与店长培训 toolkit
        ├── properties.astro       # 给物业方
        ├── investors.astro        # 给投资人
        ├── franchise.astro        # 加盟说明
        ├── operations.astro       # 运营方法论
        ├── plan.astro             # 路线图
        ├── tech.astro             # 技术观
        └── notes.astro            # 公众号文章入口
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
- [ ] `/notes/founders-letter` —— 创始人信（v0.2 内容到位后建子路由）
- [ ] 把 `mailto:hello@shanchuanzaowu.com` 替换为真实邮箱（v0.1 内测期）或等域名 + Email Routing 配好（v0.2）

素材到位后只需把文件放进对应目录、并在 `src/pages/senses.astro` 里取消注释 `image=` / `audio=` 属性即可。

---

## 部署 · Cloudflare Pages

**最小 7 步**（完整 SOP 见《山川造物·官网 v0.1·上线与域名布置方案 v0.1》）：

1. 本地 `npm run build` 通过（生成 dist/ + 15 页）
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
