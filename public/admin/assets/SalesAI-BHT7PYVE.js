import{$t as e,Zt as t,_n as n,bn as r,dn as i,en as a,nn as o,pn as s,r as c,rn as l}from"./element-plus-fsBmGXUl.js";import{g as u,h as d,s as f,v as p}from"./index-B_BVpAxk.js";var m={class:`sales-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=d({__name:`SalesAI`,props:{feature:Object},setup(d){let _=r(!1),v=r(``),y=async()=>{_.value=!0;try{let e=await f(!1,{useFinancialData:!0,period:`week`});if(!e){c.error(`获取数据失败`);return}let t=await p(`基于以下销售数据，预测未来30天的销售趋势：

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
5. 提升销量的建议`,{systemInstruction:`你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测`,temperature:.7});v.value=u.parse(t)}catch(e){c.error(`预测失败：`+e.message)}finally{_.value=!1}};return(r,c)=>{let u=s(`el-button`);return i(),a(`div`,m,[c[1]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`📈 销售预测分析`),t(`p`,{class:`subtitle`},`基于数据的智能销售趋势预测`)],-1),l(u,{type:`primary`,onClick:y,loading:_.value},{default:n(()=>[...c[0]||=[o(` 生成销售预测 `,-1)]]),_:1},8,[`loading`]),v.value?(i(),a(`div`,h,[t(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):e(``,!0)])}}},[[`__scopeId`,`data-v-abcc006d`]]);export{_ as default};