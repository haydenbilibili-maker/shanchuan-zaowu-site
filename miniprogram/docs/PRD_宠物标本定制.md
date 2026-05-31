# 宠物标本定制 PRD（共创稿）

> **文档状态**：v0.4（工艺与装裱规划稿）  
> **模块代号**：Pet Memorial Atelier / 伴宠记忆工坊  
> **父模块**：标本工坊 Specimen Atelier（`pages/custom/*`）  
> **品牌**：山海造物 Nature's Creations · Museum Mode  
> **撰写日期**：2026-05-22  
> **共创说明**：本场景涉及**情感敏感内容、遗体收运、工艺合规与定价**，文中 **【待确认】** 须产品 / 运营 / 门店标本师 / 法务共同拍板后方可开发。

---

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 产品模块 | 宠物标本定制（用户提供病逝宠物 → 选工艺 → 提交制作意向 → 线下履约） |
| 与标品定制关系 | **并行子链路**，不复用「选馆藏标本 SKU」主流程；共享工坊视觉、专员、预约、站内信 |
| 建议页面 | `pages/custom/hub/index`（分岔）、`pages/custom/pet/index`（5 步向导）、`pages/custom/pet/status/index`（工单进度） |
| 关联能力 | 联系专员、预约到店、`custom_inquiries`（扩展）、店长后台工单、订阅消息 / 山海有信 |
| 关联集合（规划） | `pet_memorial_orders`、`pet_craft_configs`、`pet_mounting_configs`、`pet_memorial_bundles` |
| 视觉规范 | Museum Mode 暗底；文案克制、仪式化，**禁止**电商促销话术与轻浮 emoji |
| 前置文档 | [标本定制 PRD](./PRD_标本定制.md)、[联系专员功能说明](./联系专员功能说明.md) |

---

## 2. 背景与机会

### 2.1 业务诉求

标品「标本工坊」解决的是**从既有藏品库选型 + 装裱包装**的路径。线下门店实际还承接一类完全不同的高客单、长周期需求：

> **家属希望将陪伴多年的宠物，以标本形式永久留存。**

这类需求的特点：

| 维度 | 标品定制 | 宠物标本定制 |
|---|---|---|
| 标的物 | 门店已有昆虫 / 植物等 SKU | **用户自备**已逝宠物遗体 |
| 决策周期 | 分钟～小时 | 小时～数周（ grieving + 比价 + 咨询） |
| 定价 | SKU + 加价项可自助 | **强依赖报价**（物种、体重、工艺、姿态） |
| 履约 | 付款 → 制作 → 发货 | 意向 → 收运 → 制作 → 多阶段确认 → 交付 |
| 情感浓度 | 送礼 / 收藏 | **告别与纪念**，容错率极低 |

**机会**：将零散微信咨询产品化，建立可信的线上入口与工单透明化，同时过滤无法承接的物种 / 体量 / 时效预期。

### 2.2 现状诊断

| 维度 | 现状 | 缺口 |
|---|---|---|
| 工坊入口 | `pages/custom/index` 5 步标品向导 | 无宠物专属路径 |
| 意向单 | `custom_inquiries`（企业团购 / 到店） | 无宠物工艺 / 遗体信息结构 |
| 预约 | 入店参观 / 课程 | 未区分「遗体交接预约」 |
| 订单 | `orders` + `customMeta` | 不适合长周期、分阶段付款的宠物工单 |
| 内容 | 无 | 缺工艺科普、周期说明、案例展示（需授权）**【待确认】** |

**结论**：宠物标本应作为**独立工单型产品**，而非标品定制向导的简单分支；线上负责**知情同意 → 信息采集 → 意向提交 → 进度可查**，线下负责**评估、报价、收运、制作**。

---

## 3. 产品定位

### 3.1 一句话定位

> **伴宠记忆工坊 = 在山海造物工坊里，用专业工艺把陪伴过的一段生命，安静留下来。**  
> 不是「商品定制器」，而是**纪念服务的数字前台**。

### 3.2 对外命名 **【待确认 P1】**

| 方案 | 中文 | 调性 | 建议 |
|---|---|---|---|
| A | 伴宠记忆 | 温和、偏纪念 | **推荐 C 端** |
| B | 宠物标本定制 | 直白、偏功能 | 适合后台 / 工单 |
| C | 工坊 · 伴宠 | 与「标本工坊」并列 | 适合入口副标题 |
| D | 其他 | — | — |

英文 Overline 建议：`PET MEMORIAL · ATELIER`（全大写，与现有 ATELIER 体系一致）。

### 3.3 与标本工坊的关系

```
标本工坊（Atelier）
├── 标品定制（现有）…… 选馆藏标本 → 装裱 → 包装 → 下单
└── 伴宠记忆（本 PRD）… 了解工艺 → 填写宠物档案 → 选工艺 → 提交意向
                              ↓
                         专员 / 标本师评估报价
                              ↓
                         收运 → 制作 → 交付（线下为主）
```

