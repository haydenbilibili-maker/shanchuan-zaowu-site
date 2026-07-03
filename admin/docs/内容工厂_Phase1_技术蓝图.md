# 山海造物 · 内容工厂模块 · Phase 1 技术蓝图

> 版本 v1.0 · 2026-06-29 · 面向 `shanchuanzaowu/admin`（Vue3 + Element Plus + Vite + CloudBase）
> 原则：**加法不重构**。复用现有模型网关与模块注册机制，新增一个「内容工厂」模块簇。不新建平台、不改后台架构。

---

## 0. 目的与范围

**Phase 1 目标**：在中台里落地一个可用的内容工作台，把「选题 → 文案/脚本（过话术宪法）→ 终审 → 发布登记 → 复盘」跑成有状态、有数据、有 AI 辅助的闭环。人只出现在「选题挑选、真实拍摄、终审、真实私域」四处。

**Phase 1 做**：
- 一个模块「内容工厂」（内部分 5 个 Tab）
- 四个 Agent（话术宪法 / 选题 / 改写分发 / 复盘），全部复用 `callGeminiAPI` 网关
- 五张 CloudBase 集合（选题 / 母素材 / 成品工单 / 终审日志 / 复盘）
- 内容看板状态机 + 人工终审闸口

**Phase 1 不做**（留给 Phase 2/3，或永远不做）：
- ❌ 自动发帖到小红书/抖音（无开放第三方发布 API，违规）→ 只做「生成→终审→导出/复制→人工发布」
- ❌ 自建视频剪辑/切片引擎 → 用剪映/CapCut，文件交接
- ❌ 数字人直播 → Phase 3 评估，且仅限「转化场」

---

## 1. 架构总览（编排层模式）

```
                       ┌─────────────── 人工终审闸口 ───────────────┐
                       │                                            │
 选题Agent ─┐          ▼                                            │
 改写分发Agent ─┼─► callGeminiAPI(多模型故障转移) ─► extractJSON ─► 内容看板(CloudBase)
 话术宪法Agent ─┤        （复用 utils/aiHelper.js）                    │
 复盘Agent ─────┘                                                    ▼
      ▲                                                    导出/复制 → 人工发布
      │                                                             │
      └──────── 复盘数据回流选题（飞轮）◄── 发布后回填指标 ◄─────────┘

 私域：CompanionRobot(马上有) + CommentsModeration（复用现有组件）
 重活外接：剪映/CapCut（切片） · 定时发布工具（半自动）
```

**一句话**：编排层（新模块）+ 复用模型网关 + CloudBase 资产库 + 人工终审闸口 + 媒体 SaaS 外接。

---

## 2. 复用清单（已存在，直接用，勿重写）

| 复用项 | 路径 | 用途 |
|---|---|---|
| 模型网关（多路故障转移） | `utils/aiHelper.js` → `callGeminiAPI(prompt, options)`、`extractJSON(text)`、`enhancePrompt`、`buildConversationHistory`、`batchCallGeminiAPI` | 所有 Agent 的模型调用 |
| 话术/台词基建 | `utils/llmTalkingScript.js`、`components/TalkingScriptCard.vue` | 话术宪法 Agent 与话术卡片 |
| 内容 AI 种子 | `components/ai/ContentAI.vue` | 升级/并入内容工厂 |
| 复盘/智脑 | `components/AIStrategicBrain.vue`、`components/ai/DataReportAI.vue`、`components/BehaviorAnalytics.vue` | 复盘 Agent 数据源 |
| 私域/客服 | `components/CompanionRobot.vue`（马上有）、`components/CommentsModeration.vue`、`components/AudienceManager.vue` | 私域一线 |
| 模块注册 | `utils/modulesRegistry.js`、`config/sidebarNav.js`、`composables/useTabsManager.js` | 挂载新模块 |
| 存储 | CloudBase（`cloudbase/schema`、`cloudbase/rules`）+ `utils/cloudbaseCdnDb.js` | 内容集合 |

### 2.1 网关调用范式（照抄现有 ai/*.vue）

```js
import { callGeminiAPI, extractJSON } from '../../utils/aiHelper'

const response = await callGeminiAPI(prompt, {
  provider: 'bailian',   // bailian(qwen) / gemini / deepseek / openai / local(ollama)；不传则走默认+故障转移
  usePro: true,          // true=qwen-max，false=qwen-plus
  temperature: 0.7,      // 话术宪法用低温(0.3-0.5)，选题可高温(0.9)
})
const data = extractJSON(response)  // 解析 Agent 的 JSON 输出
```

---

## 3. 模块簇与注册

Phase 1 用**单模块 + 内部 Tab**，避免一次塞太多顶级模块。

### 3.1 新模块

