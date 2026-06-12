import{$t as e,Jt as t,Wt as n,Xt as r,Zt as i,_n as a,cn as o,en as s,ln as c,mn as l,r as u,un as d,xn as f,yn as p}from"./element-plus-CVfHhcL0.js";import{_ as m,h,m as g}from"./index-D_jnvNgu.js";var _={class:`marketing-ai`},v={class:`marketing-tabs`},y=[`onClick`],b={key:0,class:`content-gen`},x=[`innerHTML`],S={key:1,class:`ad-strategy`},C=[`innerHTML`],w=[`innerHTML`],T={key:2,class:`seo-optimize`},E=[`innerHTML`],D=g({__name:`MarketingAI`,props:{feature:Object},setup(g){let D=a(`content`),O=a(!1),k=a(!1),A=a(!1),j=a(!1),M=a(``),N=a(``),P=a(``),F=a(``),I=a({type:`xiaohongshu`,topic:``,style:``}),L=a({productName:``,currentTitle:``}),R=[{id:`content`,name:`内容创作`,icon:`✍️`},{id:`ad`,name:`广告策略`,icon:`📢`},{id:`seo`,name:`SEO优化`,icon:`🔍`}],z=async()=>{if(!I.value.topic){u.warning(`请输入产品/主题`);return}O.value=!0;try{let e={xiaohongshu:`小红书种草文案`,wechat:`朋友圈文案`,product:`产品描述`,poster:`活动海报文案`}[I.value.type],t=await m(`请为"${I.value.topic}"生成${e}。

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
5. 搜索排名提升策略`,{systemInstruction:`你是一位SEO优化专家，擅长关键词研究和内容优化`,temperature:.8});F.value=h.parse(e)}catch(e){u.error(`优化失败：`+e.message)}finally{j.value=!1}};return(a,u)=>{let m=d(`el-option`),h=d(`el-select`),g=d(`el-form-item`),U=d(`el-input`),W=d(`el-button`),G=d(`el-form`);return o(),i(`div`,_,[u[9]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`📱 线上营销AI助手`),t(`p`,{class:`subtitle`},`智能内容创作与营销策略优化`)],-1),t(`div`,v,[(o(),i(n,null,c(R,e=>t(`div`,{key:e.id,onClick:t=>D.value=e.id,class:p([`tab-item`,{active:D.value===e.id}])},f(e.icon)+` `+f(e.name),11,y)),64))]),D.value===`content`?(o(),i(`div`,b,[s(G,{model:I.value,"label-width":`100px`},{default:l(()=>[s(g,{label:`内容类型`},{default:l(()=>[s(h,{modelValue:I.value.type,"onUpdate:modelValue":u[0]||=e=>I.value.type=e},{default:l(()=>[s(m,{label:`小红书文案`,value:`xiaohongshu`}),s(m,{label:`朋友圈文案`,value:`wechat`}),s(m,{label:`产品描述`,value:`product`}),s(m,{label:`活动海报文案`,value:`poster`})]),_:1},8,[`modelValue`])]),_:1}),s(g,{label:`产品/主题`},{default:l(()=>[s(U,{modelValue:I.value.topic,"onUpdate:modelValue":u[1]||=e=>I.value.topic=e,placeholder:`输入产品名称或主题`},null,8,[`modelValue`])]),_:1}),s(g,{label:`风格要求`},{default:l(()=>[s(U,{modelValue:I.value.style,"onUpdate:modelValue":u[2]||=e=>I.value.style=e,placeholder:`如：自然、文艺、专业等`},null,8,[`modelValue`])]),_:1}),s(g,null,{default:l(()=>[s(W,{type:`primary`,onClick:z,loading:O.value},{default:l(()=>[...u[5]||=[e(` 生成内容 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),M.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:M.value},null,8,x)):r(``,!0)])):r(``,!0),D.value===`ad`?(o(),i(`div`,S,[s(W,{type:`primary`,onClick:B,loading:k.value},{default:l(()=>[...u[6]||=[e(`分析广告效果`,-1)]]),_:1},8,[`loading`]),s(W,{type:`primary`,onClick:V,loading:A.value},{default:l(()=>[...u[7]||=[e(`优化投放策略`,-1)]]),_:1},8,[`loading`]),N.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:N.value},null,8,C)):r(``,!0),P.value?(o(),i(`div`,{key:1,class:`result-box`,innerHTML:P.value},null,8,w)):r(``,!0)])):r(``,!0),D.value===`seo`?(o(),i(`div`,T,[s(G,{model:L.value,"label-width":`120px`},{default:l(()=>[s(g,{label:`产品名称`},{default:l(()=>[s(U,{modelValue:L.value.productName,"onUpdate:modelValue":u[3]||=e=>L.value.productName=e},null,8,[`modelValue`])]),_:1}),s(g,{label:`当前标题`},{default:l(()=>[s(U,{modelValue:L.value.currentTitle,"onUpdate:modelValue":u[4]||=e=>L.value.currentTitle=e},null,8,[`modelValue`])]),_:1}),s(g,null,{default:l(()=>[s(W,{type:`primary`,onClick:H,loading:j.value},{default:l(()=>[...u[8]||=[e(` 优化SEO `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,E)):r(``,!0)])):r(``,!0)])}}},[[`__scopeId`,`data-v-c5e64ba1`]]);export{D as default};