- **入口**：工坊首页分岔，而非标品 Step 1 混排宠物卡片。
- **复用**：Museum UI、联系专员、预约、山海有信、店长 Tab10 扩展。
- **不复用**：标品 `makeOrder` 一键支付（MVP 阶段）。

### 3.4 北极星指标（建议）

| 指标 | 说明 |
|---|---|
| 有效意向提交率 | 进入宠物向导 → 完成提交（非中途放弃） |
| 评估转化率 | 提交意向 → 门店确认承接并报价 |
| 履约满意度 | 交付后 NPS / 复购推荐（线下采集） |
| 平均履约周期 | 自收运至交付的天数（按工艺分） |
| 咨询降级率 | 因物种 / 法规 / 体量无法承接的占比（用于优化前置筛选） |

---

## 4. 设计原则

1. **Dignity First（尊严优先）** — 全程不出现「商品」「爆款」等词；用「它 / 伙伴 / 留下」而非「处理遗体」。
2. **Informed Consent（充分知情）** — 工艺差异、周期、不可逆性、可能效果偏差，必须在提交前可读、可勾选确认。
3. **Human in the Loop（必须有人）** — 所有订单经标本师 / 专员评估后才确认承接；**禁止**用户自助完成标价支付（MVP）。
4. **Museum, Not Marketplace** — 视觉与 [标本定制 PRD](./PRD_标本定制.md) 一致；案例图需授权、柔光、留白。
5. **Progress Transparency（进度透明）** — 收运、制作、装裱、待取 / 寄送等状态可查询，减少焦虑性催单。
6. **Graceful Refusal（温和拒单）** — 不支持物种 / 超体量 / 超时未收运时，给出明确原因与备选（合作机构、其他纪念方式）**【待确认】**。

---

## 5. 目标用户与核心场景

| 用户 | 场景 | 期望 |
|---|---|---|
| 宠物主（猫 / 犬为主） | 宠物刚离世，希望留存纪念 | 快速了解工艺与价格区间 → 提交意向 → 有人联系 |
| 异宠饲主 | 兔、爬宠、鸟类等 | 知晓是否承接 → 特殊工艺说明 |
| 家庭成员 | 代长辈操作 | 流程清晰、可转发给家人共识 |
| 门店标本师 | 评估体量与可行性 | 结构化档案、照片、工艺选择，减少反复追问 |
| 店长 / 运营 | 工单调度 | 列表筛选、状态流转、导出交接单 |

---

## 6. 工艺与产品范围 **【待确认 · 核心】**

伴宠产品线分三层：**主工艺**（标本本体如何处理）、**装裱呈现**（如何被看见与安放）、**组合纪念**（爪印 / 毛发等非标本留存物）。  
线上向导 Step 3 建议演进为：**选主工艺 → 选装裱方案（或组合套餐）→ 纪念牌 / 卡片文案**。

### 6.1 工艺分层模型

```
                    ┌─────────────────────────────────────┐
                    │         伴宠记忆 · 产品三层          │
                    └─────────────────────────────────────┘
   Layer A 主工艺          Layer B 装裱呈现         Layer C 组合纪念件
   （标本本体）             （陈列 / 保护 / 仪式）    （可与 A 叠加或独立）
        │                        │                        │
   浸液 / 剥制 / 骨骼      罩柜 / 底座 / 画框      爪印 / 毛发瓶 / 照片牌
   冻干 / 组合纪念         壁挂 / 铜牌 / 礼盒      仪式卡 / 爪垫切片
```

| 层级 | 内部 type | 用户感知 | 是否需遗体 | 典型决策点 |
|---|---|---|---|---|
| **A 主工艺** | `craft` | 「用什么方式把它留下来」 | 是（除部分组合中的 mini 件） | 物种、体量、姿态、周期 |
| **B 装裱呈现** | `mounting` | 「完成后如何安放与展示」 | 否（制作后期选配） | 空间、家居风格、是否可触 |
| **C 组合纪念** | `addon` / `bundle` | 「还想留下哪些陪伴的痕迹」 | 部分需要（爪印现场取模） | 情感入门 vs 完整标本 |

**定价原则**：主工艺占报价大头；装裱与组合件按 `priceDelta` 叠加，最终由标本师在 `quote.breakdown[]` 中拆行展示（M2 已支持字段，M3 可视化选配）。

---

### 6.2 主工艺类型（规划全表）

| 工艺 ID | 用户端名称 | 一句话 | 周期 **【待确认】** | 体量 / 物种 **【待确认】** | 上线节奏 |
|---|---|---|---|---|---|
| `fluid` | 浸液标本 | 透明保存液中，安静观察形态 | 4–8 周 | 猫犬 ≤8kg；兔 / 小型异宠 | **✅ M1 已上线** |
| `taxidermy` | 剥制标本 | 还原生前姿态，保留真实毛发 | 8–16 周 | 猫犬 ≤12kg；姿态需评估 | **✅ M1 已上线** |
| `skeletal` | 骨骼标本 | 清理骨骼，可艺术化装裱 | 6–10 周 | 中大型犬；部分猫 | **✅ M1 已上线** |
| `freeze_dry` | 冻干保形 | 接近生前触感与色泽 **【设备待确认】** | 6–12 周 | 小型犬猫 ≤5kg | M3 候选 |
| `composite` | 组合纪念 | 不制作全身标本，留存多种纪念物 | 2–4 周 | 全物种（无体量硬限制） | **M3 重点** |
| `fluid_partial` | 局部浸液 **【待确认】** | 爪、尾等局部浸液，体量更小 | 3–6 周 | 任意体型均可选局部 | M3 可选 |

