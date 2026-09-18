# wish_ritual_profiles · 祈福墙仪式档案（连续点灯 + 木鱼功德）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序 C 端云函数 `wishRitualProfile`：
  - `get` —— 取当前用户（openid 归属）的仪式档案；
  - `sync` —— 合并写入 `{ streak, lastLitDayKey, muyuCount }`（幂等）。
- 客户端封装 `miniprogram/utils/ritualProfile.js`（`loadFromCloud` / `syncToCloud`，失败静默降级）。
- 解决的真实缺陷：连续点灯与木鱼功德此前**只存本地**（`utils/wishRitual.js` 的
  `wx.setStorageSync`），换手机 / 清缓存即丢。
- 纯函数核（合并语义 + 取值校验）在 `miniprogram/utils/ritualProfileCore.js`
  与 `miniprogram/cloudfunctions/wishRitualProfile/ritualProfileCore.js` **逐字节同源**。

## 权限：本人可读、客户端不可写

```json
{ "read": "auth != null && doc._openid == auth.openid", "write": false }
```

- **读**：按 `_openid` 隔离，用户只能读自己的那一份（照 `user_coupons.json` 的形态）。
- **写 `false`**：所有写入经云函数 `wishRitualProfile.sync`。这是**刻意收紧**，
  不是遗漏 —— 若放开客户端直写，任何人可以绕过服务端的取值校验与跳变闸，
  直接写 `streak: 30 / muyuCount: 1000000`，校验就只是摆设。
  「用户只能写自己的」这条仍然成立：云函数**只以调用方 `cloud.getWXContext().OPENID` 为归属**，
  不接受任何来自 `event` 的 openid，用户永远只能改到自己的那一行。
- 因为写入全部经云函数，客户端其实也不需要直读；`read` 保留为"本人可读"是**纵深防御**
  （即使将来有页面直读，也不会串号）。

## 控制台步骤

1. 新建集合 `wish_ritual_profiles`
2. 权限 → [`../rules/wish_ritual_profiles.json`](../rules/wish_ritual_profiles.json)（本人可读 / `write: false`）
3. 建议索引：`_openid`（唯一查询键）。可按需加 `_openid + updateTime(desc)`。
   > 索引缺失不会导致功能不可用：本集合只按 `_openid` 单键查询，没有排序/范围查询。
4. 部署云函数 `wishRitualProfile`（登记见 `miniprogram/cloudbaserc.json`）。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 归属（`cloud.getWXContext().OPENID`，服务端写入，不接受客户端入参） |
| `openid` | string | 同上，冗余一份便于导出与排查 |
| `streak` | number | 连续点灯天数；0 = 从未点灯。取值 0..30（上界见下） |
| `lastLitDayKey` | string | 最近一次点灯日，`YYYY-MM-DD`（Asia/Shanghai 自然日）；`''` = 从未点灯 |
| `muyuCount` | number | 木鱼功德累计；只增不减。取值 0..1000000 |
| `version` | number | 存档结构版本，当前 `1` |
| `createTime` | date | serverDate |
| `updateTime` | date | serverDate；**只在三字段真的变化时推进**（幂等：无变化不写库） |

## 文档示例

```json
{
  "_id": "r1aBcD2EfG",
  "_openid": "oXXXX-xxxxxxxxxxxxxxxxx",
  "openid": "oXXXX-xxxxxxxxxxxxxxxxx",
  "streak": 7,
  "lastLitDayKey": "2026-09-20",
  "muyuCount": 512,
  "version": 1,
  "createTime": "2026-09-20T13:04:11.000Z",
  "updateTime": "2026-09-20T22:31:07.000Z"
}
```

## 合并语义（本地权威 + 只前进）

`sync` 把客户端推来的档案与已存档**逐字段**合并：

