# waitlist · 预约候补队列

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序：满员时 `addToWaitlist`
- Admin：「预约与核销 → 候补队列」运营处理（通知 / 转预约 / 取消）

## 控制台步骤

1. 新建集合 `waitlist`（若尚未创建）
2. 权限 → [`../rules/waitlist.json`](../rules/waitlist.json)

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 用户 |
| `date` / `time` | string | 目标日期时段 |
| `name` / `phone` | string | 联系人 |
| `position` | number | 排位 |
| `status` | string | `waiting` \| `notified` \| `converted` \| `cancelled` |
| `createTime` | date/number | 加入时间 |
| `notifiedAt` / `convertedAt` / `cancelTime` | number? | 运营节点 |
