import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,s as p,y as m}from"./index-nwDdqFlp.js";var h={class:`sales-ai`},g={key:0,class:`result-card`},_=[`innerHTML`],v=f({__name:`SalesAI`,props:{feature:Object},setup(e){let f=o(!1),v=o(``),y=async()=>{f.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`});if(!e){l.error(`获取数据失败`);return}let t=await m(`基于以下销售数据，预测未来30天的销售趋势：

当前数据：
- 本周营收：¥${e.finance.weeklyRevenue.toFixed(2)}
- 本周订单数：${e.finance.weeklyOrdersCount}单
- 平均客单价：¥${e.finance.averageOrderValue.toFixed(2)}
- 总会员数：${e.members.total}
- 本周新增会员：${e.members.weeklyNew}

请提供：
1. 未来30天销售预测（按周分解）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示
5. 提升销量的建议`,{systemInstruction:`你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测`,temperature:.7});v.value=d.parse(t)}catch(e){l.error(`预测失败：`+e.message)}finally{f.value=!1}};return(e,o)=>{let l=s(`el-button`);return u(),i(`div`,h,[o[1]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📈 销售预测分析`),n(`p`,{class:`subtitle`},`基于数据的智能销售趋势预测`)],-1),a(l,{type:`primary`,onClick:y,loading:f.value},{default:c(()=>[...o[0]||=[t(` 生成销售预测 `,-1)]]),_:1},8,[`loading`]),v.value?(u(),i(`div`,g,[n(`div`,{class:`result-content`,innerHTML:v.value},null,8,_)])):r(``,!0)])}}},[[`__scopeId`,`data-v-abcc006d`]]);export{v as default};