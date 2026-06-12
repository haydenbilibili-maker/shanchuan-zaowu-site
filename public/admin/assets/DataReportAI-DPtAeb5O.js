import{$t as e,Jt as t,Xt as n,Zt as r,_n as i,cn as a,en as o,mn as s,r as c,un as l}from"./element-plus-CVfHhcL0.js";import{_ as u,h as d,m as f,o as p}from"./index-D_jnvNgu.js";var m={class:`data-report-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v=f({__name:`DataReportAI`,props:{feature:Object},setup(f){let v=i({type:`business`,period:`week`}),y=i(!1),b=i(``),x=async()=>{y.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:v.value.period});if(!e){c.error(`获取数据失败`);return}let t={business:`经营数据报告`,finance:`财务分析报告`,operations:`运营分析报告`,comprehensive:`综合报告`},n=`生成${{week:`本周`,month:`本月`,quarter:`本季度`,custom:`指定时间段`}[v.value.period]}${t[v.value.type]}：

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
6. 下一步行动计划`;let r=await u(n,{systemInstruction:`你是数据分析报告专家，擅长生成专业、全面的数据报告`,temperature:.7,maxOutputTokens:4096});b.value=d.parse(r)}catch(e){c.error(`生成失败：`+(e.message||`未知错误`))}finally{y.value=!1}};return(i,c)=>{let u=l(`el-option`),d=l(`el-select`),f=l(`el-form-item`),p=l(`el-button`),S=l(`el-form`);return a(),r(`div`,m,[c[4]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`📊 数据报告生成AI`),t(`p`,{class:`subtitle`},`一键生成经营数据报告、财务报告与运营分析报告`)],-1),t(`div`,h,[t(`div`,g,[c[3]||=t(`h4`,null,`📈 报告类型选择`,-1),o(S,{model:v.value,"label-width":`120px`},{default:s(()=>[o(f,{label:`报告类型`},{default:s(()=>[o(d,{modelValue:v.value.type,"onUpdate:modelValue":c[0]||=e=>v.value.type=e},{default:s(()=>[o(u,{label:`经营数据报告`,value:`business`}),o(u,{label:`财务分析报告`,value:`finance`}),o(u,{label:`运营分析报告`,value:`operations`}),o(u,{label:`综合报告`,value:`comprehensive`})]),_:1},8,[`modelValue`])]),_:1}),o(f,{label:`时间范围`},{default:s(()=>[o(d,{modelValue:v.value.period,"onUpdate:modelValue":c[1]||=e=>v.value.period=e},{default:s(()=>[o(u,{label:`本周`,value:`week`}),o(u,{label:`本月`,value:`month`}),o(u,{label:`本季度`,value:`quarter`}),o(u,{label:`自定义`,value:`custom`})]),_:1},8,[`modelValue`])]),_:1}),o(f,null,{default:s(()=>[o(p,{type:`primary`,onClick:x,loading:y.value},{default:s(()=>[...c[2]||=[e(` 生成报告 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),b.value?(a(),r(`div`,{key:0,class:`result-content`,innerHTML:b.value},null,8,_)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-70d7de75`]]);export{v as default};