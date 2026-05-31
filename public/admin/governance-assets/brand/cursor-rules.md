# 山海造物 Nature's Creations — Design System & Cursor Rules

> 本文件是山海造物全平台（微信小程序 + ERP管理后台 + 店长后台）的视觉设计规范。
> 所有前端开发必须遵守此文件中的色彩、字体、间距、组件规范。
> 在 Cursor 中开发时，将此文件放置在项目根目录作为 `.cursorrules` 或 `cursor-rules.md`。

---

## 1. 品牌视觉定位

山海造物的视觉基因是**「维多利亚博物学家的奇珍柜」**——不是森林小清新，不是科技感数字品牌，而是：

- **暗色包裹感**：像走进一间暖光博物馆，四周是深色木柜和黄铜灯具
- **黄铜金点睛**：每一件标本都值得被铜牌标注，每一个按钮都像柜门的拉手
- **自然质感**：木纹、棉布、未涂布纸张的触觉记忆，而非光滑塑料

品牌有两种视觉模式：
- **Museum Mode（博物馆模式）**：C端小程序，深色沉浸，模拟走入门店的体验
- **Studio Mode（工作室模式）**：B端ERP/后台，浅色高效，模拟打开工作灯的状态

---

## 2. 核心色彩体系

### 2.1 基础五色（Foundation Palette）

| 角色 | 色名 | HEX | RGB | 使用场景 |
|------|------|-----|-----|---------|
| **主色** | 黄铜金 Brass Gold | `#C4A76C` | 196,167,108 | 品牌标识色、CTA按钮、会员等级标识、价格标注、关键强调 |
| **底色·暗** | 博物黑 Museum Dark | `#1A1814` | 26,24,20 | C端小程序背景、沉浸式界面底色、深色卡片 |
| **底色·亮** | 标本纸 Specimen Cream | `#F2EDE4` | 242,237,228 | B端后台背景、浅色卡片、内容区底色 |
| **辅色** | 柜木棕 Cabinet Wood | `#8B6F47` | 139,111,71 | 副标题、拉丁学名、温暖感装饰、分隔线 |
| **辅色** | 苔藓绿 Forest Depth | `#2D5A3F` | 45,90,63 | 品牌名标注、自然属性标签、成功状态、植物品类 |

### 2.2 黄铜金的色阶（Brass Ramp）— 最常用色阶

| 级别 | HEX | 用途 |
|------|-----|------|
| Brass-50（最浅） | `#FAF6ED` | 浅色模式下金色区域背景 |
| Brass-100 | `#F0E6CC` | 浅色卡片高亮底色、hover 状态 |
| Brass-200 | `#E0CFA3` | 分隔线、轻量边框 |
| Brass-300 | `#D4BC85` | 次要按钮边框、图标色 |
| Brass-400 | `#C4A76C` | **主色（Primary）** — CTA按钮、品牌强调、active 状态 |
| Brass-500 | `#A8903C` | 深色模式下主按钮、hover 加深 |
| Brass-600 | `#8A7530` | 深色模式下文字、铜牌标注色 |
| Brass-700 | `#6B5A24` | 深色背景上的副标题 |
| Brass-800 | `#4D401A` | 深色背景上的装饰线 |
| Brass-900 | `#302810` | 接近底色的最深金色 |

### 2.3 博物黑色阶（Museum Dark Ramp）

| 级别 | HEX | 用途 |
|------|-----|------|
| Dark-50 | `#F5F3F0` | 最浅灰白（studio mode辅助背景） |
| Dark-100 | `#E8E5DE` | 边框、分隔线（studio mode） |
| Dark-200 | `#D5D1C8` | 禁用状态背景 |
| Dark-300 | `#A09A90` | 占位文字、禁用文字 |
| Dark-400 | `#6B6560` | 次要文字（Stone Gray） |
| Dark-500 | `#4A4540` | 正文文字（studio mode） |
| Dark-600 | `#33302C` | 标题文字（studio mode） |
| Dark-700 | `#262320` | 侧边栏、深色卡片背景 |
| Dark-800 | `#1F1D1A` | 深色模式容器背景 |
| Dark-900 | `#1A1814` | **博物黑（Museum Dark）**— C端主背景 |

### 2.4 品类专属色（Category Colors）