#### 6.2.1 各主工艺说明要点（C 端文案方向）

**浸液 `fluid`**  
- 事实：整体或局部固定于透明保存液，密封陈列。  
- 感受：像博物馆里的安静一景，适合日常伴看。  
- 连接：适合希望「完整形态、不占过多空间」的家庭。  
- 限制：毛色在液体中会有视觉变化；大型个体需评估容器与承重。

**剥制 `taxidermy`**  
- 事实：经剥制、填充、整姿，还原指定姿态。  
- 感受：最接近「它还在这里」的呈现方式。  
- 连接：适合愿意等待较长周期、对姿态有明确期待的家属。  
- 限制：体量越大周期越长；极端肥胖 / 毛发打结需预处理说明。

**骨骼 `skeletal`**  
- 事实：清理、漂白、重组骨骼，常配合艺术底座或壁挂。  
- 感受：结构之美，偏博物与纪念双重属性。  
- 连接：适合中大型犬、或希望「另一种安静陪伴」的选择。  
- 限制：不含软组织；需接受骨骼展示形式。

**组合纪念 `composite`**（见 §6.4，无主标本或含 mini 标本）  
- 事实：爪印、毛发、照片、局部浸液等组合，可不涉及全身标本。  
- 感受：门槛更低，仪式完整，适合「先留下些什么」的路径。  
- 连接：可作为剥制 / 浸液前的情感过渡，或独立纪念方案。

---

### 6.3 装裱呈现方式（Layer B）

装裱不与标品昆虫「画框」简单等同；伴宠装裱强调**保护、尊严、家居融合**。  
配置集合建议独立为 `pet_mounting_configs`（或 `pet_craft_configs.type = mounting`），字段复用标品 `custom_configs` 思路。

| 装裱 ID | 用户端名称 | 适用主工艺 | 说明 | 参考加价 **【待确认】** |
|---|---|---|---|---|
| `mount_open` | 开放式陈列 | 剥制 | 无罩，日常除尘维护；适合不触碰展示 | +¥0 |
| `mount_glass_dome_s` | 小型玻璃罩 | 剥制、组合 | 直径约 25–35cm 圆罩 | +¥600–1200 |
| `mount_glass_dome_l` | 大型玻璃罩 | 剥制 | 直径约 40–55cm；中大型犬需定制 | +¥1200–2800 |
| `mount_wood_pedestal` | 胡桃木底座 | 剥制、骨骼、浸液 | 博物馆式木座 + 铜牌位 | +¥500–1500 |
| `mount_shadow_box` | 深度纪念画框 | 骨骼、组合、局部浸液 | 阴影盒，可嵌入爪印 / 照片 | +¥400–900 |
| `mount_wall_art` | 壁挂装裱 | 骨骼 | 墙挂结构，含隐藏固件 | +¥300–800 |
| `mount_fluid_vessel` | 浸液专用器皿 | 浸液 | 高硼硅 / 定制玻璃器皿 + 木盖 | +¥300–1000 |
| `mount_plaque_brass` | 黄铜纪念牌 | 全部 | 刻字铜牌（与 `plaqueText` 联动） | +¥150–300 |
| `mount_gift_case` | 仪式运输礼盒 | 全部 | 交付用外箱，非日常陈列 | +¥200–500 |

**装裱兼容矩阵（规划）**

|  | 浸液 | 剥制 | 骨骼 | 组合纪念 |
|---|---|---|---|---|
| 玻璃罩 | — | ● | — | ○ mini |
| 木底座 | ● | ● | ● | ● |
| 阴影盒 | ○ | — | ● | ● |
| 壁挂 | — | — | ● | ○ |
| 专用器皿 | ● | — | — | ○ |
| 铜牌 | ● | ● | ● | ● |

图例：● 推荐　○ 可选　— 通常不适用

---

### 6.4 组合纪念装裱方式（Layer C · 核心规划）

「组合纪念」是伴宠差异化的**情感入门款**，也是主工艺订单的**增购层**。  
建议以 **预设套餐 bundle** + **自选加项 addon** 两种方式提供。

#### 6.4.1 组合件单品库（addon）