| id | 名称 | 分组 | 二级 | 组件 |
|---|---|---|---|---|
| `51`（当前最大 id 为 50，取下一个空号 51） | 内容工厂 | `CUSTOMER` 客户经营 | 内容营销 | `components/ContentFactory.vue` |

内部 5 个 Tab（Element Plus `el-tabs`）：**看板 / 选题库 / 母素材库 / 复盘 / 话术宪法**。

### 3.2 注册三处（沿用现有单一数据源机制）

**`utils/modulesRegistry.js`** — MODULES 数组新增：
```js
{ id: '51', name: '内容工厂', group: 'CUSTOMER', subgroup: '内容营销',
  icon: 'VideoCamera', keywords: 'content factory nrgc 内容 营销 选题 直播 文案 话术' },
```

**`config/sidebarNav.js`** — `customer` 组下新增二级分组或 item：
```js
{ title: '内容营销', items: [ { id: '51', icon: 'VideoCamera', label: '内容工厂' } ] },
```

**`App.vue`** — 在 `currentTab === '51'` 分支渲染 `<ContentFactory />`（沿用现有 v-if/component 挂载方式与 `useTabsManager`）。

---

## 4. CloudBase 数据模型

五张集合（命名前缀 `content_`）。字段给最小可用集，`_openid`/`createdAt`/`updatedAt` 按现有规范补。

### 4.1 `content_topics`（选题库）
```json
{
  "_id": "string",
  "title": "string",
  "ip": "GRAVITY | LIGHTNESS",
  "platform": "xhs | douyin | shipinhao | bilibili",
  "category": "标本 | 首饰 | 器物 | 内容 | 香气 | 礼盒",
  "angle": "非主体叙事角度（光/季节/容器…）",
  "hook": "钩子一句话",
  "rationale": "AI 给的理由 / 数据依据",
  "source": "agent | human | flywheel",
  "status": "candidate | picked | archived",
  "score": 0
}
```

### 4.2 `content_assets`（母素材库）
```json
{
  "_id": "string",
  "type": "video | photo",
  "title": "string",
  "desc": "母素材客观描述（供改写Agent用）",
  "fileRefs": ["cloudPath 或 CDN url"],
  "specimenRef": "关联藏品档案库 id（可空）",
  "shootDate": "date",
  "ipTags": ["GRAVITY"],
  "reusableClips": 0
}
```

### 4.3 `content_pieces`（成品工单 · 承载看板状态）
```json
{
  "_id": "string",
  "topicId": "ref content_topics",
  "assetId": "ref content_assets（可空）",
  "ip": "GRAVITY | LIGHTNESS",
  "platform": "xhs | douyin | shipinhao | bilibili",
  "title": "string",
  "body": "正文/脚本",
  "tags": ["#..."],
  "coverCopy": "封面文案",
  "clipSuggestions": ["切片建议"],
  "compliance": { "passed": false, "violations": [], "checkedBy": "agent|human", "checkedAt": null },
  "state": "topic | drafting | review | approved | scheduled | published | archived",
  "publishMeta": { "publishedAt": null, "externalUrl": "" },
  "metrics": { "views": 0, "完播率": 0, "收藏": 0, "评论具体句": 0, "引流私域": 0 },
  "agentMeta": { "model": "", "provider": "", "tokens": 0 }
}
```

### 4.4 `content_reviews`（终审日志 · 闸口审计）
```json
{
  "_id": "string",
  "pieceId": "ref content_pieces",
  "reviewer": "human openid",
  "decision": "approve | reject | rewrite",
  "constitutionCheck": { "passed": true, "notes": "" },
  "comment": "string",
  "reviewedAt": "date"
}
```

### 4.5 `content_analytics`（复盘 · 飞轮）
```json
{
  "_id": "string",
  "period": "2026-W27",
  "inputMetricsSummary": {},
  "insights": ["..."],
  "nextTopics": ["回填到 content_topics 的候选"],
  "stopList": ["建议停掉的选题/脚本类型"],
  "generatedBy": "复盘Agent"
}
```

**权限（`cloudbase/rules`）**：内容集合仅管理端可写；`metrics` 回填可由发布登记动作或后续云函数更新。

---

## 5. 四个 Agent 规格

统一放 `composables/useContentAgents.js`，每个 Agent = 组装 prompt → `callGeminiAPI` → `extractJSON`。系统提示常量放 `config/contentConstitution.js`。

### 5.1 话术宪法 Agent（★命门 · 内容语言守门人）

