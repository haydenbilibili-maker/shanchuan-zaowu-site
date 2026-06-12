import{$t as e,Jt as t,Xt as n,Zt as r,_n as i,cn as a,en as o,mn as s,r as c,un as l}from"./element-plus-CVfHhcL0.js";import{_ as u,h as d,m as f}from"./index-D_jnvNgu.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`PricingAI`,props:{feature:Object},setup(f){let _=i(!1),v=i(``),y=i({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){c.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await u(`请为以下商品提供定价优化建议：

商品信息：
- 商品名称：${y.value.productName}
- 当前价格：¥${y.value.currentPrice}
- 成本价格：¥${y.value.costPrice}
- 当前库存：${y.value.stock}件
- 销售目标：${e}

请提供：
1. 最优定价建议（具体金额）
2. 定价理由分析
3. 预期销量和利润
4. 风险提示
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=d.parse(t)}catch(e){c.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(i,c)=>{let u=l(`el-input`),d=l(`el-form-item`),f=l(`el-input-number`),x=l(`el-option`),S=l(`el-select`),C=l(`el-button`),w=l(`el-form`);return a(),r(`div`,p,[c[7]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`💰 动态定价优化`),t(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),t(`div`,m,[o(w,{model:y.value,"label-width":`120px`},{default:s(()=>[o(d,{label:`商品名称`},{default:s(()=>[o(u,{modelValue:y.value.productName,"onUpdate:modelValue":c[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),o(d,{label:`当前价格`},{default:s(()=>[o(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":c[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),o(d,{label:`成本价格`},{default:s(()=>[o(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":c[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),o(d,{label:`库存数量`},{default:s(()=>[o(f,{modelValue:y.value.stock,"onUpdate:modelValue":c[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),o(d,{label:`销售目标`},{default:s(()=>[o(S,{modelValue:y.value.target,"onUpdate:modelValue":c[4]||=e=>y.value.target=e},{default:s(()=>[o(x,{label:`最大化利润`,value:`profit`}),o(x,{label:`快速清仓`,value:`clearance`}),o(x,{label:`提升销量`,value:`volume`}),o(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),o(d,null,{default:s(()=>[o(C,{type:`primary`,onClick:b,loading:_.value},{default:s(()=>[...c[5]||=[e(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(a(),r(`div`,h,[c[6]||=t(`h4`,null,`💡 定价建议`,-1),t(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):n(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};