| 加项 ID | 用户端名称 | 取材 / 制作 | 周期 | 说明 |
|---|---|---|---|---|
| `addon_paw_clay` | 爪印（泥型） | 交接现场取模 | 含在 2 周内 | 可装裱入阴影盒 |
| `addon_paw_ceramic` | 爪印（陶瓷） | 取模后烧制 | +2–3 周 | 更耐久，可单独陈列 |
| `addon_hair_vial` | 毛发纪念瓶 | 交接时取样 | 含在 2 周内 | 小玻璃瓶 + 木塞 + 标签 |
| `addon_photo_plate` | 照片纪念牌 | 用户提供照片 | +1 周 | 哑光金属 / 纸卡插槽 |
| `addon_fluid_paw` | 爪部浸液（mini） | 需遗体 / 已分离部位 | 3–6 周 | 可与阴影盒组合 |
| `addon_ritual_card` | 仪式手卡 | 门店代笔 / 印刷 | +3 天 | 复用标品卡片逻辑 |
| `addon_name_plaque` | 刻字木牌 | 激光 / 手工 | +1 周 | 与底座或画框一体 |

#### 6.4.2 预设组合套餐（bundle）

| 套餐 ID | 用户端名称 | 包含内容 | 适合谁 | 参考区间 **【待确认】** |
|---|---|---|---|---|
| `bundle_trace` | 痕迹留存 | 爪印（泥型）+ 毛发瓶 + 仪式手卡 | 暂不制作标本、先留存痕迹 | ¥800–1500 |
| `bundle_shadow` | 阴影盒纪念 | 阴影盒 + 爪印 + 照片牌 + 铜牌 | 小型宠、希望上墙或案头 | ¥1500–2800 |
| `bundle_fluid_mini` | 局部浸液组合 | 爪 / 尾局部浸液 + 专用器皿 + 铜牌 | 体量大、暂不做全身 | ¥2800–4500 |
| `bundle_cabinet_s` | 小型罩柜套装 | 剥制（≤5kg）+ 小型玻璃罩 + 木底座 + 铜牌 | 完整陈列、占台面 | ¥8800 起 **【待门店价目】** |
| `bundle_cabinet_l` | 大型罩柜套装 | 剥制（5–12kg）+ 大型玻璃罩 + 定制底座 | 中大型犬完整纪念 | 报价制 |
| `bundle_skeletal_art` | 骨骼艺术套装 | 骨骼制作 + 壁挂或阴影盒 + 铜牌 | 结构纪念、墙面展示 | ¥4500 起 |
| `bundle_ritual_full` | 完整告别套装 | 主工艺（用户选）+ 爪印 + 毛发 + 礼盒 + 铜牌 | 一次选齐，减少决策负担 | 主工艺价 + 套餐加价 |

**套餐与主工艺关系**

```
用户路径 A（入门）:  只选 bundle_trace / bundle_shadow  → craftId = composite
用户路径 B（完整）:  主工艺 taxidermy + 加购 bundle 内单项  → craft + mounting + addons[]
用户路径 C（省心）:  主工艺 + bundle_ritual_full 预设       → 向导一步展示「套装内容」
```

#### 6.4.3 组合纪念装裱示意（产品语义）

```
┌─ bundle_shadow · 阴影盒纪念 ─────────────────────────┐
│  [ 示意图：深框 + 爪印 + 小照片 + 铜牌 ]                  │
│                                                         │
│  · 爪印（泥型，交接日取模）                              │
│  · 照片纪念牌（您提供 1 张）                             │
│  · 黄铜铜牌（刻名 + 日期）                               │
│  · 深度画框整体装裱                                      │
│                                                         │
│  周期约 2–4 周 · 无需全身标本 · 专员评估后报价           │
└─────────────────────────────────────────────────────────┘

┌─ bundle_cabinet_s · 小型罩柜套装 ───────────────────────┐
│  [ 示意图：剥制 + 玻璃罩 + 木底座 ]                      │
│                                                         │
│  · 剥制标本（姿态：趴卧 / 端坐 二选一）                   │
│  · 小型玻璃罩 + 胡桃木底座                               │
│  · 铜牌刻字                                              │
│                                                         │
│  周期约 10–16 周 · 需交接遗体 · 体量 ≤5kg  **【待确认】** │
└─────────────────────────────────────────────────────────┘
```

#### 6.4.4 向导交互建议（M3）

Step 3 拆为两个子步（或 Tab）：

1. **主工艺** — 单选（含「组合纪念」卡片，选中后展示套餐列表）  
2. **装裱与组合** — 根据主工艺过滤可选项：  
   - 若 `composite`：只展示 bundle 列表  
   - 若 `taxidermy` / `fluid` / `skeletal`：展示装裱矩阵 + 可选 addon 多选  
   - 铜牌刻字、卡片文案始终可见  

预览区展示「装配清单」而非价格（M3 仍可由专员报价；有价目后可展示区间）。

---

### 6.5 明确不承接 **【待确认】**

建议 MVP 前置声明（减少无效咨询）：

- 受保护野生动物、无合法来源物种
- 超出门店设备 / 资质的处理体量 **【阈值待确认】**
- 已严重腐败、超过可处理时限的遗体 **【时限待确认，如 24–48h 冷冻】**
- 用户要求违法运输方式

---

## 7. 用户旅程（建议 6 步向导）

与标品 5 步不同，宠物链路更长、更偏「服务申请」：