- **职责**：起草或校验文案，强制「标本不做主语」等规则；分 IP 调性。
- **provider/temperature**：`bailian` + `usePro:true` + `temperature:0.4`
- **输入**：`{ mode: 'draft'|'check', rawIdea|draft, ip, platform, category }`
- **输出**：
```json
{ "passed": true, "violations": ["若不合规，列出违规句与原因"], "rewritten": "合规文案", "ip_tone_ok": true }
```
- **系统提示（放 `config/contentConstitution.js`，复用 `llmTalkingScript.js` 已有话术资产）**：
```
你是「山海造物」的内容语言守门人。任何文案/脚本必须遵守话术宪法：
1) 标本不能作主语，也不能配主动动词。主语只能是：光线/空气/季节/容器/看的人/时刻/产地/温度/湿度/寂静。
2) 取消所有权：少用「它的/它有」。
3) 让出动词：用被动或描述性语态，不用主动语态。
4) 分 IP 调性：GRAVITY(沉静·单句长·慢，禁「哇/绝了/太好看了」)；LIGHTNESS(明亮亲切，禁「宝宝们/家人们/卖萌」)。
5) 守《不做清单》：不带货香氛/服饰/美妆/盲盒/潮玩/数字藏品；不逼单、不虚构稀缺、不夸大。
自检：若出现「这只标本…展示/拥有/是新品」句式，判 passed=false 并 rewritten。
只输出 JSON：{passed, violations[], rewritten, ip_tone_ok}
```

### 5.2 选题 Agent

- **职责**：从品牌资产 + 平台热点 + 上周表现，产出选题候选。
- **provider/temperature**：默认 + `temperature:0.9`
- **输入**：`{ brandAssetsBrief, platformTrends, recentPerfSummary, ipBalanceNeeded }`
- **输出**：
```json
{ "topics": [ { "title","ip","platform","category","angle","hook","rationale","score" } ] }
```
- 写入 `content_topics`（status=candidate），人工在看板挑选置 picked。

### 5.3 改写分发 Agent

- **职责**：一条母素材 → 多平台成品，**逐条过话术宪法 Agent**。
- **provider/temperature**：默认 + `temperature:0.7`
- **输入**：`{ mother: {desc, transcript?}, ip, targetPlatforms: ['xhs','douyin','shipinhao'] }`
- **输出**：
```json
{ "pieces": [ { "platform","title","body","tags","coverCopy","clipSuggestions":[] } ] }
```
- 每条 piece 生成后调用 **5.1 话术宪法 Agent 的 check 模式**回填 `compliance`；不通过则标红进 review。

### 5.4 复盘 Agent（飞轮）

- **职责**：读周期指标，产出洞察 + 下一轮选题 + 停做清单，写 `content_analytics`，并把 nextTopics 回灌 `content_topics`。
- **复用**：`AIStrategicBrain.vue` / `DataReportAI.vue` 的数据装配范式。
- **输入**：`{ periodMetrics（来自 content_pieces.metrics 聚合 + BehaviorAnalytics） }`
- **输出**：
```json
{ "insights":[], "nextTopics":[], "stopList":[] }
```

---

## 6. 内容看板状态机

```
topic ──选题挑选──► drafting ──改写分发Agent──► review ──人工终审──► approved
                                                   │                    │
                                            (reject/rewrite)        发布登记
                                                   └───► drafting        ▼
                                                                    scheduled ──► published ──回填metrics──► (复盘) ──► archived
```

**闸口规则**：
- `review → approved` **必须**有一条 `content_reviews`（decision=approve），且 `compliance.passed=true`。**AI 不能自动越过此闸**。
- `approved → scheduled/published`：发布为**人工动作**，系统只登记 `externalUrl` 与时间。
- 任何 `state` 变更写 `content_pieces` 内嵌 history 或 `content_reviews`。

---

## 7. 前端组件结构

```
components/
  ContentFactory.vue          # 主工作台（id 50），el-tabs 容器
  content/
    ContentKanban.vue         # 看板：按 state 列，卡片=content_pieces
    TopicLibrary.vue          # 选题库：选题Agent触发 + 人工挑选
    AssetLibrary.vue          # 母素材库：上传/关联藏品，供改写Agent
    ContentReview.vue         # 复盘：复盘Agent + 指标图（复用 BehaviorAnalytics）
    ReviewDrawer.vue          # 终审抽屉：显示合规校验、通过/打回/重写
  TalkingScriptCard.vue       # 复用：话术宪法 Tab 内展示/试写
composables/
  useContentAgents.js         # 四个 Agent 封装（callGeminiAPI + extractJSON）
  useContentBoard.js          # 看板 CRUD + 状态流转（CloudBase）
config/
  contentConstitution.js      # 话术宪法/克制守则/不做清单 系统提示常量 + 双IP子提示 + 正反例
```

