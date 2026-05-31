import{$t as e,Jt as t,Xt as n,Zt as r,en as i,gn as a,ln as o,pn as s,r as c,sn as l}from"./element-plus-pOJ5hHBv.js";import{g as u,h as d,v as f}from"./index-DdGOKV8i.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=d({__name:`PricingAI`,props:{feature:Object},setup(d){let _=a(!1),v=a(``),y=a({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){c.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await f(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=u.parse(t)}catch(e){c.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(a,c)=>{let u=o(`el-input`),d=o(`el-form-item`),f=o(`el-input-number`),x=o(`el-option`),S=o(`el-select`),C=o(`el-button`),w=o(`el-form`);return l(),r(`div`,p,[c[7]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`💰 动态定价优化`),t(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),t(`div`,m,[i(w,{model:y.value,"label-width":`120px`},{default:s(()=>[i(d,{label:`商品名称`},{default:s(()=>[i(u,{modelValue:y.value.productName,"onUpdate:modelValue":c[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),i(d,{label:`当前价格`},{default:s(()=>[i(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":c[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),i(d,{label:`成本价格`},{default:s(()=>[i(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":c[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),i(d,{label:`库存数量`},{default:s(()=>[i(f,{modelValue:y.value.stock,"onUpdate:modelValue":c[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),i(d,{label:`销售目标`},{default:s(()=>[i(S,{modelValue:y.value.target,"onUpdate:modelValue":c[4]||=e=>y.value.target=e},{default:s(()=>[i(x,{label:`最大化利润`,value:`profit`}),i(x,{label:`快速清仓`,value:`clearance`}),i(x,{label:`提升销量`,value:`volume`}),i(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),i(d,null,{default:s(()=>[i(C,{type:`primary`,onClick:b,loading:_.value},{default:s(()=>[...c[5]||=[e(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(l(),r(`div`,h,[c[6]||=t(`h4`,null,`💡 定价建议`,-1),t(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):n(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};