## 0. 归属

- **流 id**：`integration`（集成官 —— 跨流多写点单写者）
- **分支名**：`guard-registration`（**注意**：集成分支，不是 `feat/<流 id>`；归属守卫的分支范围判定只在 `feat/<流 id>` 上启用，本分支不适用）
- **本 PR 是否改动了别的流已声明的文件**？ **是** —— 这是**整合分支**，内容 = 六条流分支的整合态 + 合并期修复。逐条列明：

| 越界的文件 | 属哪条流 | 是否已取得 owner 同意 |
|---|---|---|
| `miniprogram/config/blessTags.js` 及 4 份副本 | `wish-wall` | ✅ 产品负责人当场拍板「补守卫 + 连数据一起修」 |
| `guards/20-wish-wall.txt`、`guards/40-order.txt`、`guards/80-cross.txt` | 各域单写者面 | ⚠️ **集成官代登记**，待各域 owner 追认（提交信息已逐条记明） |
| `docs/并发工作流注册表.json` 的 `order.guards` | `integration`（本流 owns） | — |
| `miniprogram/subpackages/manager/manager/**`（3 文件） | **注册表中无 owner** | ✅ 经产品负责人授权收口（该文件引入的红归 PR#6/wish-wall） |
| `admin/scripts/check-write-verify.mjs` | `integration`（本流 owns） | — |

> ```bash
> $ node scripts/check-workstream-ownership.mjs
> ✓ 归属守卫通过：9 条流、认领 1074 个文件、102 个页面冻结在基线、冻结违约 0 处告警
> ```

---

## 1. 验收卡

| # | 项 | 内容 |
|---|---|---|
| ① | **改了什么** | 把六条流分支（PR#3→#6→#2→#4→#5→#7）整合成一个可验收状态；修掉合并期暴露的门禁与守卫缺陷；补登记全部新增守卫。**184 文件 / +23189 −1026**（相对 `origin/main`；**本分支已追平 `origin/main`，落后 0**。提交数与哈希请自取：`git log --oneline origin/main..guard-registration`） |
| ② | **在哪看** | 无需 UI 入口。核心看三份文档：`docs/验收交付_整合分支_2026-09-19.md`（验收卡）、`docs/祈福墙_待产品负责人拍板_2026-09-19.md`、`docs/祈运标签_存量回填候选清单_2026-09-19.md`；代码看 `guards/`、`miniprogram/scripts/check-order-*.mjs` |
| ③ | **期望看到什么** | ① `check:admin` **88 条全绿**；② `guards/_meta.json` 的 `minGuards = 88`，`check:guards-coverage` 报「9 个域 / 88 条（基线 88）」；③ `check:dialog-ratchet` 从 `1961 > 1960` 变为 `1960 ≤ 1960` |
| ④ | **怎么证明** | 见下方「④ 的守卫结果」 |
| ⑤ | **真机/真图证据** | ❌ **没有**。本 PR 无视觉/canvas/原生组件类的真机证据 —— 唯一涉及的界面改动（祈运标签上限提示改用 `AppToast`）**只有静态接线 + helper 真源码执行级验证，未做真机目视**。见 §1 ⑥ 与验收卡 §5 |
| ⑥ | **已知不确定项** | 见下方清单 |

### ④ 的守卫结果

```
$ npm run check:admin
  ✓ 88 条 / ✗ 0 条 / 共 88 条        exit 0

$ npm run check:guards-coverage
  ✓ 守卫清单完整：9 个域 / 88 条（基线 88），无重复、脚本与自检齐全；最大域 cross 55 条

$ npm run check:workstream-ownership
  ✓ 归属守卫通过：9 条流、认领 1074 个文件、102 个页面冻结在基线、冻结违约 0 处告警

$ npm run check:astro
  ✓ 官网类型检查通过（astro check）

守卫链分布：meta 1 / visual 9 / wish-wall 4 / pay 6 / order 5 / onboarding 4 / av 1 / erp 3 / cross 55
```