每个标本品类有一个专属色，用于品类标签、分类图标、品类页面强调色：

| 品类 | 中文名 | 英文 | HEX | 色感来源 |
|------|--------|------|-----|---------|
| 昆虫 | 神奇昆虫 | INSECTA | `#52B788` | 蝴蝶翅膀的绿色荧光 |
| 矿石 | 群山回响 | MINERALS | `#7B68AE` | 紫水晶的晶体色 |
| 植物 | 植物探微 | PLANTAE | `#6DA34D` | 新鲜叶片的绿 |
| 海洋 | 无尽海洋 | MARINE | `#5B8FB9` | 深海的蓝 |

品类色仅用于品类相关的 UI 元素（标签、图标、分类页头），不用于全局 UI。

### 2.5 功能色（Semantic Colors）

| 角色 | HEX | 使用场景 |
|------|-----|---------|
| 成功 Success | `#52B788` | 完成、确认、上架、通过 |
| 警告 Warning | `#E9A23B` | 库存预警、待处理、注意 |
| 危险 Error | `#D64045` | 错误、下架、删除、异常 |
| 信息 Info | `#5B8FB9` | 提示、链接、帮助 |

---

## 3. 双模式应用规范

### 3.1 Museum Mode（C端小程序）

```
背景底色：    Dark-900  #1A1814
卡片背景：    Dark-800  #1F1D1A
卡片边框：    Dark-700  #262320 或 Brass-800 #4D401A（高亮卡片）
主标题：      #FFFFFF（纯白）
副标题：      Dark-300  #A09A90
正文：        Dark-200  #D5D1C8
拉丁学名：    Brass-400 #C4A76C（斜体）
CTA按钮背景： Brass-400 #C4A76C
CTA按钮文字： Dark-900  #1A1814
次要按钮：    透明背景 + Brass-400 边框 + Brass-400 文字
禁用按钮：    Dark-700 背景 + Dark-400 文字
导航栏底色：  Dark-900  #1A1814
导航栏图标：  Dark-300  #A09A90（未选中）/ Brass-400（选中）
会员卡片：    Dark-800 背景 + Brass-400 边框 + Brass 色阶渐变装饰
```

### 3.2 Studio Mode（B端ERP管理后台）

```
页面底色：    Specimen Cream  #F2EDE4
卡片背景：    #FFFFFF
卡片边框：    Dark-100  #E8E5DE
侧边栏背景：  Dark-700  #262320
侧边栏文字：  Dark-200  #D5D1C8（未选中）/ #FFFFFF（选中）
侧边栏选中态： Forest Depth #2D5A3F 左侧指示条
主标题：      Dark-600  #33302C
副标题：      Dark-400  #6B6560
正文：        Dark-500  #4A4540
CTA按钮背景： Forest Depth #2D5A3F
CTA按钮文字： #FFFFFF
次要按钮：    透明背景 + Dark-100 边框 + Dark-500 文字
数据卡片强调： Brass-400 #C4A76C 顶部装饰条 或 Brass-50 #FAF6ED 背景
GMV/营收数据： Brass-400 #C4A76C（金色大字）
危险操作按钮： Error #D64045 背景 + #FFFFFF 文字
```

### 3.3 店长后台（小程序端B端）

```
背景底色：    Dark-900  #1A1814（与C端小程序统一暗色基调）
功能卡片：    Dark-800  #1F1D1A
功能图标背景： 使用Brass-400/品类色的10%透明度作为图标底色
GMV卡片：     Brass-400 渐变到 Brass-600（金色渐变卡片）
GMV文字：     #FFFFFF
导航：        与C端小程序一致
```

---

## 4. 字体规范

### 4.1 字体选择

| 用途 | 中文字体 | 英文/数字字体 | 备注 |
|------|---------|-------------|------|
| 品牌名「山海造物」 | 思源宋体 Source Han Serif | — | 品牌名始终用宋体 |
| 标题 | 思源黑体 Source Han Sans Medium | — | 500 weight |
| 正文 | 思源黑体 Source Han Sans Regular | — | 400 weight |
| 英文品牌名 | — | DM Serif Display / Georgia | 衬线体，配合品牌调性 |
| 英文标题/标签 | — | DM Sans / Inter | 无衬线，0.05em letter-spacing |
| 数据数字 | — | DM Mono / JetBrains Mono | 等宽字体，用于价格、GMV等 |
| 拉丁学名 | — | Georgia Italic | 斜体，Brass-400 色 |

