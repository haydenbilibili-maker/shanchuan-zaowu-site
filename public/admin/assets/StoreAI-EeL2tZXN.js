import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,s as p,y as m}from"./index-nwDdqFlp.js";var h={class:`store-ai`},g={class:`ai-sections`},_={class:`section-card`},v=[`innerHTML`],y={class:`section-card`},b=[`innerHTML`],x={class:`section-card`},S=[`innerHTML`],C=f({__name:`StoreAI`,props:{feature:Object},setup(e){let f=o(!1),C=o(!1),w=o(!1),T=o(``),E=o(``),D=o(``),O=async()=>{f.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`}),t=await m(`请分析门店当前经营状况，基于以下数据：

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
4. 改进方向`,{systemInstruction:`你是一位资深的门店运营专家，擅长数据分析和管理优化`,temperature:.8});T.value=d.parse(t)}catch(e){l.error(`分析失败：`+e.message)}finally{f.value=!1}},k=async()=>{C.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`}),t=await m(`基于门店当前数据，请提供具体的优化建议：

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
5. 每个建议都要具体可执行`,{systemInstruction:`你是一位门店运营优化专家，提供务实、可执行的建议`,temperature:.9});E.value=d.parse(t)}catch(e){l.error(`获取建议失败：`+e.message)}finally{C.value=!1}},A=async()=>{w.value=!0;try{await p(!1,{useFinancialData:!0,period:`week`});let e=await m(`请分析门店当前存在的风险和问题：

数据情况：
- 营收趋势
- 库存状况
- 会员活跃度
- 订单情况

请识别：
1. 潜在风险点
2. 风险严重程度
3. 可能的影响
4. 应对措施`,{systemInstruction:`你是一位风险管理专家，擅长识别和评估经营风险`,temperature:.7});D.value=d.parse(e)}catch(e){l.error(`风险检查失败：`+e.message)}finally{w.value=!1}};return(e,o)=>{let l=s(`el-button`);return u(),i(`div`,h,[o[6]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`🏪 门店经营AI助手`),n(`p`,{class:`subtitle`},`全方位门店运营智能分析与建议`)],-1),n(`div`,g,[n(`div`,_,[o[1]||=n(`h4`,null,`📊 实时经营状况`,-1),a(l,{type:`primary`,onClick:O,loading:f.value},{default:c(()=>[...o[0]||=[t(`分析当前状况`,-1)]]),_:1},8,[`loading`]),T.value?(u(),i(`div`,{key:0,class:`analysis-result`,innerHTML:T.value},null,8,v)):r(``,!0)]),n(`div`,y,[o[3]||=n(`h4`,null,`💡 智能优化建议`,-1),a(l,{type:`primary`,onClick:k,loading:C.value},{default:c(()=>[...o[2]||=[t(`获取建议`,-1)]]),_:1},8,[`loading`]),E.value?(u(),i(`div`,{key:0,class:`suggestions-list`,innerHTML:E.value},null,8,b)):r(``,!0)]),n(`div`,x,[o[5]||=n(`h4`,null,`⚠️ 风险预警`,-1),a(l,{type:`primary`,onClick:A,loading:w.value},{default:c(()=>[...o[4]||=[t(`检查风险`,-1)]]),_:1},8,[`loading`]),D.value?(u(),i(`div`,{key:0,class:`risks-list`,innerHTML:D.value},null,8,S)):r(``,!0)])])])}}},[[`__scopeId`,`data-v-f6000a65`]]);export{C as default};