**常态红名单：无。** 本 PR 把交接页 §1 点名的「全绿前最后一个已知红灯」也修掉了：

| 红的守卫 | 原因 | 是否本 PR 引入 |
|---|---|---|
| （无） | — | — |
| ~~`check:dialog-ratchet`~~ | 修复前 `managerPageConfig.js` 371→372、总量 1960→1961 | 否（归 PR#6）。**本 PR 已收口**：迁移到 `AppToast`，**未用 `--update`** |

> ⚠️ **一个必须知道的环境事实**：`check:sfc-dev` / `check:nav-sources` / `test:module-search` / `check:astro`
> 这 4 条要解析 `vite`/`astro`，**在仓库目录之外的检出里会假红**（Node 模块解析走不出仓库根）。
> 必须在**仓内**检出、且 `npm ci --include=dev` 之后跑。本 PR 已在仓内检出实测这 4 条**全 exit 0**。

### ⑥ 已知不确定项

1. **无真机证据**：祈夆墙小程序真机（吸底条与键盘、弹层手感、安全区）、以及**迁移后的 `AppToast` 是否真的弹出**，均未验（本环境无微信开发者工具）。
2. **无线上库证据**：`orders` 规则是否 `write:false`、历史数据里 5 个幽灵状态各几条、存量商品 `blessTags` 真实覆盖率 —— 均**没有查库**（无凭据）。
3. **契约 C3 与源码的偏差**：契约写「16 个在用」，实测**14**（表 A 16 行 = 12 在用 + 4 幽灵，补上契约自认遗漏的 `exchanged`/`unverified`）。已记入 `orderStatusAllowed.json` 的 `_reconciliation`，**未静默改契约**。
4. **`report:type:strict` 未入链**（交接页 §3-⑥ 原计划入链）。实测其判据有缺陷：棘轮按**「种类数」而非「处数」**（+8 处 `23rpx` 反而更绿）、3–9 次中间带 **14 种 / 61 处**完全不可见、把 `.h-title 88rpx` 等正常文字当问题。**入链会得到假绿，故已裁决不入链**（依据见交接页 §11-⑦）。
5. **`preview:wall` 未登记 npm/守卫链**，且本环境无 Chrome。
6. **`verify:site-dist` 从 `check:admin` 链内摘除**（`guards/80-cross.txt`），`minGuards` 87→86。这是**范畴修正不是删守卫**：它已在本就存在的 `npm run build` 链尾真跑；同类的 `verify-admin-dist` 从来只在 build 链。理由已写进 `guards/_meta.json` 的 `_minGuardsNote`。

---

## 2. 契约面

- [ ] C1 身份与注册口径（owner: onboarding）
- [ ] C2 钱账本 / 幂等语义（owner: pay）
- [x] **C3 订单状态机（owner: order）** —— 新增两条守卫 + 事实源 `orderStatusAllowed.json`；**契约本文未改**，偏差记入该文件的 `_reconciliation`
- [x] **C4 埋点事件（owner: integration）** —— `wish_wall_register_gate` / `wish_wall_sound` / `wish_wall_play` / `wish_wall_reco` 双端登记（`check:analytics-schema` 135/135 ✓）
- [ ] C5 功能开关 `content_display_flags`
- [x] **C6 商品字段 / `ALLOWED_FIELDS`（owner: erp）** —— `blessTags` 接线（`manageProducts` 白名单 + 归一化 + 过滤查询）；`blessTags.js` 5 副本同步改 1 处
- [x] **C7 设计令牌 / 字阶 / 弹窗（owner: visual）** —— 弹窗棘轮收口（迁 `AppToast`）；`report-type.mjs` 两条静默绕过修复（**阈值与口径未改**）
- [x] **C8 云函数签名 + 两侧白名单** —— 只碰 `manageProducts` 的 `ALLOWED_FIELDS` 写入口径，**签名未变**
- [ ] C9 数据集合（四处同步）

