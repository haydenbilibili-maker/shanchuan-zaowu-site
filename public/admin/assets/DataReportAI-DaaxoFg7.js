import{$t as e,Zt as t,_n as n,bn as r,dn as i,en as a,nn as o,pn as s,r as c,rn as l}from"./element-plus-fsBmGXUl.js";import{g as u,h as d,s as f,v as p}from"./index-DuFA98fB.js";var m={class:`data-report-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v=d({__name:`DataReportAI`,props:{feature:Object},setup(d){let v=r({type:`business`,period:`week`}),y=r(!1),b=r(``),x=async()=>{y.value=!0;try{let e=await f(!1,{useFinancialData:!0,period:v.value.period});if(!e){c.error(`获取数据失败`);return}let t={business:`经营数据报告`,finance:`财务分析报告`,operations:`运营分析报告`,comprehensive:`综合报告`},n=`生成${{week:`本周`,month:`本月`,quarter:`本季度`,custom:`指定时间段`}[v.value.period]}${t[v.value.type]}：

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
6. 下一步行动计划`;let r=await p(n,{systemInstruction:`你是数据分析报告专家，擅长生成专业、全面的数据报告`,temperature:.7,maxOutputTokens:4096});b.value=u.parse(r)}catch(e){c.error(`生成失败：`+(e.message||`未知错误`))}finally{y.value=!1}};return(r,c)=>{let u=s(`el-option`),d=s(`el-select`),f=s(`el-form-item`),p=s(`el-button`),S=s(`el-form`);return i(),a(`div`,m,[c[4]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`📊 数据报告生成AI`),t(`p`,{class:`subtitle`},`一键生成经营数据报告、财务报告与运营分析报告`)],-1),t(`div`,h,[t(`div`,g,[c[3]||=t(`h4`,null,`📈 报告类型选择`,-1),l(S,{model:v.value,"label-width":`120px`},{default:n(()=>[l(f,{label:`报告类型`},{default:n(()=>[l(d,{modelValue:v.value.type,"onUpdate:modelValue":c[0]||=e=>v.value.type=e},{default:n(()=>[l(u,{label:`经营数据报告`,value:`business`}),l(u,{label:`财务分析报告`,value:`finance`}),l(u,{label:`运营分析报告`,value:`operations`}),l(u,{label:`综合报告`,value:`comprehensive`})]),_:1},8,[`modelValue`])]),_:1}),l(f,{label:`时间范围`},{default:n(()=>[l(d,{modelValue:v.value.period,"onUpdate:modelValue":c[1]||=e=>v.value.period=e},{default:n(()=>[l(u,{label:`本周`,value:`week`}),l(u,{label:`本月`,value:`month`}),l(u,{label:`本季度`,value:`quarter`}),l(u,{label:`自定义`,value:`custom`})]),_:1},8,[`modelValue`])]),_:1}),l(f,null,{default:n(()=>[l(p,{type:`primary`,onClick:x,loading:y.value},{default:n(()=>[...c[2]||=[o(` 生成报告 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),b.value?(i(),a(`div`,{key:0,class:`result-content`,innerHTML:b.value},null,8,_)):e(``,!0)])])])}}},[[`__scopeId`,`data-v-70d7de75`]]);export{v as default};