```
Step 0  工坊入口分岔
        ├── 标品定制（现有）
        └── 伴宠记忆（本模块）→ 工艺科普短页（可跳过）

Step 1  了解与确认
        ├── 服务说明、周期区间、知情同意勾选
        └── 「我已阅读并理解工艺与周期说明」

Step 2  它的档案
        ├── 昵称、物种（猫 / 犬 / 兔 / 爬宠 / 鸟 / 其他）
        ├── 品种、毛色、体重区间、大致体型
        ├── 离世时间、当前存放方式（冷藏 / 冷冻 / 其他）**【敏感】**
        └── 照片 1–3 张（侧面、体量参考）

Step 3  选择工艺与装裱
        ├── 主工艺（浸液 / 剥制 / 骨骼 / 组合纪念…）
        ├── 姿态意向（趴卧 / 端坐 / 定制说明）**【剥制适用】**
        ├── 装裱方案（罩柜 / 底座 / 阴影盒…）**【M3】**
        ├── 组合套餐或加项（爪印 / 毛发瓶…）**【M3】**
        └── 纪念牌 / 卡片文案

Step 4  交接方式
        ├── 到店交接（预约时段）
        ├── 上门收运 **【待确认服务范围：长春市？全国？】**
        └── 合作宠物医院代交接 **【待确认】**

Step 5  联系与意向
        ├── 联系人、手机号、与宠物关系
        ├── 补充说明（特殊要求，500 字内）
        └── 提交意向（非支付）

Step 6  进度（提交后）
        ├── 工单号、当前状态
        ├── 专员 / 标本师留言
        └── 预约交接 / 确认报价 / 支付（后续阶段）
```

---

## 8. 功能清单与分期

| 功能 | 优先级 | 说明 | 状态 |
|---|---|---|---|
| 工坊入口分岔（标品 / 伴宠） | **P0** | `pages/custom/hub/index` | ✅ M1 |
| 工艺说明（向导 Step1/3 内嵌） | **P0** | 首批 3 种工艺（浸液 / 剥制 / 骨骼） | ✅ M1 |
| 5 步意向向导 + 知情同意 | **P0** | 提交至 `pet_memorial_orders` | ✅ M1 |
| 图片上传（宠物照片） | **P0** | 云存储，工单可见 | ✅ M1 |
| 山海有信回执 + 专员通知 | **P0** | `sendInAppMessage` + topic `pet_memorial` | ✅ M1 |
| 用户工单进度页 | **P1** | `pages/custom/pet/status/index` | ✅ M1 |
| 用户工单列表 | **P1** | `pages/custom/pet/list/index` | ✅ M2 |
| 预约联动（遗体交接） | **P1** | `createBooking` type=`pet_intake` | ✅ M2 |
| 报价字段 + 用户确认 | **P1** | 店长填报价 → 用户确认（无支付） | ✅ M2 |
| 店长后台：宠物工单 Tab | **P1** | Tab10 子 Tab「伴宠」 | ✅ M1 |
| 订金 + 尾款支付 | **P2** | 独立支付链路 **【待确认】** | — |
| 案例库（授权展示） | **P2** | 内容运营 | — |
| 装裱 / 组合选配可视化 | **P2** | `pet_mounting_configs` + 向导 Step3 扩展 | M3 |
| 组合纪念套餐 | **P2** | `pet_memorial_bundles` + `composite` 工艺 | M3 |
| 案例库（授权展示） | **P2** | 按工艺 / 装裱 tag 筛选 | M3 |
| 冻干 / 局部浸液 | **P3** | 设备与价目确认后 | — |

---

## 9. 入口设计

### 9.1 推荐入口

| 位置 | 形式 | 说明 |
|---|---|---|
| **我的 → 伴宠工单** | 菜单项 | 列表 + 进度 |
| **标本工坊首页** | 双卡片分岔 | 「选一件标本」 / 「伴宠记忆」 |
| **我的 → 标本工坊** | 菜单项 | hub 分岔 |
| **联系专员** | 咨询类型 `pet_memorial` | 可从任意步 escalation |
| **探索专题** | 低频率内容位 | 需案例授权，不做硬广 **【待确认】** |

**不建议**：底部 Tab 独立入口；不建议与标品 Step 1 商品网格混排。

### 9.2 入口文案示意

```
┌─────────────────────────────────────┐
│  伴宠记忆              PET MEMORIAL  │
│  ─────────────────────────────────  │
│  [ 柔光案例图：装裱中的猫 / 犬 ]       │
│  用工坊工艺，把陪伴过的一段生命        │
│  安静留下来。                         │
│  [ 了解工艺与流程 ]  黄铜描边按钮      │
└─────────────────────────────────────┘
```

---

## 10. 数据模型（草案）

### 10.1 宠物纪念工单 `pet_memorial_orders`

