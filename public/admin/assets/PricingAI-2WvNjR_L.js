import{On as e,Tn as t,an as n,ln as r,on as i,r as a,rn as o,un as s,xn as c,yn as l}from"./element-plus-DU8uayx_.js";import{H as u,N as d,j as f}from"./index-DNkoX8OU.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=u({__name:`PricingAI`,props:{feature:Object},setup(u){let _=e(!1),v=e(``),y=e({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){a.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await d(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=f.parse(t)}catch(e){a.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(e,a)=>{let u=c(`el-input`),d=c(`el-form-item`),f=c(`el-input-number`),x=c(`el-option`),S=c(`el-select`),C=c(`el-button`),w=c(`el-form`);return l(),i(`div`,p,[a[7]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`💰 动态定价优化`),o(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),o(`div`,m,[s(w,{model:y.value,"label-width":`120px`},{default:t(()=>[s(d,{label:`商品名称`},{default:t(()=>[s(u,{modelValue:y.value.productName,"onUpdate:modelValue":a[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),s(d,{label:`当前价格`},{default:t(()=>[s(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":a[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),s(d,{label:`成本价格`},{default:t(()=>[s(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":a[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),s(d,{label:`库存数量`},{default:t(()=>[s(f,{modelValue:y.value.stock,"onUpdate:modelValue":a[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),s(d,{label:`销售目标`},{default:t(()=>[s(S,{modelValue:y.value.target,"onUpdate:modelValue":a[4]||=e=>y.value.target=e},{default:t(()=>[s(x,{label:`最大化利润`,value:`profit`}),s(x,{label:`快速清仓`,value:`clearance`}),s(x,{label:`提升销量`,value:`volume`}),s(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),s(d,null,{default:t(()=>[s(C,{type:`primary`,onClick:b,loading:_.value},{default:t(()=>[...a[5]||=[r(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(l(),i(`div`,h,[a[6]||=o(`h4`,null,`💡 定价建议`,-1),o(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):n(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};