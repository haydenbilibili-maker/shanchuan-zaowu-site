# 云端夜班遗留的未提交改动（存证，**未验证，勿直接合并**）

来源：2026-09-22「云端夜班 → 本地接手」时，云服务器上两个 worktree 里**未提交**的改动。
它们的**已提交部分**（WIP 快照）已经在远端分支上：

| worktree | 分支 | 远端 WIP 提交 | patch |
|---|---|---|---|
| `/tmp/wt-mol` | `feat/mol-audit-ui` | `16c77d6`（"未完成验证，勿直接合并"） | `wt-mol-wip.patch`（4 文件 / 127 行） |
| `/tmp/wt-r2` | `feat/wall-feed-component` | `ef552f3`（同上） | `wt-r2-wip.patch`（1 文件 / 16 行） |

**为什么把它们捞出来**：云服务器可能会被关停/重建，而这 5 个文件的改动当时**没有提交**，
只存在于那台机的 `/tmp` 里 —— 关掉就没了。**存进仓库是为了不丢，不是为了合并。**

## 内容（据 patch 的改动面）

- `wt-mol-wip.patch`：`components/MemberLevelModal/index.wxml`、`components/UserVipCard/index.wxml`、
  `scripts/mp-contrast-baseline.json`、`subpackages/business/orders/index.wxss`
  —— 看形态是**对比度/可读性**那一批的中途改动（含基线数字）。
- `wt-r2-wip.patch`：`scripts/render-wall-feed-preview.mjs` —— 与夜班交接报告 §6 里
  「组件自带渲染台基线即红（7 条违反）」那条对应，像是修那个的**半成品**。

## 使用方式（要接手时）

```bash
git apply --check docs/salvage/wt-mol-wip.patch   # 先干跑，看能不能干净套用
git apply docs/salvage/wt-mol-wip.patch
```

⚠️ **两个 patch 都没有经过任何验证**（原作者自己标了"未完成验证，勿直接合并"）：
套用后必须跑对应守卫 + 真渲染，并**重新推导** `mp-contrast-baseline.json` 的数字，不要照抄。
