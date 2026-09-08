import{On as e,Tn as t,an as n,ln as r,on as i,r as a,rn as o,un as s,xn as c,yn as l}from"./element-plus-DU8uayx_.js";import{H as u,N as d,j as f,x as p}from"./index-f4KZ9oXR.js";var m={class:`store-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b={class:`section-card`},x=[`innerHTML`],S=u({__name:`StoreAI`,props:{feature:Object},setup(u){let S=e(!1),C=e(!1),w=e(!1),T=e(``),E=e(``),D=e(``),O=async()=>{S.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`}),t=await d(`请分析门店当前经营状况，基于以下数据：

财务数据：
- 本周营收：¥${e?.finance?.weeklyRevenue||0}
- 本周订单数：${e?.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e?.finance?.averageOrderValue||0}

库存数据：
- 总商品数：${e?.products?.total||0}
- 低库存商品：${e?.inventory?.lowStock||0}
- 缺货商品：${e?.inventory?.outOfStock||0}

会员数据：
- 总会员数：${e?.members?.total||0}
- 本周新增：${e?.members?.weeklyNew||0}
- 活跃率：${e?.members?.activeRate||0}%

请提供：
1. 经营状况评估
2. 关键指标分析
3. 亮点和问题
4. 改进方向`,{systemInstruction:`你是一位资深的门店运营专家，擅长数据分析和管理优化`,temperature:.8});T.value=f.parse(t)}catch(e){a.error(`分析失败：`+e.message)}finally{S.value=!1}},k=async()=>{C.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`}),t=await d(`基于门店当前数据，请提供具体的优化建议：

当前数据：
- 营收：¥${e?.finance?.weeklyRevenue||0}/周
- 订单：${e?.finance?.weeklyOrdersCount||0}单/周
- 客单价：¥${e?.finance?.averageOrderValue||0}
- 库存状况：低库存${e?.inventory?.lowStock||0}件，缺货${e?.inventory?.outOfStock||0}件

请提供：
1. 提升营收的具体措施
2. 优化库存管理的建议
3. 提升客单价的方法
4. 增强客户复购的策略
5. 每个建议都要具体可执行`,{systemInstruction:`你是一位门店运营优化专家，提供务实、可执行的建议`,temperature:.9});E.value=f.parse(t)}catch(e){a.error(`获取建议失败：`+e.message)}finally{C.value=!1}},A=async()=>{w.value=!0;try{await p(!1,{useFinancialData:!0,period:`week`});let e=await d(`请分析门店当前存在的风险和问题：

数据情况：
- 营收趋势
- 库存状况
- 会员活跃度
- 订单情况

请识别：
1. 潜在风险点
2. 风险严重程度
3. 可能的影响
4. 应对措施`,{systemInstruction:`你是一位风险管理专家，擅长识别和评估经营风险`,temperature:.7});D.value=f.parse(e)}catch(e){a.error(`风险检查失败：`+e.message)}finally{w.value=!1}};return(e,a)=>{let u=c(`el-button`);return l(),i(`div`,m,[a[6]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`🏪 门店经营AI助手`),o(`p`,{class:`subtitle`},`全方位门店运营智能分析与建议`)],-1),o(`div`,h,[o(`div`,g,[a[1]||=o(`h4`,null,`📊 实时经营状况`,-1),s(u,{type:`primary`,onClick:O,loading:S.value},{default:t(()=>[...a[0]||=[r(`分析当前状况`,-1)]]),_:1},8,[`loading`]),T.value?(l(),i(`div`,{key:0,class:`analysis-result`,innerHTML:T.value},null,8,_)):n(``,!0)]),o(`div`,v,[a[3]||=o(`h4`,null,`💡 智能优化建议`,-1),s(u,{type:`primary`,onClick:k,loading:C.value},{default:t(()=>[...a[2]||=[r(`获取建议`,-1)]]),_:1},8,[`loading`]),E.value?(l(),i(`div`,{key:0,class:`suggestions-list`,innerHTML:E.value},null,8,y)):n(``,!0)]),o(`div`,b,[a[5]||=o(`h4`,null,`⚠️ 风险预警`,-1),s(u,{type:`primary`,onClick:A,loading:w.value},{default:t(()=>[...a[4]||=[r(`检查风险`,-1)]]),_:1},8,[`loading`]),D.value?(l(),i(`div`,{key:0,class:`risks-list`,innerHTML:D.value},null,8,x)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-f6000a65`]]);export{S as default};