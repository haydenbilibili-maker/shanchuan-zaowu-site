import{_n as e,an as t,en as n,hn as r,nn as i,on as a,r as o,rn as s,wn as c,xn as l}from"./element-plus-CxgvyxlJ.js";import{M as u,P as d,j as f,x as p}from"./index-49kSiBUH.js";var m={class:`sales-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`SalesAI`,props:{feature:Object},setup(f){let _=c(!1),v=c(``),y=async()=>{_.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`});if(!e){o.error(`获取数据失败`);return}let t=await d(`基于以下销售数据，预测未来30天的销售趋势：

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
5. 提升销量的建议`,{systemInstruction:`你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测`,temperature:.7});v.value=u.parse(t)}catch(e){o.error(`预测失败：`+e.message)}finally{_.value=!1}};return(o,c)=>{let u=e(`el-button`);return r(),s(`div`,m,[c[1]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📈 销售预测分析`),n(`p`,{class:`subtitle`},`基于数据的智能销售趋势预测`)],-1),a(u,{type:`primary`,onClick:y,loading:_.value},{default:l(()=>[...c[0]||=[t(` 生成销售预测 `,-1)]]),_:1},8,[`loading`]),v.value?(r(),s(`div`,h,[n(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):i(``,!0)])}}},[[`__scopeId`,`data-v-abcc006d`]]);export{_ as default};