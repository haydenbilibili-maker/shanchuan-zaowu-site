import{Jt as e,Xt as t,Zt as n,en as r,fn as i,gn as a,r as o,tn as s,un as c,yn as l}from"./element-plus-CVSIbaOo.js";import{F as u,N as d,W as f}from"./index-CI6Tt0gS.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`PricingAI`,props:{feature:Object},setup(f){let _=l(!1),v=l(``),y=l({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){o.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await u(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=d.parse(t)}catch(e){o.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(o,l)=>{let u=i(`el-input`),d=i(`el-form-item`),f=i(`el-input-number`),x=i(`el-option`),S=i(`el-select`),C=i(`el-button`),w=i(`el-form`);return c(),n(`div`,p,[l[7]||=e(`div`,{class:`ai-header`},[e(`h3`,null,`💰 动态定价优化`),e(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),e(`div`,m,[s(w,{model:y.value,"label-width":`120px`},{default:a(()=>[s(d,{label:`商品名称`},{default:a(()=>[s(u,{modelValue:y.value.productName,"onUpdate:modelValue":l[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),s(d,{label:`当前价格`},{default:a(()=>[s(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":l[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),s(d,{label:`成本价格`},{default:a(()=>[s(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":l[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),s(d,{label:`库存数量`},{default:a(()=>[s(f,{modelValue:y.value.stock,"onUpdate:modelValue":l[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),s(d,{label:`销售目标`},{default:a(()=>[s(S,{modelValue:y.value.target,"onUpdate:modelValue":l[4]||=e=>y.value.target=e},{default:a(()=>[s(x,{label:`最大化利润`,value:`profit`}),s(x,{label:`快速清仓`,value:`clearance`}),s(x,{label:`提升销量`,value:`volume`}),s(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),s(d,null,{default:a(()=>[s(C,{type:`primary`,onClick:b,loading:_.value},{default:a(()=>[...l[5]||=[r(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(c(),n(`div`,h,[l[6]||=e(`h4`,null,`💡 定价建议`,-1),e(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):t(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};