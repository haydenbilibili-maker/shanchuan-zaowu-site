import{En as e,Sn as t,bn as n,dn as r,in as i,kn as a,on as o,r as s,sn as c,un as l}from"./element-plus-CxrabTdB.js";import{C as u,F as d,N as f,W as p}from"./index-f_ff-r67.js";var m={class:`sales-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=p({__name:`SalesAI`,props:{feature:Object},setup(p){let _=a(!1),v=a(``),y=async()=>{_.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`week`});if(!e){s.error(`获取数据失败`);return}let t=await d(`基于以下销售数据，预测未来30天的销售趋势：

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
5. 提升销量的建议`,{systemInstruction:`你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测`,temperature:.7});v.value=f.parse(t)}catch(e){s.error(`预测失败：`+e.message)}finally{_.value=!1}};return(a,s)=>{let u=t(`el-button`);return n(),c(`div`,m,[s[1]||=i(`div`,{class:`ai-header`},[i(`h3`,null,`📈 销售预测分析`),i(`p`,{class:`subtitle`},`基于数据的智能销售趋势预测`)],-1),r(u,{type:`primary`,onClick:y,loading:_.value},{default:e(()=>[...s[0]||=[l(` 生成销售预测 `,-1)]]),_:1},8,[`loading`]),v.value?(n(),c(`div`,h,[i(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):o(``,!0)])}}},[[`__scopeId`,`data-v-abcc006d`]]);export{_ as default};