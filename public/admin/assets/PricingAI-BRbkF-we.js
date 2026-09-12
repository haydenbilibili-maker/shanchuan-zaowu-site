import{Cn as e,Mn as t,Tn as n,kn as r,ln as i,mn as a,pn as o,r as s,sn as c,un as l}from"./element-plus-BG1-t9RV.js";import{F as u,N as d,W as f}from"./index-xE0iZrEm.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`PricingAI`,props:{feature:Object},setup(f){let _=t(!1),v=t(``),y=t({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){s.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await u(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=d.parse(t)}catch(e){s.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(t,s)=>{let u=n(`el-input`),d=n(`el-form-item`),f=n(`el-input-number`),x=n(`el-option`),S=n(`el-select`),C=n(`el-button`),w=n(`el-form`);return e(),l(`div`,p,[s[7]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`💰 动态定价优化`),c(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),c(`div`,m,[a(w,{model:y.value,"label-width":`120px`},{default:r(()=>[a(d,{label:`商品名称`},{default:r(()=>[a(u,{modelValue:y.value.productName,"onUpdate:modelValue":s[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),a(d,{label:`当前价格`},{default:r(()=>[a(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":s[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),a(d,{label:`成本价格`},{default:r(()=>[a(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":s[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),a(d,{label:`库存数量`},{default:r(()=>[a(f,{modelValue:y.value.stock,"onUpdate:modelValue":s[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),a(d,{label:`销售目标`},{default:r(()=>[a(S,{modelValue:y.value.target,"onUpdate:modelValue":s[4]||=e=>y.value.target=e},{default:r(()=>[a(x,{label:`最大化利润`,value:`profit`}),a(x,{label:`快速清仓`,value:`clearance`}),a(x,{label:`提升销量`,value:`volume`}),a(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),a(d,null,{default:r(()=>[a(C,{type:`primary`,onClick:b,loading:_.value},{default:r(()=>[...s[5]||=[o(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(e(),l(`div`,h,[s[6]||=c(`h4`,null,`💡 定价建议`,-1),c(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):i(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};