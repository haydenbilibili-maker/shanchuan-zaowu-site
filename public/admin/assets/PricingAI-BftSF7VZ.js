import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,y as p}from"./index-nwDdqFlp.js";var m={class:`pricing-ai`},h={class:`pricing-form`},g={key:0,class:`result-card`},_=[`innerHTML`],v=f({__name:`PricingAI`,props:{feature:Object},setup(e){let f=o(!1),v=o(``),y=o({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){l.warning(`请填写商品信息`);return}f.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await p(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=d.parse(t)}catch(e){l.error(`生成建议失败：`+e.message)}finally{f.value=!1}};return(e,o)=>{let l=s(`el-input`),d=s(`el-form-item`),p=s(`el-input-number`),x=s(`el-option`),S=s(`el-select`),C=s(`el-button`),w=s(`el-form`);return u(),i(`div`,m,[o[7]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`💰 动态定价优化`),n(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),n(`div`,h,[a(w,{model:y.value,"label-width":`120px`},{default:c(()=>[a(d,{label:`商品名称`},{default:c(()=>[a(l,{modelValue:y.value.productName,"onUpdate:modelValue":o[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),a(d,{label:`当前价格`},{default:c(()=>[a(p,{modelValue:y.value.currentPrice,"onUpdate:modelValue":o[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),a(d,{label:`成本价格`},{default:c(()=>[a(p,{modelValue:y.value.costPrice,"onUpdate:modelValue":o[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),a(d,{label:`库存数量`},{default:c(()=>[a(p,{modelValue:y.value.stock,"onUpdate:modelValue":o[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),a(d,{label:`销售目标`},{default:c(()=>[a(S,{modelValue:y.value.target,"onUpdate:modelValue":o[4]||=e=>y.value.target=e},{default:c(()=>[a(x,{label:`最大化利润`,value:`profit`}),a(x,{label:`快速清仓`,value:`clearance`}),a(x,{label:`提升销量`,value:`volume`}),a(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),a(d,null,{default:c(()=>[a(C,{type:`primary`,onClick:b,loading:f.value},{default:c(()=>[...o[5]||=[t(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(u(),i(`div`,g,[o[6]||=n(`h4`,null,`💡 定价建议`,-1),n(`div`,{class:`result-content`,innerHTML:v.value},null,8,_)])):r(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{v as default};