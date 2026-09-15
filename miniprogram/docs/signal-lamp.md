# 信号灯系统（Signal Lamp）

Museum Mode 全局状态指示：克制小圆点，禁止 emoji / 大彩点。

## 色板对照

| Token | 类名 | HEX | 语义 |
|-------|------|-----|------|
| success | `lamp-success` / `.blink` / `.on` | `#52B788` | 健康、成功、就绪、上升 |
| warn | `lamp-warn` / `.warn` | `#E9A23B` | 需关注、待办积压、回落 |
| error | `lamp-error` / `.danger` / `.live` | `#D64045` | 异常、失败、ON AIR、下降 |
| info | `lamp-info` | `#5B8FB9` | 进行中、馆讯、信息态 |
| brass | `lamp-brass` | `#C4A76C` | 待开播、未读强调、品牌态 |
| forest | `lamp-forest` | `#2D5A3F` | 已办妥、权限生效、已入账 |
| muted | `lamp-muted` / 默认灰 | `#6B6560` | 空闲、持平、样本不足、已结束 |

变体：`.hollow` 空心（已读/停用）、`.blink` 脉冲、`.dim` 弱化。

实现：`app.wxss` · 语义工具：`utils/signalLamp.js`。

## 各工作台映射

### 财务月报 `manager/` Tab 财务
| 状态 | 灯 |
|------|----|
| 账本已至今日 / 对齐 | success 静（`.on`） |
| 当月账本滞后 1–2 天（原 toast「请同步云端」） | warn 脉冲 |
| 当月账本滞后 ≥3 天 | error 脉冲 |
| 历史月已有流水 | forest |
| 本月无流水 / 日期未知 | muted |
| 云端合并失败（已降级本地） | warn 脉冲 |

位置：MONTHLY NET 金额同行右侧小圆点；点按/长按出简短说明（账本截止日期、是否需 Web 同步）。**不再**用居中 toast 作为主提示。

### 超管 / 店长看板 `manager/`
| 状态 | 灯 |
|------|----|
| 待发订单 / 待回复有信 / 工单 / 合作申请有积压 | warn |
| 上述清空 | success 静（`.on`） |
| 已发订单（`shipped` 在途）有单 / 无单 | success 静 / muted |
| 已签收（`received`）有单 / 无单 | forest / muted |
| 售后（`refunding`\|`aftersales`）积压 / ≥5 | warn / error 脉冲 |
| 退款存量占比（`refunded/(received+refunded)`）≥8% / ≥15% | warn / error 脉冲 |
| 营收环比上升 / 持平 / 下降 | success 脉冲 / muted / error |
| 库存健康 / 在架为 0 / 加载失败 | success / warn / error |
| 直播中 / 异常残留 / 离线 | live 脉冲 / warn / muted |
| 推流已配·C 端开 | success 静（`.on`） |

经营信号订单口径：与「待发订单」一致，为当前 `orders.status` 快照（无今日/近 N 日时间窗）。点击履约/售后指标跳转订单管理对应 subTab（0 待发 / 1 已发 / 2 已完成·签收 / 3 售后）。营收环比 / 库存可点进数据报表或藏品库。Hub 经营信号默认收起（标题 + 待关注摘要 chip）；点「展开」显示完整分区与图例。

Hub「信息流」跑马灯（标题行与 GMV 卡之间）：仅聚合已有待办/异常（待发、售后、有信摘要、礼赠拆分、审批、发票、工单、合作、直播中、环比下降）；全空则隐藏，不硬编码假数据。≥1 条即横向无缝滚动（双段副本；单条短文案靠 segment 最小宽度保证动感）。

### 标本师 `artisan/`
| 状态 | 灯 |
|------|----|
| 待确认作品 / 待制作 / 待发货 > 0 | warn |
| 装裱中 > 0 | info |
| 对外展示（已上架）> 0 | forest |
| 计数为 0 | muted |

