# 会员等级人工调整（Admin）

## 入口

Admin → 小程序配置 → 会员/营销规则 → **会员等级调整**（模块 id `69`）

超管工作台（小程序）→ 「会员与触达」区 **会员调级**（2026-09-29 起与「荣誉馆长」合并为一枚磁贴；进入后页顶分段「调级 / 荣誉馆长」互切，两页路径不变，旧深链照常。守卫 `npm run check:member-curator-hub`）
路径：`/subpackages/extra/member-level-adjust/index`（仅 `super_admin`）

云函数：`manageMemberLevelAdjust`（Admin 须经 `/api/cloud-fn` 代理；小程序直调 callFunction）

## 定级规则（勿破坏自动升级）

小程序与下单折扣统一走 `resolveMemberLevel(levels, growthValue, isHonorary, levelOverride)`：

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | `users.isHonorary === true` | 始终 **Lv99 荣誉馆长** |
| 2 | `users.levelOverride.mode === 'exact'` | 锁定到指定付费档，**暂停**自动升级直至清除 |
| 3 | `users.levelOverride.mode === 'floor'`（默认） | `effectiveGrowth = max(自然成长, growthFloor)`，自然成长超过门槛后仍可自动升级 |
| 4 | 无覆盖 | 按自然成长值对照 `member_levels` 门槛 |

自然成长值 = 线上已付订单成长 + `users.storeGrowthValue`（与现网一致；可用积分口径不变）。

### `users.levelOverride` 字段

```js
{
  level: 3,              // 目标付费档 1–6（不含 99）
  mode: 'floor' | 'exact',
  growthFloor: 3000,     // 一般为该档 threshold
  note: '',
  setAt: 1710000000000,
  setBy: 'openid|admin_web',
  setByName: '操作人'
}
```

Admin UI 默认使用 **floor**；仅当自然档已高于目标、需要强制下调时使用 **exact**（页面有说明）。

## 与荣誉馆长关系

- **本页不授予 Lv99**；荣誉身份仍走「荣誉馆长名单」`manageHonoraryCurators`。
- 将会员从荣誉馆长调到付费档时：清除 `isHonorary`，并将 `honorary_curators` 中该手机号标为 `removed`（与移出馆长一致）。
- 荣誉馆长判定始终优先于 `levelOverride`。

## 授权与审计

- 调整 / 清除覆盖均需授权密码：优先 `MEMBER_LEVEL_ADJUST_PASSWORD`（或 `_HASH`），未配置则复用 `HONORARY_CURATOR_PASSWORD`。
- 审计集合：`member_level_adjust_ops`（谁、何时、从哪调到哪、mode、是否曾清荣誉馆长）。

## 相关云函数（定级消费侧需感知 override）

已同步传入 `levelOverride`：

- `getUserSession` / `getUserStats` / `getMemberPass`
- `makeOrder`（计价折扣；`exact` 时不做本单预估升档）
- `manageMemberCrm`

## 验证建议

1. 选成长值较低的测试账号，Admin 调至 Lv3（floor），小程序「我的」与下单折扣应为对应档。
2. 再调至其它档 / 清除覆盖，确认回落或变更。
3. 荣誉馆长账号调至非荣誉档后，小程序不再显示荣誉馆长，名单状态为已移出。
