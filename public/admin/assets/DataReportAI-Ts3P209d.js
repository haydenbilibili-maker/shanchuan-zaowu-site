import{Jt as e,Xt as t,Zt as n,en as r,fn as i,gn as a,r as o,tn as s,un as c,yn as l}from"./element-plus-CVSIbaOo.js";import{C as u,F as d,N as f,W as p}from"./index-BxCDW-W1.js";var m={class:`data-report-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v=p({__name:`DataReportAI`,props:{feature:Object},setup(p){let v=l({type:`business`,period:`week`}),y=l(!1),b=l(``),x=async()=>{y.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:v.value.period});if(!e){o.error(`获取数据失败`);return}let t={business:`经营数据报告`,finance:`财务分析报告`,operations:`运营分析报告`,comprehensive:`综合报告`},n=`生成${{week:`本周`,month:`本月`,quarter:`本季度`,custom:`指定时间段`}[v.value.period]}${t[v.value.type]}：

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
6. 下一步行动计划`;let r=await d(n,{systemInstruction:`你是数据分析报告专家，擅长生成专业、全面的数据报告`,temperature:.7,maxOutputTokens:4096});b.value=f.parse(r)}catch(e){o.error(`生成失败：`+(e.message||`未知错误`))}finally{y.value=!1}};return(o,l)=>{let u=i(`el-option`),d=i(`el-select`),f=i(`el-form-item`),p=i(`el-button`),S=i(`el-form`);return c(),n(`div`,m,[l[4]||=e(`div`,{class:`ai-header`},[e(`h3`,null,`📊 数据报告生成AI`),e(`p`,{class:`subtitle`},`一键生成经营数据报告、财务报告与运营分析报告`)],-1),e(`div`,h,[e(`div`,g,[l[3]||=e(`h4`,null,`📈 报告类型选择`,-1),s(S,{model:v.value,"label-width":`120px`},{default:a(()=>[s(f,{label:`报告类型`},{default:a(()=>[s(d,{modelValue:v.value.type,"onUpdate:modelValue":l[0]||=e=>v.value.type=e},{default:a(()=>[s(u,{label:`经营数据报告`,value:`business`}),s(u,{label:`财务分析报告`,value:`finance`}),s(u,{label:`运营分析报告`,value:`operations`}),s(u,{label:`综合报告`,value:`comprehensive`})]),_:1},8,[`modelValue`])]),_:1}),s(f,{label:`时间范围`},{default:a(()=>[s(d,{modelValue:v.value.period,"onUpdate:modelValue":l[1]||=e=>v.value.period=e},{default:a(()=>[s(u,{label:`本周`,value:`week`}),s(u,{label:`本月`,value:`month`}),s(u,{label:`本季度`,value:`quarter`}),s(u,{label:`自定义`,value:`custom`})]),_:1},8,[`modelValue`])]),_:1}),s(f,null,{default:a(()=>[s(p,{type:`primary`,onClick:x,loading:y.value},{default:a(()=>[...l[2]||=[r(` 生成报告 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),b.value?(c(),n(`div`,{key:0,class:`result-content`,innerHTML:b.value},null,8,_)):t(``,!0)])])])}}},[[`__scopeId`,`data-v-70d7de75`]]);export{v as default};