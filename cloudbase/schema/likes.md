# likes · 文章点赞

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序：社区文章点赞 → 云函数 `toggleCollection`
- 规则：`cloudbase/rules/likes.json` ↔ `miniprogram/database-rules/likes.json`（两份**逐字相同**）
- 登记：`admin/src/cloud.js` 的 `COLLECTIONS.LIKES`

## 权限

```json
{ "read": "doc._openid == auth.openid", "write": "doc._openid == auth.openid" }
```

**为什么是「仅自己可见」而不是公开读**：点赞的**计数不在本集合**，而在目标文档上
（`articles.stats.likes`，由 `toggleCollection` 用 `_.inc(±1)` 维护）。
客户端对本集合的唯一访问形态是「查我自己的那一条 / 删我自己的那一条」：

```js
db.collection('likes').where({ _openid: openid, targetType: 'article', targetId }).limit(1).get()
```

所以 owner-scoped 规则**正好覆盖全部访问形态**，同时不给「枚举谁点赞了」留口子。
所有写操作都经云函数（管理端权限），规则是第二道防线。

> ⚠️ 若将来要做「点赞列表」「谁赞过」，**不要放宽本规则** ——
> 那会暴露用户行为数据。应改为在云函数里出聚合结果（只回计数或脱敏列表）。

## 字段（以 `toggleCollection` 代码实证，非推测）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 点赞者 openid（规则与查询都依赖它） |
| `targetType` | string | 目标类型，当前为 `'article'` |
| `targetId` | string | 目标文档 id（如文章 id） |
| `createTime` | Date | `db.serverDate()` |

## 建议索引（**尚未创建**，需人工补）

查询形态固定为 `where({ _openid, targetType, targetId })`，建议复合索引：

```
_openid (asc) + targetType (asc) + targetId (asc)
```

**缺索引不会让功能失败**（小集合可全表扫），但点赞量上来后每次切换都会变慢。
可参照 `admin/scripts/ensure-*-indexes.cjs` 的同款模式补 `ensure-likes-indexes.cjs`。

## 历史

- **2026-09-16 创建**：审计 P0-11 发现「云函数 `toggleCollection` 有 4 处读写，
  但集合线上根本不存在」→ 点赞**直接失败**而界面看起来完全正常。
  与 `vip_cards` / `equity_goods` / `feishu_shipments` 同批发现；本条先修
  （规则文件已就绪、无口径待决，另三个需先定规则形态）。

## 维护

新增字段时同步：规则文件 ↔ 本 schema ↔ 相关云函数注释。
