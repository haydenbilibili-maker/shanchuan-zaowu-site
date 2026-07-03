# 内容工厂 · Cursor 开发提示词（可直接粘贴）

> 配套《内容工厂_Phase1_技术蓝图.md》。目标：用 Cursor Agent/Composer 分里程碑搭出骨架，快速迭代到半自动化流水线。
> 用法：① 先把下面「项目规则」存成 `.cursorrules`（或 `.cursor/rules/content-factory.mdc`）；② 用 Agent 模式，**一次只发一个里程碑**，跑完 review diff 再发下一个；③ 每个提示里的 `@文件` 用 Cursor 的 @ 引用真实带上下文。

---

## 一、先放项目规则（存为 `.cursorrules`）

```
# 山海造物 内容工厂 · 开发规则

## 技术栈与风格
- Vue 3 `<script setup>` + Element Plus + Vite。所有新组件必须用 `<script setup>`，禁止 Options API。
- 严格模仿 `admin/src/components/ai/*.vue`（如 ContentAI.vue、DataReportAI.vue）的写法、命名、Element Plus 用法。
- 中文注释与 UI 文案。

## 复用，不要重写
- 模型调用只用 `import { callGeminiAPI, extractJSON } from '@/utils/aiHelper'`（或相对路径），禁止另写请求逻辑、禁止新增 API 密钥（沿用 VITE_* 环境变量）。
- 数据库走 `@/utils/cloudbaseCdnDb.js` 的现有方式，集合名前缀 `content_`。
- 话术复用 `utils/llmTalkingScript.js` 与 `components/TalkingScriptCard.vue`。

## 硬约束（不可违反）
- 话术宪法：文案中「标本不能作主语、不能配主动动词」，主语只能是光/空气/季节/容器/看的人/时刻/产地/寂静。
- 人工终审是硬闸口：`content_pieces.state` 从 `review → approved` 必须有人工 approve 且 `compliance.passed=true`；`compliance.passed=false` 时「通过」按钮 disabled。AI 不得自动越过终审。
- 不做：不自动发帖到小红书/抖音（无合规 API）；不自建视频剪辑；标本画面不用 AI 生成。

## 工程纪律
- 只改/建本任务涉及的文件，不重构无关代码。
- 新模块 id 用 '51'（当前最大 id=50）。分组 CUSTOMER / 二级「内容营销」。
- 每个里程碑结束给出：改动文件清单 + 如何自测。
```

---

## 二、里程碑提示词（按顺序发）

### M1 · 话术宪法配置（命门，先做）
```
参考 @admin/docs/内容工厂_Phase1_技术蓝图.md 第 5.1 节。
新建 admin/src/config/contentConstitution.js，导出：
- CONSTITUTION_SYSTEM：话术宪法系统提示（标本不做主语/取消所有权/让出动词/不做清单/自检规则，只输出JSON {passed, violations[], rewritten, ip_tone_ok}）。
- IP_TONE：{ GRAVITY, LIGHTNESS } 两套子提示（沉静·单句长·慢，禁「哇/绝了」；明亮亲切，禁「宝宝们/家人们」）。
- EXAMPLES：至少 6 组「禁止写法 → 合规改写」正反例数组，覆盖标本/首饰/器物。
纯常量文件，不引依赖。给出自测：console 打印三者结构。
```

### M2 · CloudBase 集合
```
参考技术蓝图第 4 节，在 CloudBase 建 5 张集合并补 rules：
content_topics / content_assets / content_pieces / content_reviews / content_analytics（字段照蓝图 schema）。
在 admin/src/utils/ 下新建 contentDb.js，基于现有 @/utils/cloudbaseCdnDb.js 的方式，导出对这 5 张集合的 CRUD 封装（list/get/add/update/remove，按 openid 与时间戳规范）。
不要改动 cloudbaseCdnDb.js 本身。给出自测：对 content_topics 做一次 add+list。
```

### M3 · 话术宪法 Agent（先跑通命门）
```
参考技术蓝图第 5 节，新建 admin/src/composables/useContentAgents.js，先只实现 constitutionCheck：
- 入参 { mode:'draft'|'check', text, ip, platform, category }
- 用 CONSTITUTION_SYSTEM + IP_TONE[ip] 组 prompt，调 callGeminiAPI(prompt,{provider:'bailian',usePro:true,temperature:0.4})，再 extractJSON 返回 {passed,violations,rewritten,ip_tone_ok}。
- 做好 extractJSON 失败的兜底（返回 passed:false + 原因）。
新建一个临时测试页或在 ContentAI.vue 里加个按钮，输入「这只北美君主蝶展翅10cm，今年新品，快抢」应返回 passed:false 且给出合规 rewritten。
```

### M4 · 看板状态机 composable
```
参考技术蓝图第 6 节，新建 admin/src/composables/useContentBoard.js，基于 contentDb.js：
- 提供按 state 拉取看板（topic/drafting/review/approved/scheduled/published/archived）
- 状态流转函数，内置闸口：review→approved 必须传入 reviewer 且 piece.compliance.passed===true，否则抛错并提示；每次流转写 content_reviews。
给出自测：模拟一条 piece 从 drafting→review，未通过合规时 approved 被拒绝。
```

### M5 · 主工作台 + 看板 + 终审闸口 UI
```
参考技术蓝图第 3、7、8 节。新建：
- admin/src/components/ContentFactory.vue（el-tabs：看板/选题库/母素材库/复盘/话术宪法；话术宪法 tab 内嵌 @/components/TalkingScriptCard.vue）
- admin/src/components/content/ContentKanban.vue（按 state 分列，卡片=content_pieces，用 useContentBoard）
- admin/src/components/content/ReviewDrawer.vue（展示 AI 合规校验、原文 vs rewritten 对比、IP 调性；按钮：通过/打回重写/直接改。compliance.passed=false 时「通过」disabled）
风格严格对齐 components/ai/*.vue。跑通「新建选题→草稿→进 review→终审 approved」。
```

### M6 · 选题 Agent + 改写分发 Agent
```
在 useContentAgents.js 补：
- suggestTopics(ctx)：temperature:0.9，产出 {topics:[{title,ip,platform,category,angle,hook,rationale,score}]}，写入 content_topics(status:candidate)。
- repurpose(mother, targetPlatforms)：temperature:0.7，一条母素材→多平台 {pieces:[{platform,title,body,tags,coverCopy,clipSuggestions}]}；每条生成后调用 constitutionCheck 回填 compliance，不通过标红进 review。
新建 content/TopicLibrary.vue（触发 suggestTopics + 人工挑选置 picked）与 content/AssetLibrary.vue（母素材上传/关联藏品档案库，触发 repurpose）。
```

### M7 · 复盘飞轮
```
新建 content/ContentReview.vue：聚合 content_pieces.metrics + 复用 @/components/BehaviorAnalytics.vue 的图表范式；
在 useContentAgents.js 补 retrospect(metrics)：输出 {insights,nextTopics,stopList}，写 content_analytics，并把 nextTopics 回灌 content_topics(source:flywheel)。参考 @/components/AIStrategicBrain.vue 的数据装配。
```

### M8 · 注册挂载
```
参考技术蓝图第 3.2 节，把内容工厂注册进系统：
- @/utils/modulesRegistry.js 的 MODULES 新增 { id:'51', name:'内容工厂', group:'CUSTOMER', subgroup:'内容营销', icon:'VideoCamera', keywords:'content factory nrgc 内容 营销 选题 话术' }
- @/config/sidebarNav.js 的 customer 组新增 { title:'内容营销', items:[{id:'51',icon:'VideoCamera',label:'内容工厂'}] }
- App.vue 在 currentTab==='51' 分支渲染 <ContentFactory/>，沿用现有挂载与 useTabsManager。
验收：侧栏出现「内容工厂」，五个 tab 可用，闸口生效。
```

---

## 三、迭代到半自动化（Phase 2 提示，M8 稳定后再发）

```
在不违反 .cursorrules 硬约束的前提下，做半自动化：
1) 批量改写：AssetLibrary 支持选中一条母素材一键生成全平台成品并批量入库（复用 batchCallGeminiAPI）。
2) 定时复盘：把 retrospect 做成 CloudBase 云函数按周触发，产出写 content_analytics 并回灌选题。
3) 发布登记 + 指标回填：approved→发布为人工动作，只登记 externalUrl 与时间；提供手动/半自动回填 metrics 的表单。
4) 私域一线：把 content_pieces 引流承接接到 @/components/CompanionRobot.vue（马上有）与 CommentsModeration.vue，首轮自动、深聊转人工。
仍然：不自动发帖、不自建剪辑、AI 不越终审。
```

---

## 四、驱动 Cursor 的几条心法
- 一次一个里程碑，跑完 **review diff** 再继续；发现跑偏立刻用「只改 X 文件，别动其它」纠偏。
- 命门先行：M1→M3 先把「话术宪法」跑通再铺 UI，避免在错误语言基座上堆代码。
- 每次让它先说「计划改哪些文件」，确认后再让它写。
- 保持终审闸口是硬的——若 Cursor 想让 AI 自动 approve，明确拒绝。

---

*配套：内容工厂_Phase1_技术蓝图.md · 内容营销模块搭建方案 · AI内容工厂工作流图谱*
