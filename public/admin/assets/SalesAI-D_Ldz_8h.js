import{Sn as e,Tn as t,gn as n,in as r,on as i,r as a,rn as o,sn as s,tn as c,vn as l}from"./element-plus-DAUmSRMo.js";import{M as u,P as d,j as f,x as p}from"./index-boq8aa-O.js";var m={class:`sales-ai`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`SalesAI`,props:{feature:Object},setup(f){let _=t(!1),v=t(``),y=async()=>{_.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`week`});if(!e){a.error(`获取数据失败`);return}let t=await d(`基于以下销售数据，预测未来30天的销售趋势：

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
5. 提升销量的建议`,{systemInstruction:`你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测`,temperature:.7});v.value=u.parse(t)}catch(e){a.error(`预测失败：`+e.message)}finally{_.value=!1}};return(t,a)=>{let u=l(`el-button`);return n(),r(`div`,m,[a[1]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`📈 销售预测分析`),c(`p`,{class:`subtitle`},`基于数据的智能销售趋势预测`)],-1),s(u,{type:`primary`,onClick:y,loading:_.value},{default:e(()=>[...a[0]||=[i(` 生成销售预测 `,-1)]]),_:1},8,[`loading`]),v.value?(n(),r(`div`,h,[c(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):o(``,!0)])}}},[[`__scopeId`,`data-v-abcc006d`]]);export{_ as default};