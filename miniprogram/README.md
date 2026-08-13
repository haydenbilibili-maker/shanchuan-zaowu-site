# 山海造物 · 微信小程序

消费者端 + 店长后台 + 云函数。与 Web ERP（`../admin/`）共享同一 CloudBase 环境。

## 打开方式

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. **导入项目** → 选择本目录 `miniprogram/`（不是仓库根目录）
3. AppID：`wxf2550373b010b447`（见 `project.config.json`）

## 目录

| 路径 | 说明 |
|------|------|
| `pages/` | 主包页面 |
| `subpackages/` | 分包（预约、订单等） |
| `cloudfunctions/` | 云函数（各目录独立 `package.json`） |
| `docs/` | PRD 与优化笔记（不上传包体） |

## 云函数依赖

复制时不含 `cloudfunctions/*/node_modules/`。首次部署某云函数前：

```bash
cd cloudfunctions/<函数名>
npm install
```

然后在开发者工具中「上传并部署：云端安装依赖」。

## 与 Web 数据同步

- 店长账本集合：**`store_ledger`**（见 `cloudbase/schema/store_ledger.md`）
- 工具：`utils/storeLedger.js`（店长页直接读写）、`utils/financeSync.js`（云函数双向同步）
- 云函数：**`syncFinanceData`** — 上传时镜像 `finance_records` 供 Web ERP 读取
- **门店订货（P0/P1）**：集合 `purchase_orders` / `fulfillment_shipments` / `stock_movements`；云函数 **`managePurchaseOrder`**（含发货扣库、收货）；店长「订货」页；Admin「订货履约」确认 / 出货 / 意向转单
- **飞书多维表对接**：云函数 **`syncFeishuBitable`**（环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`）；集合 `feishu_purchases` / `feishu_inventory` / `feishu_sync_logs`；Admin 订货履约 → 飞书对接 Tab

**部署**：修改云函数后，在微信开发者工具中右键 `cloudfunctions/syncFinanceData` → **上传并部署：云端安装依赖**（若报 FunctionName 已存在，说明应走「上传」而非「创建」）。

`config.json` 已设置 **`timeout: 60`**（秒）。若控制台仍报 `-504003` 超时，请确认已重新部署该云函数；未部署时客户端会降级为直接读 `finance_records` 合并。

店长打开 **账本** Tab 时会自动调用 `refresh_store_ledger`，合并本月 `finance_records` + `daily_revenues` + `store_ledger` 后展示（读路径不写库，避免超时）。

## 更多

Monorepo 总览：`../docs/monorepo.md`