### 主播 `live/studio`
| 状态 | 灯 |
|------|----|
| 在播 ON AIR | live 脉冲 |
| 待开播 | brass |
| 推流未配 / C 端未开 | warn |
| 同事占场 | warn |
| 已结束 / 暂无场次 | muted |

### 店员 `staff/` + `field`
| 状态 | 灯 |
|------|----|
| 核销 / 赠分成功 | success 脉冲 |
| 失败 | error |
| 待核销预约 > 0 | warn（或 success 脉冲表示有票待办） |
| 无待核销 | muted |
| 会员码有效 / 无效 | success / error |
| 请假待审批 | warn |
| 请假已通过 | forest |
| 请假已驳回 | error |
| 请假已撤销 | muted |
| 今日已通过请假（考勤页） | info |

### 投资人 `investor/`
沿用既有 blink / warn / danger / 灰（与 `utils/signalLamp` 同色，不另起一套）。

| 状态 | 灯 |
|------|----|
| 综合研判「向好 / 略升」 | success 脉冲 |
| 综合研判「需关注」 | warn 脉冲 |
| 综合研判「偏弱」 | error 脉冲 |
| 综合研判「平稳」/ 样本不足 | muted |
| 营收环比升 / 回落 / 降 | success 脉冲 / warn / error |
| 退款健康 / ≥8% / ≥15% | success / warn / error |
| GMV·新增周期前后半 | 同环比口径 |
| 库存充足 / 低库存≥1 / ≥8 | success / warn / error |

### 工资条 / 权限配置
| 状态 | 灯 |
|------|----|
| 有工资条记录 / 权限生效 | forest |
| 无记录 / 已停用 | muted（停用可用 hollow） |

### 我的礼赠 `gift/my-gifts`（`giftSignalLamp.js`）
| 状态 | 灯 |
|------|----|
| 往来·待启封 / 到店核销 | brass |
| 往来·待填址 / 待付款 / 截止临近 | warn（逾期可 blink） |
| 往来·履约运输 / 待发货 | info |
| 往来·已完成 | forest |
| 往来·退款 / 取消 | error dim / muted hollow |
| 日子·≤7 日（hot） | warn blink |
| 日子·≤30 日（near） | brass |
| 日子·更远 | muted hollow |
| 页头摘要·有待办 / 仅临近日 / 皆无 | warn / brass / muted hollow |

### 代金券打印 `CouponPrintMint`（`utils/couponPrintLamp.js`）
顶杆最右侧三灯：打印态 / 渠道 / 有效期。待命 muted → 打印中 warn 脉冲 → 成功（可用）success 静 → 失败 error；渠道 store warn / online info / all brass；有效期已过 error、≤7 日 warn 脉冲、其余 success 静。

## 复测清单

- [ ] 山海有信列表：未读黄铜实心、已读空心、种类灯不变
- [ ] 投资观测台：综合研判灯色与环比/退款/库存一致；图例四色；时间切换与下拉刷新
- [ ] 店长看板：经营信号积压变黄；清空变绿；库存/环比/直播灯正确
- [ ] 店长看板：履约组展示已发/已签收；风险组售后/退款灯色；点击跳转订单 Tab
- [ ] 店长看板：信息流跑马灯仅在有待办时出现；点击可进对应模块；无待办整条隐藏
- [ ] 标本师：待办 chip 有灯；全 0 为灰；已上架 forest
- [ ] 主播台：在播红脉冲；待开播黄铜；未配 LIVE_* 黄；同事占场黄
- [ ] 现场服务：赠分/核销成功绿、失败红；待核销列表标题灯
- [ ] 权限配置：生效 forest、停用灰空心
- [ ] 工资条：有记录 forest、空列表 muted
- [ ] 视觉：无 emoji 作灯；圆点 ≤14rpx；Museum 深底克制光晕
- [ ] 我的礼赠：往来卡片灯色对齐 progressKey；日子 hot/near；页头角灯随待办/临近变化
- [ ] 代金券打印：顶杆右端三灯可见；待命灰 → 打印黄脉冲 → 完成绿静；失败 error；渠道/有效期副灯语义正确