```javascript
{
  _id: '',
  _openid: '',
  orderNo: 'PM20260522xxxx',      // 宠物 memorial 专用号
  status: 'pending_review',       // 见 §10.3
  pet: {
    name: '豆包',
    species: 'cat',               // cat | dog | rabbit | reptile | bird | other
    breed: '英短',
    weightRange: '3-5kg',
    coatColor: '蓝白',
    passedAt: '2026-05-20',
    storage: 'frozen',            // chilled | frozen | other
    photos: ['cloud://...']
  },
  craft: {
    craftId: 'taxidermy',           // 主工艺 ID
    craftName: '剥制标本',
    craftTier: 'primary',           // primary | composite
    pose: 'sleeping',
    poseNote: '',
    bundleId: '',                   // 若选 preset 套餐
    bundleName: '',
    mounting: {
      presetId: 'bundle_cabinet_s', // 或 mount_glass_dome_s + mount_wood_pedestal
      items: [                      // 装裱 + 加项明细
        { configId: 'mount_glass_dome_s', type: 'mounting', name: '小型玻璃罩', priceDelta: 800 },
        { configId: 'mount_wood_pedestal', type: 'mounting', name: '胡桃木底座', priceDelta: 600 },
        { configId: 'addon_paw_ceramic', type: 'addon', name: '陶瓷爪印', priceDelta: 380 }
      ],
      assemblyNote: ''              // 用户特殊陈列说明
    },
    plaqueText: '',                 // 铜牌刻字
    cardText: ''                    // 仪式手卡 **【M3】**
  },
  intake: {
    method: 'store',              // store | pickup | partner_clinic
    preferredDate: '2026-05-25',
    address: {},                  // 上门收运时
    bookingId: ''                 // 关联预约
  },
  contact: {
    name: '',
    phone: '',
    relation: 'owner',            // owner | family | other
    note: ''
  },
  consent: {
    agreedAt: '',
    version: 'v1'                 // 知情同意书版本
  },
  quote: {                        // P2 报价
    amount: null,
    breakdown: [],
    quotedAt: null,
    validUntil: null
  },
  payments: [],                   // P2 分阶段
  productionLog: [],              // 状态变更记录
  assignedFramerId: '',
  createTime: '',
  updateTime: ''
}
```

### 10.2 工艺配置 `pet_craft_configs`

```javascript
{
  craftId: 'fluid',
  name: '浸液标本',
  desc: '……',
  image: 'cloud://...',
  priceRangeMin: 2800,
  priceRangeMax: 6800,
  estimatedWeeksMin: 4,
  estimatedWeeksMax: 8,
  speciesAllow: ['cat', 'dog', 'rabbit'],
  weightMaxKg: 8,
  sort: 1,
  status: 'active'
}
```

### 10.2 工艺配置 `pet_craft_configs`

```javascript
{
  craftId: 'fluid',
  type: 'craft',                  // craft | mounting | addon ；mounting/addon 也可独立集合
  name: '浸液标本',
  desc: '……',
  image: 'cloud://...',
  priceRangeMin: 2800,
  priceRangeMax: 6800,
  estimatedWeeksMin: 4,
  estimatedWeeksMax: 8,
  speciesAllow: ['cat', 'dog', 'rabbit'],
  weightMaxKg: 8,
  compatibleMounting: ['mount_fluid_vessel', 'mount_wood_pedestal', 'mount_plaque_brass'],
  compatibleAddons: ['addon_hair_vial', 'addon_ritual_card'],
  sort: 1,
  status: 'active'
}
```

### 10.3 装裱与加项配置 `pet_mounting_configs`

```javascript
{
  configId: 'mount_glass_dome_s',
  type: 'mounting',               // mounting | addon
  name: '小型玻璃罩',
  desc: '高透玻璃罩，适合台面陈列',
  image: 'cloud://...',
  priceDelta: 800,
  applicableCrafts: ['taxidermy', 'composite'],
  sizeSpec: '直径 30cm（约）',
  sort: 10,
  status: 'active'
}
```

### 10.4 组合套餐 `pet_memorial_bundles`

```javascript
{
  bundleId: 'bundle_shadow',
  name: '阴影盒纪念',
  desc: '爪印、照片与铜牌装入深度画框，无需全身标本',
  image: 'cloud://...',
  craftId: 'composite',           // 选中此套餐时主工艺固定为 composite
  includes: [
    { configId: 'addon_paw_clay', type: 'addon', name: '爪印（泥型）' },
    { configId: 'addon_photo_plate', type: 'addon', name: '照片纪念牌' },
    { configId: 'mount_shadow_box', type: 'mounting', name: '深度纪念画框' },
    { configId: 'mount_plaque_brass', type: 'mounting', name: '黄铜纪念牌' }
  ],
  priceRangeMin: 1500,
  priceRangeMax: 2800,
  estimatedWeeksMin: 2,
  estimatedWeeksMax: 4,
  requiresIntake: true,           // 爪印需交接日取模
  sort: 1,
  status: 'active'
}
```

### 10.5 报价拆行 `quote.breakdown`（M3 建议）

```javascript
quote: {
  amount: 12800,
  breakdown: [
    { line: '主工艺 · 剥制标本', amount: 8800 },
    { line: '装裱 · 小型玻璃罩', amount: 800 },
    { line: '装裱 · 胡桃木底座', amount: 600 },
    { line: '加项 · 陶瓷爪印', amount: 380 },
    { line: '加项 · 毛发纪念瓶', amount: 220 }
  ],
  quotedAt: '...',
  validUntil: '...'
}
```

