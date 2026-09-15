# property_costs · 物业 / 门店成本

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

物业与门店固定/变动成本台账。云函数 `managePropertyCost` 读写（ERP / 超管代理）。

**客户端不得直连**。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `storeId` | string | 门店 |
| `category` | string | 成本类目（租金/水电等） |
| `amount` | number | 金额 |
| `period` / `dateKey` | string | 归属期 |
| `note` | string | 备注 |

## 关联

- 规则：[`../rules/property_costs.json`](../rules/property_costs.json)
