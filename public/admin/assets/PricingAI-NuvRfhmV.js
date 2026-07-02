import{Qt as e,Yt as t,Zt as n,dn as r,en as i,hn as a,ln as o,r as s,tn as c,vn as l}from"./element-plus-BAAD72xB.js";import{_ as u,h as d,m as f}from"./index-Cbn80Adr.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`PricingAI`,props:{feature:Object},setup(f){let _=l(!1),v=l(``),y=l({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){s.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await u(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=d.parse(t)}catch(e){s.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(s,l)=>{let u=r(`el-input`),d=r(`el-form-item`),f=r(`el-input-number`),x=r(`el-option`),S=r(`el-select`),C=r(`el-button`),w=r(`el-form`);return o(),e(`div`,p,[l[7]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`💰 动态定价优化`),t(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),t(`div`,m,[c(w,{model:y.value,"label-width":`120px`},{default:a(()=>[c(d,{label:`商品名称`},{default:a(()=>[c(u,{modelValue:y.value.productName,"onUpdate:modelValue":l[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),c(d,{label:`当前价格`},{default:a(()=>[c(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":l[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),c(d,{label:`成本价格`},{default:a(()=>[c(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":l[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),c(d,{label:`库存数量`},{default:a(()=>[c(f,{modelValue:y.value.stock,"onUpdate:modelValue":l[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),c(d,{label:`销售目标`},{default:a(()=>[c(S,{modelValue:y.value.target,"onUpdate:modelValue":l[4]||=e=>y.value.target=e},{default:a(()=>[c(x,{label:`最大化利润`,value:`profit`}),c(x,{label:`快速清仓`,value:`clearance`}),c(x,{label:`提升销量`,value:`volume`}),c(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),c(d,null,{default:a(()=>[c(C,{type:`primary`,onClick:b,loading:_.value},{default:a(()=>[...l[5]||=[i(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(o(),e(`div`,h,[l[6]||=t(`h4`,null,`💡 定价建议`,-1),t(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):n(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};