### 10.6 工单状态流转

```
pending_review     待评估（用户刚提交）
      ↓
need_info          需补充信息（专员留言）
      ↓
quoted             已报价待确认（P2）
      ↓
accepted           已确认承接
      ↓
awaiting_intake    待交接遗体
      ↓
intake_done        已收运 / 到店交接
      ↓
in_production      制作中
      ↓
quality_check      质检 / 客户确认 **【待确认】**
      ↓
ready              待取 / 待寄
      ↓
completed          已完成
      ↓
cancelled          已取消 / 无法承接
```

---

## 11. 计价与支付 **【待确认】**

| 方案 | 说明 | 建议 |
|---|---|---|
| **A. 仅意向，线下报价** | 线上无价格，专员电话 / 微信报价 | **MVP 推荐** |
| **B. 区间价 + 评估后补差** | 向导展示「¥ X 起」，提交后标本师确认 | P1 可选 |
| **C. 订金 + 尾款** | 确认承接后支付 30% 订金，交付前尾款 | P2 |
| **D. 全额预付** | 不推荐；体量大、效果预期难统一 | 不建议 |

宠物工单**不与标品购物车混单**；支付链路可独立云函数 `payPetMemorialOrder`（P2）。

---

## 12. 合规与运营 **【必审】**

| 项 | 要求 |
|---|---|
| 知情同意 | 工艺效果、周期、不可逆、个体差异免责；版本化存档 |
| 隐私 | 宠物照片、地址仅工单相关人员可见；脱敏展示 |
| 遗体 handling | 交接清单、冷藏时限、卫生规范 — 以门店 SOP 为准 **【待输出】** |
| 物种法规 | 禁止受保护 wildlife；异宠需额外资质 **【待法务确认】** |
| 文案审核 | 符合品牌 VI：朋友式、克制；禁止直播电商话术 |
| 心理敏感 | 取消「催付」「限时优惠」；允许用户保存草稿稍后再提 |

---

## 13. 后台与店长能力

| 能力 | 优先级 | 说明 |
|---|---|---|
| 宠物工单列表 | P1 | 店长 Tab10 或独立 Tab11 |
| 状态流转 + 内部备注 | P1 | |
| 导出交接单 / 制作单 | P1 | 类似标品「复制工单」 |
| 工艺配置 CRUD | P1 | `pet_craft_configs` |
| 报价录入 | P2 | |
| 案例内容管理 | P2 | 需客户授权书 **【待确认】** |

---

## 14. 埋点（建议）

| 事件 | 触发 |
|---|---|
| `pet_memorial_enter` | 进入伴宠模块 |
| `pet_memorial_step_view` | 各步曝光 |
| `pet_craft_select` | 选择主工艺 |
| `pet_mounting_select` | 选择装裱 / 加项 |
| `pet_bundle_select` | 选择组合套餐 |
| `pet_memorial_consent` | 勾选知情同意 |
| `pet_memorial_submit` | 提交意向 |
| `pet_memorial_escalate` | 跳转联系专员 |
| `pet_intake_book` | 预约遗体交接 |

---

## 15. MVP 范围与里程碑（建议）

| 阶段 | 时间（参考） | 交付 | 状态 |
|---|---|---|---|
| **M0 共创** | 1–2 周 | 本文档定稿 + 门店 SOP + 工艺价目初稿 | |
| **M1 MVP** | 3–4 周 | 入口分岔 + 工艺说明 + 意向向导 + 工单入库 + 站内信 | **✅ 已交付（2026-05-22）** |
| **M2** | +3 周 | 预约交接 + 用户工单列表 + 报价确认 | **✅ 已交付（2026-05-23）** |
| **M3** | +4 周 | 组合纪念 + 装裱选配 + 报价拆行 + 案例库 | 规划完成，待开发 |

---

### 15.1 M1 实现清单（代码映射）

| 模块 | 路径 / 云函数 |
|---|---|
| 工坊分岔 | `pages/custom/hub/index` |
| 5 步向导 | `pages/custom/pet/index` |
| 进度页 | `pages/custom/pet/status/index` |
| 默认配置 | `utils/petMemorialDefaults.js` |
| 工单构建 | `utils/petMemorialHelper.js` |
| 读取工艺 | 云函数 `getPetMemorialConfig`（集合 `pet_craft_configs` 可选） |
| 提交 / 查询 | 云函数 `petMemorialOrder`（集合 `pet_memorial_orders`） |
| 联系专员 | topic `pet_memorial`（`getSupportConfig` / `submitSupportTicket`） |
| 店长后台 | `subpackages/business/manager` Tab10 子 Tab「伴宠」 |
| 入口 | 首页 / 分类 / 我的 → `/pages/custom/hub/index` |

**部署提醒**：需在微信云开发控制台创建集合 `pet_memorial_orders`；上传并部署云函数 `getPetMemorialConfig`、`petMemorialOrder`、**`createBooking`（M2 更新）**。

### 15.2 M2 实现清单（代码映射）

