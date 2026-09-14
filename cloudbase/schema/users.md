# users · 用户档案

> 加厚于审计跟进 2026-09-14。写权限：客户端 `write: false`，经 `upsertUserProfile` / `authPhone` / `getUserSession` 等。

## 用途

会员档案、等级与成长值、手机号绑定等。

## 权限

见 `database-rules/users.json`（本人可读；写禁客户端）。

## 核心字段（代码实证）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 文档 ID |
| `_openid` | string | 微信 openid |
| `nickName` / `avatarUrl` | string | 资料 |
| `phone` | string | 手机号（脱敏展示） |
| `level` / `levelName` | number/string | 会员等级 |
| `points` / `growth` | number | 积分 / 成长值 |
| `birthday` | string | 生日（礼遇） |
| `wallet` / 储值相关 | object | 见 stored-value 文档 |
| `updatedAt` | date | 更新时间 |

## 维护

禁止客户端直写等级与积分；积分流水在 `point_records`。
