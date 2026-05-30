# finance_records 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `date` | string | 营业日，`YYYY-MM-DD`，合并键 |
| `revenue` | number | 当日营收（元） |
| `orderCount` | number | 订单数 |
| `avgOrderPrice` | number | 客单价（可选） |
| `customerPrice` | number | 人均消费（可选） |
| `raw` | string | 原始录入文本（可选） |
| `storeId` | string | 门店 ID（多店时） |
| `storeCode` | string | 门店编码（可选） |
| `_createTime` | number | 创建时间戳（SDK 写入） |
| `_updateTime` | number | 更新时间戳（冲突合并依据） |
| `syncedAt` | number | 最后同步时间戳 |