### 4.2 字号层级

| 层级 | 小程序（rpx） | Web端（px） | 字重 | 色彩 |
|------|-------------|------------|------|------|
| H1 大标题 | 48rpx | 24px | 600 | 主色或白色 |
| H2 板块标题 | 36rpx | 18px | 500 | 主文字色 |
| H3 小标题 | 30rpx | 15px | 500 | 主文字色 |
| Body 正文 | 28rpx | 14px | 400 | 正文色 |
| Caption 辅助 | 24rpx | 12px | 400 | 次要文字色 |
| Label 标签 | 22rpx | 11px | 500 | 同组件语义色 |
| Overline 上标 | 20rpx | 10px | 500 | 次要文字色，letter-spacing 0.1em |

---

## 5. 间距系统

基础单位：4px（小程序中为 8rpx）

| Token | 值 | 用途 |
|-------|----| ------|
| space-1 | 4px / 8rpx | 图标与文字间距 |
| space-2 | 8px / 16rpx | 紧凑元素内间距 |
| space-3 | 12px / 24rpx | 列表项间距 |
| space-4 | 16px / 32rpx | 卡片内边距、板块间距 |
| space-5 | 20px / 40rpx | 板块间距 |
| space-6 | 24px / 48rpx | 大板块间距 |
| space-8 | 32px / 64rpx | 页面顶部/底部留白 |

---

## 6. 圆角系统

| Token | 值 | 用途 |
|-------|----| ------|
| radius-sm | 4px / 8rpx | 标签、小按钮 |
| radius-md | 8px / 16rpx | 输入框、普通按钮、小卡片 |
| radius-lg | 12px / 24rpx | 卡片、弹窗 |
| radius-xl | 16px / 32rpx | 底部弹出面板、大卡片 |
| radius-full | 9999px | 药丸形按钮、头像 |

---

## 7. 阴影系统

Museum Mode（深色背景上几乎不用阴影，用边框+层次代替）：
```css
/* 深色模式下不使用阴影，使用 border + 微妙的背景色层次 */
--shadow-museum: none;
--card-border-museum: 1px solid #26232066;
```

Studio Mode（浅色背景上用轻柔阴影）：
```css
--shadow-sm: 0 1px 2px rgba(26,24,20,0.05);
--shadow-md: 0 2px 8px rgba(26,24,20,0.08);
--shadow-lg: 0 4px 16px rgba(26,24,20,0.10);
```

---

## 8. CSS 变量定义

### 8.1 小程序（Museum Mode）— 在 app.wxss 中定义

```css
page {
  /* Foundation */
  --color-primary: #C4A76C;
  --color-primary-light: #E0CFA3;
  --color-primary-dark: #A8903C;
  --color-bg: #1A1814;
  --color-bg-card: #1F1D1A;
  --color-bg-elevated: #262320;
  --color-border: #26232066;
  --color-border-highlight: #4D401A;

  /* Text */
  --color-text-primary: #FFFFFF;
  --color-text-secondary: #A09A90;
  --color-text-body: #D5D1C8;
  --color-text-muted: #6B6560;
  --color-text-latin: #C4A76C; /* 拉丁学名专用 */

  /* Accent */
  --color-wood: #8B6F47;
  --color-forest: #2D5A3F;

  /* Category */
  --color-insecta: #52B788;
  --color-minerals: #7B68AE;
  --color-plantae: #6DA34D;
  --color-marine: #5B8FB9;

  /* Semantic */
  --color-success: #52B788;
  --color-warning: #E9A23B;
  --color-error: #D64045;
  --color-info: #5B8FB9;

  /* Brass Ramp */
  --brass-50: #FAF6ED;
  --brass-100: #F0E6CC;
  --brass-200: #E0CFA3;
  --brass-300: #D4BC85;
  --brass-400: #C4A76C;
  --brass-500: #A8903C;
  --brass-600: #8A7530;
  --brass-700: #6B5A24;
  --brass-800: #4D401A;
  --brass-900: #302810;

  /* Typography */
  --font-brand: 'Source Han Serif SC', 'Noto Serif SC', Georgia, serif;
  --font-heading: 'Source Han Sans SC', 'Noto Sans SC', sans-serif;
  --font-body: 'Source Han Sans SC', 'Noto Sans SC', sans-serif;
  --font-mono: 'JetBrains Mono', 'DM Mono', monospace;

  /* Spacing */
  --space-1: 8rpx;
  --space-2: 16rpx;
  --space-3: 24rpx;
  --space-4: 32rpx;
  --space-5: 40rpx;
  --space-6: 48rpx;
  --space-8: 64rpx;

  /* Radius */
  --radius-sm: 8rpx;
  --radius-md: 16rpx;
  --radius-lg: 24rpx;
  --radius-xl: 32rpx;
  --radius-full: 9999px;
}
```

