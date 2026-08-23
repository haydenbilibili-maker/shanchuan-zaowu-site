import{_n as e,an as t,en as n,hn as r,nn as i,on as a,r as o,rn as s,wn as c,xn as l}from"./element-plus-CxgvyxlJ.js";import{v as u,x as d,y as f}from"./index-y_f8PkF7.js";var p={class:`pricing-ai`},m={class:`pricing-form`},h={key:0,class:`result-card`},g=[`innerHTML`],_=u({__name:`PricingAI`,props:{feature:Object},setup(u){let _=c(!1),v=c(``),y=c({productName:``,currentPrice:0,costPrice:0,stock:0,target:`profit`}),b=async()=>{if(!y.value.productName||!y.value.currentPrice){o.warning(`请填写商品信息`);return}_.value=!0;try{let e={profit:`最大化利润`,clearance:`快速清仓`,volume:`提升销量`,competitive:`保持竞争力`}[y.value.target],t=await d(`请为以下商品提供定价优化建议：

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
5. 分阶段定价策略（如适用）`,{systemInstruction:`你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价`,temperature:.8});v.value=f.parse(t)}catch(e){o.error(`生成建议失败：`+e.message)}finally{_.value=!1}};return(o,c)=>{let u=e(`el-input`),d=e(`el-form-item`),f=e(`el-input-number`),x=e(`el-option`),S=e(`el-select`),C=e(`el-button`),w=e(`el-form`);return r(),s(`div`,p,[c[7]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`💰 动态定价优化`),n(`p`,{class:`subtitle`},`AI驱动的智能定价策略`)],-1),n(`div`,m,[a(w,{model:y.value,"label-width":`120px`},{default:l(()=>[a(d,{label:`商品名称`},{default:l(()=>[a(u,{modelValue:y.value.productName,"onUpdate:modelValue":c[0]||=e=>y.value.productName=e,placeholder:`输入商品名称`},null,8,[`modelValue`])]),_:1}),a(d,{label:`当前价格`},{default:l(()=>[a(f,{modelValue:y.value.currentPrice,"onUpdate:modelValue":c[1]||=e=>y.value.currentPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),a(d,{label:`成本价格`},{default:l(()=>[a(f,{modelValue:y.value.costPrice,"onUpdate:modelValue":c[2]||=e=>y.value.costPrice=e,min:0,precision:2},null,8,[`modelValue`])]),_:1}),a(d,{label:`库存数量`},{default:l(()=>[a(f,{modelValue:y.value.stock,"onUpdate:modelValue":c[3]||=e=>y.value.stock=e,min:0},null,8,[`modelValue`])]),_:1}),a(d,{label:`销售目标`},{default:l(()=>[a(S,{modelValue:y.value.target,"onUpdate:modelValue":c[4]||=e=>y.value.target=e},{default:l(()=>[a(x,{label:`最大化利润`,value:`profit`}),a(x,{label:`快速清仓`,value:`clearance`}),a(x,{label:`提升销量`,value:`volume`}),a(x,{label:`保持竞争力`,value:`competitive`})]),_:1},8,[`modelValue`])]),_:1}),a(d,null,{default:l(()=>[a(C,{type:`primary`,onClick:b,loading:_.value},{default:l(()=>[...c[5]||=[t(` 生成定价建议 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`])]),v.value?(r(),s(`div`,h,[c[6]||=n(`h4`,null,`💡 定价建议`,-1),n(`div`,{class:`result-content`,innerHTML:v.value},null,8,g)])):i(``,!0)])}}},[[`__scopeId`,`data-v-a09ecf55`]]);export{_ as default};