| 字段 | 取法 | 理由 |
|------|------|------|
| `streak` | **较大值** `max` | 本地是权威且只增不减；取 max 保证任何一次同步都不会把用户已有的连续天数改小（换手机后第一次同步尤其关键） |
| `muyuCount` | **较大值** `max` | 同上，功德是只增不减的计数器 |
| `lastLitDayKey` | **更晚的一天** | 跨设备时以「最近一次点灯」为准；空串只在两端都空时保留 |

- 逐字段取优而不是「整份取新」：两端可能各有一半更新的数据（A 机连续天数高、B 机最近点过灯），
  逐字段取优不丢任何一边。
- `max` / 取更晚日都满足**幂等 + 交换律**：同一份输入重复 `sync`，落库结果一致，
  第二次起返回 `changed: false` 且**不再写库**（不会累加、不会来回抖动）。
- 合并后若与已存档完全相同 → 直接返回，不动 `updateTime`。
- 已知取舍：`streak` 与 `lastLitDayKey` 独立取 max，极端情况下会把「较高的历史连续天数」
  挂到「较晚的日期锚点」上。对仪式感计数无危害（客户端回填的是两端并集的连续段）；
  反过来改成「信较晚锚点那一端的 streak」才会真的丢掉本地权威的大值。

## 服务端校验（拒绝"不可能"的取值）

| 字段 | 规则 | 上界从哪来 |
|------|------|-----------|
| `streak` | 整数 `0..30` | = 本地存档窗口 `wishRitual.KEEP_DAYS`。`streak` 由本地 `days` 映射推导，而每次写入都会 `pruneDays` 只留最近 30 个日期键 → **良构客户端不可能报出 >30**（单测断言 `STREAK_MAX === KEEP_DAYS`，防两处漂移） |
| `muyuCount` | 整数 `0..1000000`；另拦**单次跳变过大** | 绝对上界：100 万次 ≈ 以 10 次/秒连续点 27.8 小时，无真实用户可达。跳变上界 = `距上次改动秒数 × 10 次/秒 + 50`；10 次/秒 ≈ 客户端 420ms 反馈动画节奏（约 2.4 次/秒）的 4 倍余量 |
| `lastLitDayKey` | `''` 或合法 `YYYY-MM-DD`，**不得为未来日**（Asia/Shanghai），不得早于 `2026-01-01` | 未来日必为脏值/时钟错乱；本仪式 2026-09 上线，早于 2026-01-01 的"点灯日"没有来源 |

- 日期键做**严格解析 + UTC 回环**，`2026-02-30` / `2026-13-01` / `2026-1-1` 一律拒绝。
- 类型严格（拒绝数字字符串 `'7'`）：入参来自我们自己的客户端，出现字符串只可能是调用方写错或被手搓。
- 任一字段不合格 → **整份拒绝**（返回 `code` / `field` / `msg`），不落任何字段，避免写出「半份档案」。
- 跳变闸命中时**不推进 `updateTime`** → 下一轮时间窗更长，同一个值会被正常接受（暂缓而非丢弃）。

### 为什么不加注册校验

微信云函数拿得到 openid；本函数**照常按 openid 存**，刻意不加注册门：
① "注册后才存"是客户端的钩子（由客户端决定调不调）；
② 在此加门等于把「客户端选择」变成「服务端硬拦」，会让换手机后的未注册用户历史档案无处安放；
③ 本档案不产生任何可兑换价值，没有必须 fail-closed 的风险面。

## 降级路径

- 客户端 `loadFromCloud` / `syncToCloud` **永不抛异常**：网络失败、云函数未部署、
  `wx.cloud` 不可用 → 返回 `{ ok:false, degraded:true, profile:<本地档案> }`，
  本地点灯 / 木鱼 / 连续天数展示**完全照常**。
- 服务端读取失败（如集合未创建）返回 `COLLECTION_MISSING` 并附可操作提示；
  写入失败返回 `WRITE_FAILED` —— 客户端均按降级处理，不阻断仪式。