`useContentAgents.js` 骨架：
```js
import { callGeminiAPI, extractJSON } from '../utils/aiHelper'
import { CONSTITUTION_SYSTEM, IP_TONE } from '../config/contentConstitution'

export function useContentAgents() {
  async function constitutionCheck({ mode, text, ip, platform, category }) {
    const prompt = `${CONSTITUTION_SYSTEM}\n${IP_TONE[ip]}\n模式:${mode}\n平台:${platform} 品类:${category}\n内容:${text}`
    const res = await callGeminiAPI(prompt, { provider: 'bailian', usePro: true, temperature: 0.4 })
    return extractJSON(res)
  }
  async function suggestTopics(ctx) { /* temperature:0.9 */ }
  async function repurpose(mother, targets) { /* 0.7 + 逐条 constitutionCheck */ }
  async function retrospect(metrics) { /* 复用智脑范式 */ }
  return { constitutionCheck, suggestTopics, repurpose, retrospect }
}
```

---

## 8. 人工终审闸口设计

- 看板 `review` 列每张卡进 `ReviewDrawer`，展示：AI 合规校验结果（passed/violations）、原文与 rewritten 对比、IP 调性判定。
- 三个按钮：**通过（写 review=approve → approved）/ 打回重写（→ drafting）/ 直接改（人工编辑后 approve）**。
- 硬约束：`compliance.passed=false` 时「通过」按钮禁用，必须先重写。
- 审计：每次决策落 `content_reviews`，可追溯。

---

## 9. 边界与不做清单

| 不做 | 原因 | 替代 |
|---|---|---|
| 自动发帖到小红书/抖音 | 无开放第三方发布 API，违规风险 | 生成→终审→一键复制/导出→人工或创作者工具发布 |
| 自建视频剪辑/切片 | SaaS 已极致，自研纯浪费 | 剪映/CapCut，文件交接 |
| AI 自动越过终审 | 破品牌话术宪法 | 闸口强制人工 approve |
| 全 AI 生成标本画面 | 破「诚实地走过问题」信任 | 标本本体真实拍摄，AI 仅辅助氛围（须标注） |

---

## 10. Phase 1 构建顺序（约 1–2 周 · 超级个体节奏）

> 建议先做 **Phase 0（零代码手动跑通）** 再进 Phase 1；下面是 Phase 1 编码顺序。

1. `config/contentConstitution.js`：把话术宪法/克制守则/不做清单 + 双 IP 子提示 + 正反例写成常量。（半天）
2. CloudBase 建 5 张集合 + rules。（半天）
3. `composables/useContentAgents.js`：先实现 `constitutionCheck`（命门），本地验证「禁止写法→合规改写」。（1 天）
4. `composables/useContentBoard.js`：看板 CRUD + 状态机。（1 天）
5. `components/ContentFactory.vue` + `content/ContentKanban.vue` + `ReviewDrawer.vue`：跑通「建选题→草稿→终审闸口→approved」。（2 天）
6. 接 `suggestTopics` 与 `repurpose`（一条母素材→多平台，逐条过宪法）。（2 天）
7. `TopicLibrary/AssetLibrary/ContentReview` 补全 + 复用 `BehaviorAnalytics`；接 `retrospect` 飞轮回灌。（2 天）
8. 在 `modulesRegistry.js` / `sidebarNav.js` / `App.vue` 注册挂载。（半天）

---

## 11. 验收标准（Phase 1 Done 的定义）

- [ ] 侧栏出现「内容工厂」，五个 Tab 可用。
- [ ] 输入一条「禁止写法」，话术宪法 Agent 判 `passed=false` 并给出合规 `rewritten`。
- [ ] 一条母素材经改写分发 Agent 生成 ≥3 平台成品，每条带合规校验结果。
- [ ] 看板可完成 `topic→drafting→review→approved`，且 `compliance.passed=false` 无法通过闸口。
- [ ] 发布登记后 `metrics` 可回填；复盘 Agent 能产出 nextTopics 并回灌选题库。
- [ ] 全程仅调用 `callGeminiAPI`，无新增模型密钥硬编码（沿用 `VITE_*` 环境变量）。

---

## 12. 环境与密钥（已存在，勿新增明文）

沿用 `aiHelper.js` 读取的 Vite 环境变量：`VITE_BAILIAN_API_KEYS` / `VITE_GEMINI_API_KEYS` / `VITE_DEEPSEEK_API_KEYS` / `VITE_OPENAI_API_KEYS`、`VITE_BAILIAN_MODEL(_PRO)`、`VITE_AI_DEFAULT_PROVIDER`；本地 Ollama 作兜底。内容工厂不引入任何新密钥体系。

---

*本蓝图与《内容营销模块搭建方案》《AI 内容工厂工作流图谱》配套；落地以实际代码与 CloudBase 现状为准，`id 51`（当前最大 id=50 的下一个空号）等取值以最终代码为准。*
