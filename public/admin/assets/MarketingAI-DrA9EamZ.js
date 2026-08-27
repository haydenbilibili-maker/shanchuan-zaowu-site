import{En as e,On as t,Xt as n,_n as r,an as i,en as a,gn as o,hn as s,nn as c,on as l,r as u,rn as d,wn as f,xn as p}from"./element-plus-CxgvyxlJ.js";import{v as m,x as h,y as g}from"./index-C4Kukjd4.js";var _={class:`marketing-ai`},v={class:`marketing-tabs`},y=[`onClick`],b={key:0,class:`content-gen`},x=[`innerHTML`],S={key:1,class:`ad-strategy`},C=[`innerHTML`],w=[`innerHTML`],T={key:2,class:`seo-optimize`},E=[`innerHTML`],D=m({__name:`MarketingAI`,props:{feature:Object},setup(m){let D=f(`content`),O=f(!1),k=f(!1),A=f(!1),j=f(!1),M=f(``),N=f(``),P=f(``),F=f(``),I=f({type:`xiaohongshu`,topic:``,style:``}),L=f({productName:``,currentTitle:``}),R=[{id:`content`,name:`内容创作`,icon:`✍️`},{id:`ad`,name:`广告策略`,icon:`📢`},{id:`seo`,name:`SEO优化`,icon:`🔍`}],z=async()=>{if(!I.value.topic){u.warning(`请输入产品/主题`);return}O.value=!0;try{let e={xiaohongshu:`小红书种草文案`,wechat:`朋友圈文案`,product:`产品描述`,poster:`活动海报文案`}[I.value.type],t=await h(`请为"${I.value.topic}"生成${e}。

${I.value.style?`风格要求：${I.value.style}`:``}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${e}的写作风格
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播

请生成3个不同版本供选择。`,{systemInstruction:`你是一位资深的内容创作专家，擅长撰写各种营销文案`,temperature:.9});M.value=g.parse(t)}catch(e){u.error(`生成失败：`+e.message)}finally{O.value=!1}},B=async()=>{k.value=!0;try{let e=await h(`请分析线上广告投放效果，提供：
1. 关键指标分析（点击率、转化率、ROI等）
2. 表现好的广告特征
3. 表现差的广告问题
4. 优化建议`,{systemInstruction:`你是一位数字营销专家，擅长广告效果分析`,temperature:.8});N.value=g.parse(e)}catch(e){u.error(`分析失败：`+e.message)}finally{k.value=!1}},V=async()=>{A.value=!0;try{let e=await h(`请提供广告投放优化策略：
1. 最佳投放时段
2. 目标人群定位
3. 广告创意建议
4. 预算分配建议
5. A/B测试方案`,{systemInstruction:`你是一位广告策略优化专家`,temperature:.8});P.value=g.parse(e)}catch(e){u.error(`优化失败：`+e.message)}finally{A.value=!1}},H=async()=>{if(!L.value.productName){u.warning(`请输入产品名称`);return}j.value=!0;try{let e=await h(`请为产品"${L.value.productName}"优化SEO：

${L.value.currentTitle?`当前标题：${L.value.currentTitle}`:``}

请提供：
1. 优化后的标题（包含核心关键词）
2. 产品描述优化建议
3. 关键词建议（主关键词+长尾关键词）
4. SEO优化要点
5. 搜索排名提升策略`,{systemInstruction:`你是一位SEO优化专家，擅长关键词研究和内容优化`,temperature:.8});F.value=g.parse(e)}catch(e){u.error(`优化失败：`+e.message)}finally{j.value=!1}};return(u,f)=>{let m=r(`el-option`),h=r(`el-select`),g=r(`el-form-item`),U=r(`el-input`),W=r(`el-button`),G=r(`el-form`);return s(),d(`div`,_,[f[9]||=a(`div`,{class:`ai-header`},[a(`h3`,null,`📱 线上营销AI助手`),a(`p`,{class:`subtitle`},`智能内容创作与营销策略优化`)],-1),a(`div`,v,[(s(),d(n,null,o(R,n=>a(`div`,{key:n.id,onClick:e=>D.value=n.id,class:e([`tab-item`,{active:D.value===n.id}])},t(n.icon)+` `+t(n.name),11,y)),64))]),D.value===`content`?(s(),d(`div`,b,[l(G,{model:I.value,"label-width":`100px`},{default:p(()=>[l(g,{label:`内容类型`},{default:p(()=>[l(h,{modelValue:I.value.type,"onUpdate:modelValue":f[0]||=e=>I.value.type=e},{default:p(()=>[l(m,{label:`小红书文案`,value:`xiaohongshu`}),l(m,{label:`朋友圈文案`,value:`wechat`}),l(m,{label:`产品描述`,value:`product`}),l(m,{label:`活动海报文案`,value:`poster`})]),_:1},8,[`modelValue`])]),_:1}),l(g,{label:`产品/主题`},{default:p(()=>[l(U,{modelValue:I.value.topic,"onUpdate:modelValue":f[1]||=e=>I.value.topic=e,placeholder:`输入产品名称或主题`},null,8,[`modelValue`])]),_:1}),l(g,{label:`风格要求`},{default:p(()=>[l(U,{modelValue:I.value.style,"onUpdate:modelValue":f[2]||=e=>I.value.style=e,placeholder:`如：自然、文艺、专业等`},null,8,[`modelValue`])]),_:1}),l(g,null,{default:p(()=>[l(W,{type:`primary`,onClick:z,loading:O.value},{default:p(()=>[...f[5]||=[i(` 生成内容 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),M.value?(s(),d(`div`,{key:0,class:`result-box`,innerHTML:M.value},null,8,x)):c(``,!0)])):c(``,!0),D.value===`ad`?(s(),d(`div`,S,[l(W,{type:`primary`,onClick:B,loading:k.value},{default:p(()=>[...f[6]||=[i(`分析广告效果`,-1)]]),_:1},8,[`loading`]),l(W,{type:`primary`,onClick:V,loading:A.value},{default:p(()=>[...f[7]||=[i(`优化投放策略`,-1)]]),_:1},8,[`loading`]),N.value?(s(),d(`div`,{key:0,class:`result-box`,innerHTML:N.value},null,8,C)):c(``,!0),P.value?(s(),d(`div`,{key:1,class:`result-box`,innerHTML:P.value},null,8,w)):c(``,!0)])):c(``,!0),D.value===`seo`?(s(),d(`div`,T,[l(G,{model:L.value,"label-width":`120px`},{default:p(()=>[l(g,{label:`产品名称`},{default:p(()=>[l(U,{modelValue:L.value.productName,"onUpdate:modelValue":f[3]||=e=>L.value.productName=e},null,8,[`modelValue`])]),_:1}),l(g,{label:`当前标题`},{default:p(()=>[l(U,{modelValue:L.value.currentTitle,"onUpdate:modelValue":f[4]||=e=>L.value.currentTitle=e},null,8,[`modelValue`])]),_:1}),l(g,null,{default:p(()=>[l(W,{type:`primary`,onClick:H,loading:j.value},{default:p(()=>[...f[8]||=[i(` 优化SEO `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(s(),d(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,E)):c(``,!0)])):c(``,!0)])}}},[[`__scopeId`,`data-v-c5e64ba1`]]);export{D as default};