| 模块 | 路径 / 云函数 |
|---|---|
| 工单列表 | `pages/custom/pet/list/index` |
| 报价展示 / 确认 | `pages/custom/pet/status/index` + `petMemorialOrder` action=`confirmQuote` |
| 遗体交接预约 | `pages/booking/index?from=pet&orderId=` + `createBooking` type=`pet_intake` |
| 店长填报价 | `subpackages/business/manager` 伴宠 Tab → 报价弹窗 |
| 入口 | 我的 → 伴宠工单；工坊 hub → 查看我的伴宠工单 |

**M2 用户主路径**：提交意向 → 店长报价 → 用户确认报价 → 预约到店交接 → 工单状态 `intake_done`

### 15.3 M3 工艺与装裱（规划清单）

| 模块 | 说明 |
|---|---|
| 数据种子 | `pet_craft_configs` 补全 `composite`；新建 `pet_mounting_configs`、`pet_memorial_bundles` |
| 云函数 | `getPetMemorialConfig` 返回 crafts + mountings + bundles + 兼容矩阵 |
| 向导 Step3 | 主工艺 → 套餐 / 装裱 / 加项；预览装配清单 |
| 工单字段 | `craft.mounting.items[]`、`craft.bundleId`、`quote.breakdown[]` |
| 店长报价 | 报价弹窗支持按拆行录入或勾选套餐默认价 |
| 案例库 | 按 `craftId` + `bundleId` + `mounting` tag 展示授权图 |

---

## 16. 共创议题清单

| # | 议题 | 选项 / 建议 |
|---|---|---|
| **P1** | 对外模块名称 | A. 伴宠记忆 B. 宠物标本 C. 其他：____ |
| **P2** | 首批上线工艺 | M1：**浸液 + 剥制 + 骨骼**；M3：**组合纪念 + 装裱**；冻干后续 |
| **P11** | 组合纪念是否独立入口 | 建议 **工坊内与主工艺并列卡片**，不另开 Tab |
| **P12** | 爪印取模时机 | 建议 **交接日现场**，线上仅表达意向 |
| **P13** | 装裱是否展示参考价 | M3 可展示 **区间价**，精确价仍走报价 |
| **P14** | 套餐是否允许拆项改配 | 建议 **可降级为自选加项**，避免 rigid SKU |
| **P3** | 是否展示价格区间 | 建议 MVP **不展示精确价**，仅「专员评估后报价」 |
| **P4** | 收运范围 | 仅门店自送 / 同城上门 / 异地冷链 **【待确认】** |
| **P5** | 遗体可处理时限 | 如离世后 **48h 内冷冻** 等，需门店给出 |
| **P6** | 体量上限 | 如犬 **≤15kg** 等，超出转拒单或合作方 |
| **P7** | 是否需订金 | 建议 P2 引入 **30% 订金** 锁定档期 |
| **P8** | 案例展示 | 是否已有授权案例图库？无则 MVP 仅用工艺示意图 |
| **P9** | 与标品工坊 UI | 建议 **同一 Atelier 壳 + 分岔**，不另起品牌 |
| **P10** | 质检确认环节 | 制作完成后是否需用户确认照片再发货？ |

---

## 17. 附录

### 17.1 与现有代码的映射（规划）

| 能力 | 现有 | 宠物模块（M1 实现） |
|---|---|---|
| 意向提交 | `submitCustomInquiry` | 云函数 `petMemorialOrder` action=`submit` |
| 预约 | `createBooking` | type=`pet_intake` + `petMemorialOrderId` ✅ |
| 报价 | 店长后台 | `quote` 字段 + 用户 `confirmQuote` ✅ |
| 专员 | `submitSupportTicket` | topic `pet_memorial` ✅ |
| 进度通知 | `sendInAppMessage` | 模板 `pet_memorial_received` ✅ |
| 店长后台 | Tab10 标本定制 | 子 Tab「伴宠」✅ |

### 17.2 参考文档

- [标本定制 PRD](./PRD_标本定制.md)（标品工坊主链路）
- [宠物标本定制 PRD](./PRD_宠物标本定制.md)（伴宠记忆 · 规划稿）
- [联系专员功能说明](./联系专员功能说明.md)
- [品牌 VI 手册](./brand-vi-manual-v2.md)
- Design System：`.cursorrules`

### 17.3 名词对照

| 用户端文案 | 内部字段 | 说明 |
|---|---|---|
| 伴宠 / 它 | `pet.name` | 不用「尸体」「素材」 |
| 工艺 | `craft.craftId` | 浸液 / 剥制 / 组合纪念等 |
| 装裱 | `craft.mounting.items[]` | 罩柜 / 底座 / 画框 |
| 套餐 | `craft.bundleId` | 预设组合 memorial bundle |
| 加项 | `type: addon` | 爪印 / 毛发瓶等 |
| 交接 | `intake.method` | 到店 / 上门 / 合作点 |
| 意向单 | `pet_memorial_orders` | 非电商 order，MVP 阶段 |

---

*山海造物 Nature's Creations — 把山海带回家*  
*PRD v0.4 · 宠物标本定制（工艺与装裱规划）· 2026-05-23*
