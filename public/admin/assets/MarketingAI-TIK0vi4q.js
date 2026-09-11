import{En as e,Nn as t,Sn as n,bn as r,dn as i,en as a,in as o,jn as s,kn as c,on as l,r as u,sn as d,un as f,xn as p}from"./element-plus-CxrabTdB.js";import{F as m,N as h,W as g}from"./index-f_ff-r67.js";var _={class:`marketing-ai`},v={class:`marketing-tabs`},y=[`onClick`],b={key:0,class:`content-gen`},x=[`innerHTML`],S={key:1,class:`ad-strategy`},C=[`innerHTML`],w=[`innerHTML`],T={key:2,class:`seo-optimize`},E=[`innerHTML`],D=g({__name:`MarketingAI`,props:{feature:Object},setup(g){let D=c(`content`),O=c(!1),k=c(!1),A=c(!1),j=c(!1),M=c(``),N=c(``),P=c(``),F=c(``),I=c({type:`xiaohongshu`,topic:``,style:``}),L=c({productName:``,currentTitle:``}),R=[{id:`content`,name:`内容创作`,icon:`✍️`},{id:`ad`,name:`广告策略`,icon:`📢`},{id:`seo`,name:`SEO优化`,icon:`🔍`}],z=async()=>{if(!I.value.topic){u.warning(`请输入产品/主题`);return}O.value=!0;try{let e={xiaohongshu:`小红书种草文案`,wechat:`朋友圈文案`,product:`产品描述`,poster:`活动海报文案`}[I.value.type],t=await m(`请为"${I.value.topic}"生成${e}。

${I.value.style?`风格要求：${I.value.style}`:``}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${e}的写作风格
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播

请生成3个不同版本供选择。`,{systemInstruction:`你是一位资深的内容创作专家，擅长撰写各种营销文案`,temperature:.9});M.value=h.parse(t)}catch(e){u.error(`生成失败：`+e.message)}finally{O.value=!1}},B=async()=>{k.value=!0;try{let e=await m(`请分析线上广告投放效果，提供：
1. 关键指标分析（点击率、转化率、ROI等）
2. 表现好的广告特征
3. 表现差的广告问题
4. 优化建议`,{systemInstruction:`你是一位数字营销专家，擅长广告效果分析`,temperature:.8});N.value=h.parse(e)}catch(e){u.error(`分析失败：`+e.message)}finally{k.value=!1}},V=async()=>{A.value=!0;try{let e=await m(`请提供广告投放优化策略：
1. 最佳投放时段
2. 目标人群定位
3. 广告创意建议
4. 预算分配建议
5. A/B测试方案`,{systemInstruction:`你是一位广告策略优化专家`,temperature:.8});P.value=h.parse(e)}catch(e){u.error(`优化失败：`+e.message)}finally{A.value=!1}},H=async()=>{if(!L.value.productName){u.warning(`请输入产品名称`);return}j.value=!0;try{let e=await m(`请为产品"${L.value.productName}"优化SEO：

${L.value.currentTitle?`当前标题：${L.value.currentTitle}`:``}

请提供：
1. 优化后的标题（包含核心关键词）
2. 产品描述优化建议
3. 关键词建议（主关键词+长尾关键词）
4. SEO优化要点
5. 搜索排名提升策略`,{systemInstruction:`你是一位SEO优化专家，擅长关键词研究和内容优化`,temperature:.8});F.value=h.parse(e)}catch(e){u.error(`优化失败：`+e.message)}finally{j.value=!1}};return(c,u)=>{let m=n(`el-option`),h=n(`el-select`),g=n(`el-form-item`),U=n(`el-input`),W=n(`el-button`),G=n(`el-form`);return r(),d(`div`,_,[u[9]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`📱 线上营销AI助手`),o(`p`,{class:`subtitle`},`智能内容创作与营销策略优化`)],-1),o(`div`,v,[(r(),d(a,null,p(R,e=>o(`div`,{key:e.id,onClick:t=>D.value=e.id,class:s([`tab-item`,{active:D.value===e.id}])},t(e.icon)+` `+t(e.name),11,y)),64))]),D.value===`content`?(r(),d(`div`,b,[i(G,{model:I.value,"label-width":`100px`},{default:e(()=>[i(g,{label:`内容类型`},{default:e(()=>[i(h,{modelValue:I.value.type,"onUpdate:modelValue":u[0]||=e=>I.value.type=e},{default:e(()=>[i(m,{label:`小红书文案`,value:`xiaohongshu`}),i(m,{label:`朋友圈文案`,value:`wechat`}),i(m,{label:`产品描述`,value:`product`}),i(m,{label:`活动海报文案`,value:`poster`})]),_:1},8,[`modelValue`])]),_:1}),i(g,{label:`产品/主题`},{default:e(()=>[i(U,{modelValue:I.value.topic,"onUpdate:modelValue":u[1]||=e=>I.value.topic=e,placeholder:`输入产品名称或主题`},null,8,[`modelValue`])]),_:1}),i(g,{label:`风格要求`},{default:e(()=>[i(U,{modelValue:I.value.style,"onUpdate:modelValue":u[2]||=e=>I.value.style=e,placeholder:`如：自然、文艺、专业等`},null,8,[`modelValue`])]),_:1}),i(g,null,{default:e(()=>[i(W,{type:`primary`,onClick:z,loading:O.value},{default:e(()=>[...u[5]||=[f(` 生成内容 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),M.value?(r(),d(`div`,{key:0,class:`result-box`,innerHTML:M.value},null,8,x)):l(``,!0)])):l(``,!0),D.value===`ad`?(r(),d(`div`,S,[i(W,{type:`primary`,onClick:B,loading:k.value},{default:e(()=>[...u[6]||=[f(`分析广告效果`,-1)]]),_:1},8,[`loading`]),i(W,{type:`primary`,onClick:V,loading:A.value},{default:e(()=>[...u[7]||=[f(`优化投放策略`,-1)]]),_:1},8,[`loading`]),N.value?(r(),d(`div`,{key:0,class:`result-box`,innerHTML:N.value},null,8,C)):l(``,!0),P.value?(r(),d(`div`,{key:1,class:`result-box`,innerHTML:P.value},null,8,w)):l(``,!0)])):l(``,!0),D.value===`seo`?(r(),d(`div`,T,[i(G,{model:L.value,"label-width":`120px`},{default:e(()=>[i(g,{label:`产品名称`},{default:e(()=>[i(U,{modelValue:L.value.productName,"onUpdate:modelValue":u[3]||=e=>L.value.productName=e},null,8,[`modelValue`])]),_:1}),i(g,{label:`当前标题`},{default:e(()=>[i(U,{modelValue:L.value.currentTitle,"onUpdate:modelValue":u[4]||=e=>L.value.currentTitle=e},null,8,[`modelValue`])]),_:1}),i(g,null,{default:e(()=>[i(W,{type:`primary`,onClick:H,loading:j.value},{default:e(()=>[...u[8]||=[f(` 优化SEO `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(r(),d(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,E)):l(``,!0)])):l(``,!0)])}}},[[`__scopeId`,`data-v-c5e64ba1`]]);export{D as default};