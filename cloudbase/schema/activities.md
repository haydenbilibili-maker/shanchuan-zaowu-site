# activities

> 最小结构说明 stub（审计 P2 / 2026-09-14）。字段以小程序与云函数代码实证为准，可后续加厚。

## 用途

运营活动配置（Banner 活动位等）

## 权限

见小程序仓 `database-rules/activities.json` 与 Admin `cloudbase/rules/activities.json`（若已同步）。写操作优先经云函数 + staffGuard。

## 字段（待补全）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 文档 ID |
| `_openid` | string | 创建者 openid（若适用） |
| `updatedAt` / `_updateTime` | number/date | 更新时间（各集合命名可能不同） |
| `title` / `type` | string | 标题；`course`（或 `handcraft_course`）= 手作课程，`special_activity` = 特别活动 |
| `date` / `time` | string | `YYYY-MM-DD`（北京时间）/ `HH:mm` 或 `HH:mm - HH:mm`。C 端（首页 / 预约页 / 门店页 / 搜索）按 `date >= 今天` 查询并隐藏当天已过结束时间（无结束取开始）的活动 |
| `status` | string | `open`（C 端可见可报）/ `closed` / `full` |
| `maxPeople` | number | 名额；0 = 不限 |
| `remain` | number | 余位。**2026-09-28 起由 `createBooking` 条件原子扣减**（`where remain >= 人数` + `inc(-人数)`），`cancelBooking` 归还；工作台编辑名额时按差值平移 |
| `storeId` / `location` / `price` / `image` | string/number | 门店（预约页/门店页按它过滤）、地点、价格、封面 |

## 维护

新增字段时同步：规则文件 ↔ 本 schema ↔ 相关云函数注释。
