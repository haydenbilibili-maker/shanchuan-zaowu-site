import{Cn as e,Mn as t,Tn as n,kn as r,ln as i,mn as a,pn as o,r as s,sn as c,un as l}from"./element-plus-B7Q2su-S.js";import{C as u,F as d,N as f,W as p}from"./index-C29GqFgq.js";var m={class:`supply-chain-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b={class:`section-card`},x=[`innerHTML`],S=p({__name:`SupplyChainAI`,props:{feature:Object},setup(p){let S=t(!1),C=t(!1),w=t(!1),T=t(``),E=t(``),D=t(``),O=async()=>{S.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`month`});if(!e){s.error(`获取数据失败`);return}let t=await d(`分析门店供应链效率：
- 商品总数：${e.products.total}
- 低库存商品：${e.inventory.lowStock}件
- 缺货商品：${e.inventory.outOfStock}件

请提供：
1. 供应链效率评估
2. 采购周期分析
3. 库存周转效率
4. 供应链风险识别`,{systemInstruction:`你是供应链管理专家，擅长分析供应链效率和优化`,temperature:.8});T.value=f.parse(t)}catch(e){s.error(`分析失败：`+(e.message||`未知错误`))}finally{S.value=!1}},k=async()=>{C.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`month`});if(!e){s.error(`获取数据失败`);return}let t=await d(`提供供应商优化建议：
- 当前库存状况：低库存${e.inventory.lowStock}件，缺货${e.inventory.outOfStock}件

请提供：
1. 供应商选择建议
2. 采购策略优化
3. 供应商关系管理
4. 风险分散方案`,{systemInstruction:`你是供应商管理专家`,temperature:.8});E.value=f.parse(t)}catch(e){s.error(`分析失败：`+(e.message||`未知错误`))}finally{C.value=!1}},A=async()=>{w.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`month`});if(!e){s.error(`获取数据失败`);return}let t=await d(`分析采购成本优化机会：
- 库存总价值：¥${e.inventory.totalValue?.toFixed(2)||0}
- 商品数量：${e.products.total}

请提供：
1. 采购成本结构分析
2. 批量采购优化建议
3. 成本降低策略
4. 预算规划建议`,{systemInstruction:`你是采购成本优化专家`,temperature:.8});D.value=f.parse(t)}catch(e){s.error(`分析失败：`+(e.message||`未知错误`))}finally{w.value=!1}};return(t,s)=>{let u=n(`el-button`);return e(),l(`div`,m,[s[6]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`🚚 供应链优化AI`),c(`p`,{class:`subtitle`},`智能供应链分析与供应商管理优化`)],-1),c(`div`,h,[c(`div`,g,[s[1]||=c(`h4`,null,`📊 供应链效率分析`,-1),a(u,{type:`primary`,onClick:O,loading:S.value},{default:r(()=>[...s[0]||=[o(` 分析供应链效率 `,-1)]]),_:1},8,[`loading`]),T.value?(e(),l(`div`,{key:0,class:`result-content`,innerHTML:T.value},null,8,_)):i(``,!0)]),c(`div`,v,[s[3]||=c(`h4`,null,`💡 供应商优化建议`,-1),a(u,{type:`primary`,onClick:k,loading:C.value},{default:r(()=>[...s[2]||=[o(` 获取优化建议 `,-1)]]),_:1},8,[`loading`]),E.value?(e(),l(`div`,{key:0,class:`result-content`,innerHTML:E.value},null,8,y)):i(``,!0)]),c(`div`,b,[s[5]||=c(`h4`,null,`💰 采购成本优化`,-1),a(u,{type:`primary`,onClick:A,loading:w.value},{default:r(()=>[...s[4]||=[o(` 分析采购成本 `,-1)]]),_:1},8,[`loading`]),D.value?(e(),l(`div`,{key:0,class:`result-content`,innerHTML:D.value},null,8,x)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-fa2a5efe`]]);export{S as default};