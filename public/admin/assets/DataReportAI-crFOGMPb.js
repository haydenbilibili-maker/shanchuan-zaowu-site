import{_n as e,an as t,en as n,hn as r,nn as i,on as a,r as o,rn as s,wn as c,xn as l}from"./element-plus-CxgvyxlJ.js";import{u,v as d,x as f,y as p}from"./index-y_f8PkF7.js";var m={class:`data-report-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v=d({__name:`DataReportAI`,props:{feature:Object},setup(d){let v=c({type:`business`,period:`week`}),y=c(!1),b=c(``),x=async()=>{y.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:v.value.period});if(!e){o.error(`获取数据失败`);return}let t={business:`经营数据报告`,finance:`财务分析报告`,operations:`运营分析报告`,comprehensive:`综合报告`},n=`生成${{week:`本周`,month:`本月`,quarter:`本季度`,custom:`指定时间段`}[v.value.period]}${t[v.value.type]}：

业务数据：
- 营收：¥${e.finance?.weeklyRevenue?.toFixed(2)||0}（${v.value.period===`week`?`本周`:`本月`}）
- 订单数：${e.finance?.weeklyOrdersCount||0}单
- 平均客单价：¥${e.finance?.averageOrderValue?.toFixed(2)||0}
- 商品总数：${e.products.total}
- 库存价值：¥${e.inventory?.totalValue?.toFixed(2)||0}
- 会员总数：${e.members.total}
- 活跃会员：${e.members.active}（活跃率${e.members.activeRate}%）`;(v.value.type===`finance`||v.value.type===`comprehensive`)&&(n+=`

财务详细：
- 净利润（估）：¥${e.finance?.totalProfit?.toFixed(2)||0}
- 毛利率：约55%`),(v.value.type===`operations`||v.value.type===`comprehensive`)&&(n+=`

运营数据：
- 低库存商品：${e.inventory.lowStock}件
- 缺货商品：${e.inventory.outOfStock}件
- 活动总数：${e.activitiesData.total}
- 进行中活动：${e.activitiesData.active}`),n+=`

请生成专业的${t[v.value.type]}，包括：
1. 执行摘要
2. 关键指标分析
3. 数据趋势分析
4. 问题识别
5. 改进建议
6. 下一步行动计划`;let r=await f(n,{systemInstruction:`你是数据分析报告专家，擅长生成专业、全面的数据报告`,temperature:.7,maxOutputTokens:4096});b.value=p.parse(r)}catch(e){o.error(`生成失败：`+(e.message||`未知错误`))}finally{y.value=!1}};return(o,c)=>{let u=e(`el-option`),d=e(`el-select`),f=e(`el-form-item`),p=e(`el-button`),S=e(`el-form`);return r(),s(`div`,m,[c[4]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📊 数据报告生成AI`),n(`p`,{class:`subtitle`},`一键生成经营数据报告、财务报告与运营分析报告`)],-1),n(`div`,h,[n(`div`,g,[c[3]||=n(`h4`,null,`📈 报告类型选择`,-1),a(S,{model:v.value,"label-width":`120px`},{default:l(()=>[a(f,{label:`报告类型`},{default:l(()=>[a(d,{modelValue:v.value.type,"onUpdate:modelValue":c[0]||=e=>v.value.type=e},{default:l(()=>[a(u,{label:`经营数据报告`,value:`business`}),a(u,{label:`财务分析报告`,value:`finance`}),a(u,{label:`运营分析报告`,value:`operations`}),a(u,{label:`综合报告`,value:`comprehensive`})]),_:1},8,[`modelValue`])]),_:1}),a(f,{label:`时间范围`},{default:l(()=>[a(d,{modelValue:v.value.period,"onUpdate:modelValue":c[1]||=e=>v.value.period=e},{default:l(()=>[a(u,{label:`本周`,value:`week`}),a(u,{label:`本月`,value:`month`}),a(u,{label:`本季度`,value:`quarter`}),a(u,{label:`自定义`,value:`custom`})]),_:1},8,[`modelValue`])]),_:1}),a(f,null,{default:l(()=>[a(p,{type:`primary`,onClick:x,loading:y.value},{default:l(()=>[...c[2]||=[t(` 生成报告 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),b.value?(r(),s(`div`,{key:0,class:`result-content`,innerHTML:b.value},null,8,_)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-70d7de75`]]);export{v as default};