### 8.2 ERP管理后台（Studio Mode）— 在 main.css 中定义

```css
:root {
  /* Foundation */
  --color-primary: #2D5A3F;
  --color-primary-light: #E1F5EE;
  --color-primary-dark: #1B4332;
  --color-accent: #C4A76C;
  --color-accent-light: #FAF6ED;
  --color-bg: #F2EDE4;
  --color-bg-card: #FFFFFF;
  --color-bg-sidebar: #262320;
  --color-border: #E8E5DE;
  --color-border-hover: #D5D1C8;

  /* Text */
  --color-text-primary: #33302C;
  --color-text-secondary: #6B6560;
  --color-text-body: #4A4540;
  --color-text-muted: #A09A90;
  --color-text-inverse: #FFFFFF;
  --color-text-sidebar: #D5D1C8;
  --color-text-sidebar-active: #FFFFFF;

  /* Data highlight */
  --color-data-gold: #C4A76C;
  --color-data-gold-bg: #FAF6ED;

  /* Category */
  --color-insecta: #52B788;
  --color-minerals: #7B68AE;
  --color-plantae: #6DA34D;
  --color-marine: #5B8FB9;

  /* Semantic */
  --color-success: #52B788;
  --color-warning: #E9A23B;
  --color-error: #D64045;
  --color-info: #5B8FB9;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(26,24,20,0.05);
  --shadow-md: 0 2px 8px rgba(26,24,20,0.08);
  --shadow-lg: 0 4px 16px rgba(26,24,20,0.10);

  /* Typography */
  --font-brand: 'Source Han Serif SC', Georgia, serif;
  --font-heading: 'Source Han Sans SC', system-ui, sans-serif;
  --font-body: 'Source Han Sans SC', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --font-english: 'DM Sans', 'Inter', sans-serif;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

---

## 9. 组件规范

### 9.1 按钮

**CTA 主按钮（Museum Mode）：**
```css
.btn-primary {
  background: var(--brass-400);
  color: var(--color-bg);
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-5);
  font-weight: 500;
  font-size: 28rpx;
  letter-spacing: 0.02em;
}
.btn-primary:active {
  background: var(--brass-500);
}
```

**CTA 主按钮（Studio Mode）：**
```css
.btn-primary {
  background: var(--color-primary);
  color: #FFFFFF;
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-5);
  font-weight: 500;
}
.btn-primary:hover {
  background: var(--color-primary-dark);
}
```

**次要按钮（两种模式通用逻辑）：**
```css
.btn-secondary {
  background: transparent;
  border: 1px solid currentColor;
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-5);
}
```

### 9.2 卡片

**Museum Mode 卡片：**
```css
.card-museum {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}
/* 高亮卡片（会员卡、特色活动） */
.card-museum-highlight {
  background: var(--color-bg-card);
  border: 1px solid var(--brass-800);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}
