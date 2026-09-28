# 工作信息 · 日报 Phase 2（小程序验收摘要）

> 技术蓝图：`admin/docs/每日日报_Phase2_完成度升级_2026-09-24.md`
> 口径事实源仍以 Phase1 + `dailyDigest/reportCatalog.js` 为准。

## 落点

- 列表 / 分档：`subpackages/extra/user/messages/index.*`
- 详情：`…/messages/detail/index.*`
- 展示模型：`utils/digestView.js`（`buildDigestView` + `buildDigestListCard`）
- enrichment：`utils/messageHelper.js`（日报 kind/印章/落款/状态「快照」）

## 人眼验收

1. 员工：我的 → 工作台 → **工作信息** → 点分档 **日报**
2. 有数据：列表见关键数芯片 +「查看口径」；点开见分组指标、生成时点、失败告警与「未取到」区分
3. 空态：日报档说明「定时生成 / 可回看」；长期为空则核对云函数部署（非本仓 AI 部署）
4. 工作台**没有**独立日报瓦片（产品口径）

## 不是本模块

- 无「填写 / 提交」工作日报表单（那是另一产品，须产品点名）
- ERP 侧日报页未做
