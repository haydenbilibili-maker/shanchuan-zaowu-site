import{Cn as e,In as t,Mn as n,Pn as r,Tn as i,kn as a,ln as o,mn as s,pn as c,r as l,rn as u,sn as d,un as f,wn as p}from"./element-plus-BG1-t9RV.js";import{F as m,N as h,W as g}from"./index-xE0iZrEm.js";var _={class:`marketing-ai`},v={class:`marketing-tabs`},y=[`onClick`],b={key:0,class:`content-gen`},x=[`innerHTML`],S={key:1,class:`ad-strategy`},C=[`innerHTML`],w=[`innerHTML`],T={key:2,class:`seo-optimize`},E=[`innerHTML`],D=g({__name:`MarketingAI`,props:{feature:Object},setup(g){let D=n(`content`),O=n(!1),k=n(!1),A=n(!1),j=n(!1),M=n(``),N=n(``),P=n(``),F=n(``),I=n({type:`xiaohongshu`,topic:``,style:``}),L=n({productName:``,currentTitle:``}),R=[{id:`content`,name:`内容创作`,icon:`✍️`},{id:`ad`,name:`广告策略`,icon:`📢`},{id:`seo`,name:`SEO优化`,icon:`🔍`}],z=async()=>{if(!I.value.topic){l.warning(`请输入产品/主题`);return}O.value=!0;try{let e={xiaohongshu:`小红书种草文案`,wechat:`朋友圈文案`,product:`产品描述`,poster:`活动海报文案`}[I.value.type],t=await m(`请为"${I.value.topic}"生成${e}。

${I.value.style?`风格要求：${I.value.style}`:``}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${e}的写作风格
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播

请生成3个不同版本供选择。`,{systemInstruction:`你是一位资深的内容创作专家，擅长撰写各种营销文案`,temperature:.9});M.value=h.parse(t)}catch(e){l.error(`生成失败：`+e.message)}finally{O.value=!1}},B=async()=>{k.value=!0;try{let e=await m(`请分析线上广告投放效果，提供：
1. 关键指标分析（点击率、转化率、ROI等）
2. 表现好的广告特征
3. 表现差的广告问题
4. 优化建议`,{systemInstruction:`你是一位数字营销专家，擅长广告效果分析`,temperature:.8});N.value=h.parse(e)}catch(e){l.error(`分析失败：`+e.message)}finally{k.value=!1}},V=async()=>{A.value=!0;try{let e=await m(`请提供广告投放优化策略：
1. 最佳投放时段
2. 目标人群定位
3. 广告创意建议
4. 预算分配建议
5. A/B测试方案`,{systemInstruction:`你是一位广告策略优化专家`,temperature:.8});P.value=h.parse(e)}catch(e){l.error(`优化失败：`+e.message)}finally{A.value=!1}},H=async()=>{if(!L.value.productName){l.warning(`请输入产品名称`);return}j.value=!0;try{let e=await m(`请为产品"${L.value.productName}"优化SEO：

${L.value.currentTitle?`当前标题：${L.value.currentTitle}`:``}

请提供：
1. 优化后的标题（包含核心关键词）
2. 产品描述优化建议
3. 关键词建议（主关键词+长尾关键词）
4. SEO优化要点
5. 搜索排名提升策略`,{systemInstruction:`你是一位SEO优化专家，擅长关键词研究和内容优化`,temperature:.8});F.value=h.parse(e)}catch(e){l.error(`优化失败：`+e.message)}finally{j.value=!1}};return(n,l)=>{let m=i(`el-option`),h=i(`el-select`),g=i(`el-form-item`),U=i(`el-input`),W=i(`el-button`),G=i(`el-form`);return e(),f(`div`,_,[l[9]||=d(`div`,{class:`ai-header`},[d(`h3`,null,`📱 线上营销AI助手`),d(`p`,{class:`subtitle`},`智能内容创作与营销策略优化`)],-1),d(`div`,v,[(e(),f(u,null,p(R,e=>d(`div`,{key:e.id,onClick:t=>D.value=e.id,class:r([`tab-item`,{active:D.value===e.id}])},t(e.icon)+` `+t(e.name),11,y)),64))]),D.value===`content`?(e(),f(`div`,b,[s(G,{model:I.value,"label-width":`100px`},{default:a(()=>[s(g,{label:`内容类型`},{default:a(()=>[s(h,{modelValue:I.value.type,"onUpdate:modelValue":l[0]||=e=>I.value.type=e},{default:a(()=>[s(m,{label:`小红书文案`,value:`xiaohongshu`}),s(m,{label:`朋友圈文案`,value:`wechat`}),s(m,{label:`产品描述`,value:`product`}),s(m,{label:`活动海报文案`,value:`poster`})]),_:1},8,[`modelValue`])]),_:1}),s(g,{label:`产品/主题`},{default:a(()=>[s(U,{modelValue:I.value.topic,"onUpdate:modelValue":l[1]||=e=>I.value.topic=e,placeholder:`输入产品名称或主题`},null,8,[`modelValue`])]),_:1}),s(g,{label:`风格要求`},{default:a(()=>[s(U,{modelValue:I.value.style,"onUpdate:modelValue":l[2]||=e=>I.value.style=e,placeholder:`如：自然、文艺、专业等`},null,8,[`modelValue`])]),_:1}),s(g,null,{default:a(()=>[s(W,{type:`primary`,onClick:z,loading:O.value},{default:a(()=>[...l[5]||=[c(` 生成内容 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),M.value?(e(),f(`div`,{key:0,class:`result-box`,innerHTML:M.value},null,8,x)):o(``,!0)])):o(``,!0),D.value===`ad`?(e(),f(`div`,S,[s(W,{type:`primary`,onClick:B,loading:k.value},{default:a(()=>[...l[6]||=[c(`分析广告效果`,-1)]]),_:1},8,[`loading`]),s(W,{type:`primary`,onClick:V,loading:A.value},{default:a(()=>[...l[7]||=[c(`优化投放策略`,-1)]]),_:1},8,[`loading`]),N.value?(e(),f(`div`,{key:0,class:`result-box`,innerHTML:N.value},null,8,C)):o(``,!0),P.value?(e(),f(`div`,{key:1,class:`result-box`,innerHTML:P.value},null,8,w)):o(``,!0)])):o(``,!0),D.value===`seo`?(e(),f(`div`,T,[s(G,{model:L.value,"label-width":`120px`},{default:a(()=>[s(g,{label:`产品名称`},{default:a(()=>[s(U,{modelValue:L.value.productName,"onUpdate:modelValue":l[3]||=e=>L.value.productName=e},null,8,[`modelValue`])]),_:1}),s(g,{label:`当前标题`},{default:a(()=>[s(U,{modelValue:L.value.currentTitle,"onUpdate:modelValue":l[4]||=e=>L.value.currentTitle=e},null,8,[`modelValue`])]),_:1}),s(g,null,{default:a(()=>[s(W,{type:`primary`,onClick:H,loading:j.value},{default:a(()=>[...l[8]||=[c(` 优化SEO `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(e(),f(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,E)):o(``,!0)])):o(``,!0)])}}},[[`__scopeId`,`data-v-c5e64ba1`]]);export{D as default};