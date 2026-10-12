# wish_wall_echoes · 心愿签「我也想要」记录（2026-10-13）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序 C 端「马上有 · 心愿签」签详情的「我也想要」：`manageWishWall`（`echo`）
- 蓝图：`miniprogram/docs/马上有心愿签_重设计蓝图_2026-10-13.md`

## 为什么 `read: false` / `write: false`

记录的是「谁对哪张签点了也想要」，含 openid。`wish_wall_messages` 是 `read: true`，
所以**不**把点过的人写进签文档，单独成表、客户端完全不可读写，只经云函数。
签文档上只累加一个 `echoCount`（公开列表只回计数）。

## 控制台步骤

1. 新建集合 `wish_wall_echoes`
2. 权限 → [`../rules/wish_wall_echoes.json`](../rules/wish_wall_echoes.json)（`read: false` / `write: false`）
3. 无需额外索引（按 `_id` 主键写入判重）

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | `签 _id + "_" + sha1(openid) 前 16 位`：同一人对同一张签只能写一条（主键冲突 = 已点过） |
| `msgId` | string | 心愿签 `wish_wall_messages._id` |
| `_openid` | string | 点的人 |
| `createTime` | Date | 服务端时间 |

## 关联字段

`wish_wall_messages.echoCount`（number，缺省视为 0）：首次写入本表成功后由云函数 `_.inc(1)`。
