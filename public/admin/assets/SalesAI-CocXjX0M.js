import{On as e,Tn as t,an as n,ln as r,on as i,r as a,rn as o,un as s,xn as c,yn as l}from"./element-plus-DU8uayx_.js";import{H as u,N as d,j as f,x as p}from"./index-DM-1O6Qs.js";var m={class:`sales-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=u({__name:`SalesAI`,props:{feature:Object},setup(u){let _=e(!1),v=e(``),y=async()=>{_.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`});if(!e){a.error(`获取数据失败`);return}let t=await d(`基于以下销售数据，预测未来30天的销售趋势：

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
5. 提升销量的建议`,{systemInstruction:`你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测`,temperature:.7});v.value=f.parse(t)}catch(e){a.error(`预测失败：`+e.message)}finally{_.value=!1}};return(e,a)=>{let u=c(`el-button`);return l(),i(`div`,m,[a[1]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`📈 销售预测分析`),o(`p`,{class:`subtitle`},`基于数据的智能销售趋势预测`)],-1),s(u,{type:`primary`,onClick:y,loading:_.value},{default:t(()=>[...a[0]||=[r(` 生成销售预测 `,-1)]]),_:1},8,[`loading`]),v.value?(l(),i(`div`,h,[o(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):n(``,!0)])}}},[[`__scopeId`,`data-v-abcc006d`]]);export{_ as default};