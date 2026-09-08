import{On as e,Tn as t,an as n,ln as r,on as i,r as a,rn as o,un as s,xn as c,yn as l}from"./element-plus-DU8uayx_.js";import{H as u,N as d,j as f,x as p}from"./index-Bf2eN4ci.js";var m={class:`supply-chain-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b={class:`section-card`},x=[`innerHTML`],S=u({__name:`SupplyChainAI`,props:{feature:Object},setup(u){let S=e(!1),C=e(!1),w=e(!1),T=e(``),E=e(``),D=e(``),O=async()=>{S.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`});if(!e){a.error(`获取数据失败`);return}let t=await d(`分析门店供应链效率：
- 商品总数：${e.products.total}
- 低库存商品：${e.inventory.lowStock}件
- 缺货商品：${e.inventory.outOfStock}件

请提供：
1. 供应链效率评估
2. 采购周期分析
3. 库存周转效率
4. 供应链风险识别`,{systemInstruction:`你是供应链管理专家，擅长分析供应链效率和优化`,temperature:.8});T.value=f.parse(t)}catch(e){a.error(`分析失败：`+(e.message||`未知错误`))}finally{S.value=!1}},k=async()=>{C.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`});if(!e){a.error(`获取数据失败`);return}let t=await d(`提供供应商优化建议：
- 当前库存状况：低库存${e.inventory.lowStock}件，缺货${e.inventory.outOfStock}件

请提供：
1. 供应商选择建议
2. 采购策略优化
3. 供应商关系管理
4. 风险分散方案`,{systemInstruction:`你是供应商管理专家`,temperature:.8});E.value=f.parse(t)}catch(e){a.error(`分析失败：`+(e.message||`未知错误`))}finally{C.value=!1}},A=async()=>{w.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`});if(!e){a.error(`获取数据失败`);return}let t=await d(`分析采购成本优化机会：
- 库存总价值：¥${e.inventory.totalValue?.toFixed(2)||0}
- 商品数量：${e.products.total}

请提供：
1. 采购成本结构分析
2. 批量采购优化建议
3. 成本降低策略
4. 预算规划建议`,{systemInstruction:`你是采购成本优化专家`,temperature:.8});D.value=f.parse(t)}catch(e){a.error(`分析失败：`+(e.message||`未知错误`))}finally{w.value=!1}};return(e,a)=>{let u=c(`el-button`);return l(),i(`div`,m,[a[6]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`🚚 供应链优化AI`),o(`p`,{class:`subtitle`},`智能供应链分析与供应商管理优化`)],-1),o(`div`,h,[o(`div`,g,[a[1]||=o(`h4`,null,`📊 供应链效率分析`,-1),s(u,{type:`primary`,onClick:O,loading:S.value},{default:t(()=>[...a[0]||=[r(` 分析供应链效率 `,-1)]]),_:1},8,[`loading`]),T.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:T.value},null,8,_)):n(``,!0)]),o(`div`,v,[a[3]||=o(`h4`,null,`💡 供应商优化建议`,-1),s(u,{type:`primary`,onClick:k,loading:C.value},{default:t(()=>[...a[2]||=[r(` 获取优化建议 `,-1)]]),_:1},8,[`loading`]),E.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:E.value},null,8,y)):n(``,!0)]),o(`div`,b,[a[5]||=o(`h4`,null,`💰 采购成本优化`,-1),s(u,{type:`primary`,onClick:A,loading:w.value},{default:t(()=>[...a[4]||=[r(` 分析采购成本 `,-1)]]),_:1},8,[`loading`]),D.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:D.value},null,8,x)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-fa2a5efe`]]);export{S as default};