import{En as e,Sn as t,bn as n,dn as r,in as i,kn as a,on as o,r as s,sn as c,un as l}from"./element-plus-CxrabTdB.js";import{F as u,N as d,W as f}from"./index-f_ff-r67.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=f({__name:`PricingAI`,props:{feature:Object},setup(f){let _=a(!1),v=a(``),y=a({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){s.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await u(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=d.parse(t)}catch(e){s.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(a,s)=>{let u=t(`el-input`),d=t(`el-form-item`),f=t(`el-input-number`),x=t(`el-option`),S=t(`el-select`),C=t(`el-button`),w=t(`el-form`);return n(),c(`div`,p,[s[7]||=i(`div`,{class:`ai-header`},[i(`h3`,null,`💰 动态定价优化`),i(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),i(`div`,m,[r(w,{model:y.value,"label-width":`120px`},{default:e(()=>[r(d,{label:`商品名称`},{default:e(()=>[r(u,{modelValue:y.value.productName,"onUpdate:modelValue":s[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),r(d,{label:`当前价格`},{default:e(()=>[r(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":s[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),r(d,{label:`成本价格`},{default:e(()=>[r(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":s[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),r(d,{label:`库存数量`},{default:e(()=>[r(f,{modelValue:y.value.stock,"onUpdate:modelValue":s[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),r(d,{label:`销售目标`},{default:e(()=>[r(S,{modelValue:y.value.target,"onUpdate:modelValue":s[4]||=e=>y.value.target=e},{default:e(()=>[r(x,{label:`最大化利润`,value:`profit`}),r(x,{label:`快速清仓`,value:`clearance`}),r(x,{label:`提升销量`,value:`volume`}),r(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),r(d,null,{default:e(()=>[r(C,{type:`primary`,onClick:b,loading:_.value},{default:e(()=>[...s[5]||=[l(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(n(),c(`div`,h,[s[6]||=i(`h4`,null,`💡 定价建议`,-1),i(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):o(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};