> ⚠️ 因本 PR 涉及 C3/C4/C6/C7/C8，按模板要求**需要对应 owner 一起看**。
> **钱路径（C2）一字未动** —— 这是刻意的：裁决 §2 红线「索引未证实存在前不得改动任何钱路径代码」。

---

## 3. 收工前自检

- [x] `lint:wxml` ✓ 154 文件 / `check:wxss-syntax` ✓ 172 文件（E3 成对结构配平）
- [x] 对应守卫**实跑**了，不是只看 diff（E5）
- [x] 守卫报错时区分过「源码错 vs 判据错」：`report:type` 与 `bless-tags` 两处都**补判据**而非放宽断言（E7）
- [ ] **视觉/版式类有真机或真图** —— ❌ **本 PR 没有**（E8）。`AppToast` 迁移只有静态接线证据，真机需一次目视
- [x] `check:admin` 跑过，且每条红都能说清（E9）—— 现为 **0 红**
- [x] `git status --porcelain` 干净（E12）

**新增判据的「它会红」证明**（本仓硬要求）：

| 判据 | 独立注入证据 |
|---|---|
| order 双向对账 | 把 `refundOrder` 唯一一处 `status:'refunded'` 改成 `'refund_rejected'` → `exit=1`，同时命中三条（幽灵被写入 / `in_use` 声称在用但零写入方 / 出现次数超基线）；还原后 `exit=0`、`git diff` 为空 |
| `blessTags.plays` 须命中玩法注册表 | `--selftest` 3 轮注入（副本漂移 / SSOT 非法 id / **ERP 副本非法 id**）全检出且逐字节还原；合法 id 集合**从 `ritualPlays.js` 现读**，守卫内零硬编码 |
| `verify:site-dist` 缺 dist | 缺 dist → `exit 2`；干净 → `0`；坏产物 → `1`；自检 14 项全过 |
| `check:write-verify:strict` | 移走基线文件 → 修复前 `exit 0`（静默通过）、修复后 `exit 2` |

---

## 4. 发布与同步（**AI 施工方不执行**）

- [ ] `npm run sync:miniprogram` —— 等验收通过后由产品负责人触发
- [ ] 改过的云函数需重新部署：`manageProducts`（`ALLOWED_FIELDS` 加 `blessTags`）、`getBlessProducts`（新增，需登记 `cloudbaserc.json`）
- [ ] 新增/变更集合同步线上安全规则：**本 PR 未新增集合**
- [ ] 更新 `docs/README.md` / `admin/docs/README.md` 索引：新增两份文档待登记（`祈福墙_待产品负责人拍板`、`祈运标签_存量回填候选清单`）—— 索引归集成官，**尚未登记**

---

## Reviewer 速查

| 想确认什么 | 一条命令 |
|---|---|
| 门禁真的全绿吗 | `npm run check:admin` |
| 守卫清单没被偷偷改少吗 | `npm run check:guards-coverage` |
| 新守卫真的会失败吗 | `npm run check:admin:selftest`（在**隔离 worktree** 里跑） |
| 有没有人越界改文件 | `npm run check:workstream-ownership` |
| 弹窗棘轮有没有用 `--update` 掩盖 | `git log -p -- miniprogram/subpackages/manager/manager/managerPageConfig.js` 与 `package.json` 的 `--update` 脚本 |

**合并后请关闭 PR #3–#7** —— 本分支是它们的整合态，但它们的 head **不是**本分支的祖先（内容在、对象未合并），不关会重复合并。

---

<!--
  说明（不会出现在 PR 正文里的部分请自行删掉本注释）：
  本文件是**开 PR 时直接整段复制**用的正文，严格照 `.github/pull_request_template.md`
  的六行验收卡与勾选节填写。存在仓里是为了不重写一遍验收摘要。
  开 PR 后本文件可留在仓里作为记录。
-->
