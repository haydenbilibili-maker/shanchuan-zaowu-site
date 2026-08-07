import{$t as e,Zt as t,_n as n,bn as r,dn as i,en as a,nn as o,pn as s,r as c,rn as l}from"./element-plus-fsBmGXUl.js";import{g as u,h as d,v as f}from"./index-B_BVpAxk.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=d({__name:`PricingAI`,props:{feature:Object},setup(d){let _=r(!1),v=r(``),y=r({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){c.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await f(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=u.parse(t)}catch(e){c.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(r,c)=>{let u=s(`el-input`),d=s(`el-form-item`),f=s(`el-input-number`),x=s(`el-option`),S=s(`el-select`),C=s(`el-button`),w=s(`el-form`);return i(),a(`div`,p,[c[7]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`💰 动态定价优化`),t(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),t(`div`,m,[l(w,{model:y.value,"label-width":`120px`},{default:n(()=>[l(d,{label:`商品名称`},{default:n(()=>[l(u,{modelValue:y.value.productName,"onUpdate:modelValue":c[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),l(d,{label:`当前价格`},{default:n(()=>[l(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":c[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),l(d,{label:`成本价格`},{default:n(()=>[l(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":c[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),l(d,{label:`库存数量`},{default:n(()=>[l(f,{modelValue:y.value.stock,"onUpdate:modelValue":c[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),l(d,{label:`销售目标`},{default:n(()=>[l(S,{modelValue:y.value.target,"onUpdate:modelValue":c[4]||=e=>y.value.target=e},{default:n(()=>[l(x,{label:`最大化利润`,value:`profit`}),l(x,{label:`快速清仓`,value:`clearance`}),l(x,{label:`提升销量`,value:`volume`}),l(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),l(d,null,{default:n(()=>[l(C,{type:`primary`,onClick:b,loading:_.value},{default:n(()=>[...c[5]||=[o(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(i(),a(`div`,h,[c[6]||=t(`h4`,null,`💡 定价建议`,-1),t(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):e(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};