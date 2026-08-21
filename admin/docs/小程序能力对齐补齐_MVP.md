# 小程序能力对齐补齐（Admin MVP）

> 日期：2026-08-21  
> 对照：`miniprogram/` 养护 / 这有店 / 伴宠工艺 / 积分兑换 / 预约候补 / 联系专员

## 本轮交付

| Admin 入口 | 集合 | 能力 |
|------------|------|------|
| 小程序配置 → **养护指南** (`54`) | `care_guides` | 列表 / CRUD / 默认 6 类种子同步 |
| 业务运营 → **C端门店展区** (`55`) | `stores` · `store_zones` | 与 `getStoreConfig` 字段对齐（≠ ERP「店铺管理」合规档案，刻意双轨） |
| 伴宠记忆 → **工艺配置** Tab | `pet_craft_configs` | 供 `getPetMemorialConfig` |
| 权益与营销 → **积分兑换** | `rewards` | 对齐 `redeemReward` / 店长奖品 |
| 预约与核销 → **候补队列** Tab | `waitlist` | 通知 / 转预约 / 取消 |
| 小程序配置 → **客服入口配置** (`56`) | `support_configs` | 对齐 `getSupportConfig`；主题 / FAQ **可视化行编辑**（增删改排序 + 校验） |
| 藏品档案库 | `products.seckill` / `groupBuying` | 列表「营销活动」列 + 秒杀/拼团筛选（编辑表单原有字段） |
| 经营驾驶舱 | 同上（商品侧） | 待办区「秒杀商品 / 拼团商品」KPI，点击跳转藏品库并自动筛选 |

## CloudBase 建集合（自动化）

密钥写入 `admin/.env`（`TCB_SECRET_ID` / `TCB_SECRET_KEY`，见 `.env.example`，勿提交）：

```bash
cd admin && npm run provision:miniapp-ops
# 或统一入口（含内容工厂/订货/飞书等）
cd admin && npm run provision:all
# 仅预览任务列表
cd admin && npm run provision:all:dry
```

脚本会幂等创建集合并部署 `cloudbase/rules/<name>.json`。字段说明见 `cloudbase/schema/*.md`。

## 双轨说明（店铺）

| 入口 | 数据 | 用途 |
|------|------|------|
| 业务运营 → 店铺管理 | ERP 本地/合规档案 | 加盟、证照、物业等运营合规 |
| 业务运营 → C端门店展区 | 云库 `stores` / `store_zones` | 小程序「这有店」展示 |

**不做双向同步**（需产品决策后再打通）。

## 未纳入 / 待产品决策

- ERP「店铺管理」与云库 `stores` 双向同步
- 拼团实例运营台（仓库无 `group_buying` 集合/规则/云函数主读；仅 PRD 提及）
- 秒杀订单专页（订单文档无 `seckill`/`activityType` 等字段可筛；当前以**商品侧 KPI + 档案筛选**替代）
- `pet_mounting_configs` / `pet_memorial_bundles`（PRD 规划，云函数尚未主读）
