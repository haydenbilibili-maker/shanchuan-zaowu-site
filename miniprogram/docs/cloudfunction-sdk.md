# 云函数 wx-server-sdk 版本

> 对应审计 **P1-5**。目标统一为 **`~3.0.1`**（CloudBase 云端 `npm install`）。

## 现状（2026-09-14）

历史上并存 `~2.6.3` 与 `~3.0.1`。**本轮已将各 `cloudfunctions/*/package.json` 依赖声明统一为 `~3.0.1`**（未因仅改依赖而全量部署）。

**注意**：仓库内通常不提交 `node_modules`；真正生效版本以**下次部署**时云端安装结果为准。未重新部署的函数仍可能跑旧层。

## 部署建议

- 改业务逻辑时顺带部署，即可带上新 SDK。  
- 不必为「只改 package.json」一次性部署全部函数。  
- 支付 / 鉴权关键路径（`payCallback`、`manageStaff`、`syncFinanceData`、`manageStoreContent` 等）若长期未部署，可择机单独上传。

## 核对

```bash
rg '"wx-server-sdk"' cloudfunctions/*/package.json | rg -v '~3\.0\.1' || echo 'all ~3.0.1'
```
