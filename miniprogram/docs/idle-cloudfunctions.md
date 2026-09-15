# 闲置 / 低引用云函数清单

> 对应审计 **P1-3**。本文件只做标注，**不删除目录**。  
> 拼团 / 秒杀与品牌红线冲突，删除前必须产品确认。  
> 核对日期：2026-09-14 · 环境 `cloud1-8gnkty5bfff9f0bf`

## 分类说明

| 类别 | 含义 |
|------|------|
| **闲置待确认** | 客户端无 `callFunction` 引用；是否定时器/历史后台仍用未知 |
| **回调 / 服务端** | 非小程序页面直接调用，但是支付或内部链路需要 |
| **店长仍用** | 管理端仍有入口，勿标废弃 |

---

## 闲置待确认（勿删）

| 云函数 | 说明 | 建议 |
|--------|------|------|
| `createGroupBuying` | 拼团创建；与品牌红线冲突 | 产品确认后控制台停用或删除 |
| `joinGroupBuying` | 拼团加入 | 同上 |
| `seckillOrder` | 秒杀下单 | 同上 |
| `transferCoupon` | 转赠优惠券；无客户端调用 | 确认无运营依赖后再处理 |
| `toggleWant` | 想要/想买开关 | 确认无旧版入口 |
| `updateCollectionFolder` | 收藏夹更新；客户端无 callFunction，现用 `createCollectionFolder` / `moveCollectionItems` | 确认无旧客户端后再处理 |
| `getCollections` | 收藏列表；现多用客户端直读 / 其它函数 | 确认无旧客户端 |
| `getArchiveData` | 归档数据 | 确认无运营脚本 |
| ~~`syncFeishuBitable`~~ | 原仅有空 `config.json`、无 `index.js` | **2026-09-15 已移除空目录**；飞书同步走 ERP `feishuSync.js` + 各 manage* upsert |
| ~~`seedCategories-full`~~ | 原仅有空 `config.json`、无实现 | **2026-09-15 已移除空目录**；分类种子用 `seedCategories` |

---

## 回调 / 服务端（保留）

| 云函数 | 说明 |
|--------|------|
| `payCallback` | 微信支付结果通知；**非 C 端 callFunction**，不可当闲置删除 |
| `sendInAppMessage` | 被其它云函数（鉴定、预约提醒等）调用 |

---

## 店长 / 运维仍用（保留）

| 云函数 | 说明 |
|--------|------|
| `seedCommunityContent` | 店长后台社区种子 / 清理仍调用 |

---

## 核对方法

```bash
# 在仓库根目录：排除自身目录后搜名字
rg -l --glob '!**/node_modules/**' --glob '!cloudfunctions/<name>/**' '<name>' -g '*.js' -g '*.json'
```

有新增引用时，把该行从「闲置待确认」移出并更新日期。