```

**Studio Mode 卡片：**
```css
.card-studio {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}
```

### 9.3 数据展示卡片（营收/GMV）

```css
.data-card-gold {
  background: linear-gradient(135deg, var(--brass-500) 0%, var(--brass-400) 100%);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  color: #FFFFFF;
}
.data-card-gold .data-value {
  font-family: var(--font-mono);
  font-size: 32px;
  font-weight: 600;
  color: #FFFFFF;
}
.data-card-gold .data-label {
  font-size: 12px;
  color: rgba(255,255,255,0.7);
  letter-spacing: 0.05em;
}
```

### 9.4 品类标签

```css
.tag-category {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.03em;
}
.tag-insecta { background: #52B78818; color: #52B788; }
.tag-minerals { background: #7B68AE18; color: #7B68AE; }
.tag-plantae { background: #6DA34D18; color: #6DA34D; }
.tag-marine { background: #5B8FB918; color: #5B8FB9; }
```

### 9.5 铜牌标注（物种信息）

门店中的物理铜牌在数字端的对应物：

```css
.specimen-plate {
  border: 1px solid var(--brass-200);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  background: var(--brass-50);
}
.specimen-plate .species-cn {
  font-family: var(--font-brand);
  font-size: 16px;
  font-weight: 600;
  color: var(--brass-600);
}
.specimen-plate .species-latin {
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 13px;
  color: var(--brass-400);
}
.specimen-plate .species-origin {
  font-size: 12px;
  color: var(--color-text-muted);
}
```

---

## 10. 导航规范

### 10.1 小程序底部 Tab Bar

```
背景：var(--color-bg) #1A1814
未选中图标：var(--color-text-muted) #6B6560
未选中文字：var(--color-text-muted) #6B6560
选中图标：var(--brass-400) #C4A76C
选中文字：var(--brass-400) #C4A76C
顶部分隔线：var(--color-border) #26232066

Tab项：探索 / 百科 / 社区 / 收藏箱 / 我的
```

### 10.2 ERP侧边栏

```
背景：var(--color-bg-sidebar) #262320
Logo区：品牌名白色 + 英文标签灰色
分组标题：#6B6560，大写英文，letter-spacing 0.15em
菜单项未选中：#D5D1C8
菜单项选中：#FFFFFF + 左侧 3px 指示条（品牌绿 #2D5A3F 或品牌紫用于AI模块）
菜单项 hover：背景 #33302C
图标：与文字同色，16px
```

---

## 11. 禁止事项

### 绝对禁止：
- **禁止使用纯黑 #000000** 作为背景。必须使用 Museum Dark #1A1814（带暖色调）
- **禁止使用纯白 #FFFFFF** 作为 C 端小程序背景。C 端底色是 #1A1814
- **禁止使用鲜亮的绿色**（如 #00FF00, #4CAF50 等 Material 绿）。品牌绿是 #2D5A3F
- **禁止使用蓝紫渐变**或任何科技感配色
- **禁止使用圆角大于 16px 的卡片**（除药丸形按钮外）
- **禁止在深色模式使用白色阴影或发光效果**
- **禁止使用 emoji 作为图标**，使用线性图标库（推荐 Lucide / Phosphor）
- **禁止在品牌名旁使用任何装饰线、下划线**

### 应该避免：
- 避免大面积使用金色（金色是点睛，不是底色。占视觉面积 < 15%）
- 避免过度使用品类色（品类色仅用于品类相关的 UI）
- 避免在同一界面使用超过 3 种品类色
- 避免深色模式下使用阴影（用边框和背景层次代替）

---

## 12. 色彩搭配速查

### C端小程序的一个典型页面：
```
背景 #1A1814 → 卡片 #1F1D1A 边框 #262320 
→ 标题 #FFFFFF → 正文 #D5D1C8 → 辅助 #A09A90 
→ 按钮 #C4A76C → 学名 #C4A76C 斜体
→ 品类标签 #52B788/18% 透明底
```

### B端ERP的一个典型页面：
```
背景 #F2EDE4 → 卡片 #FFFFFF 阴影 shadow-sm 
→ 标题 #33302C → 正文 #4A4540 → 辅助 #6B6560 
→ 主按钮 #2D5A3F → 数据高亮 #C4A76C
→ 侧边栏 #262320 → 侧边文字 #D5D1C8
```

### 一张产品详情页：
```
背景 #1A1814 → 产品图全宽 → 
铜牌信息区 Brass-50 底色 + Brass-200 边框
→ 物种中文名 Brass-600 宋体 → 拉丁名 Brass-400 斜体
→ 价格 #FFFFFF 等宽字体 → 加入收藏箱按钮 Brass-400
```

---

*山海造物 Nature's Creations — 把山海带回家*
*Design System v2.0 | 2026.04*
