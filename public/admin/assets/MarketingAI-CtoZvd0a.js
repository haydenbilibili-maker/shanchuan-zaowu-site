import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Wt as r,Xt as i,Zt as a,bn as o,cn as s,en as c,gn as l,ln as u,pn as d,r as f,sn as p,vn as m}from"./element-plus-Bnc69kxf.js";import{_ as h,g,y as _}from"./index-nwDdqFlp.js";var v={class:`marketing-ai`},y={class:`marketing-tabs`},b=[`onClick`],x={key:0,class:`content-gen`},S=[`innerHTML`],C={key:1,class:`ad-strategy`},w=[`innerHTML`],T=[`innerHTML`],E={key:2,class:`seo-optimize`},D=[`innerHTML`],O=g({__name:`MarketingAI`,props:{feature:Object},setup(e){let g=l(`content`),O=l(!1),k=l(!1),A=l(!1),j=l(!1),M=l(``),N=l(``),P=l(``),F=l(``),I=l({type:`xiaohongshu`,topic:``,style:``}),L=l({productName:``,currentTitle:``}),R=[{id:`content`,name:`内容创作`,icon:`✍️`},{id:`ad`,name:`广告策略`,icon:`📢`},{id:`seo`,name:`SEO优化`,icon:`🔍`}],z=async()=>{if(!I.value.topic){f.warning(`请输入产品/主题`);return}O.value=!0;try{let e={xiaohongshu:`小红书种草文案`,wechat:`朋友圈文案`,product:`产品描述`,poster:`活动海报文案`}[I.value.type],t=await _(`请为"${I.value.topic}"生成${e}。

${I.value.style?`风格要求：${I.value.style}`:``}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${e}的写作风格
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播

请生成3个不同版本供选择。`,{systemInstruction:`你是一位资深的内容创作专家，擅长撰写各种营销文案`,temperature:.9});M.value=h.parse(t)}catch(e){f.error(`生成失败：`+e.message)}finally{O.value=!1}},B=async()=>{k.value=!0;try{let e=await _(`请分析线上广告投放效果，提供：
1. 关键指标分析（点击率、转化率、ROI等）
2. 表现好的广告特征
3. 表现差的广告问题
4. 优化建议`,{systemInstruction:`你是一位数字营销专家，擅长广告效果分析`,temperature:.8});N.value=h.parse(e)}catch(e){f.error(`分析失败：`+e.message)}finally{k.value=!1}},V=async()=>{A.value=!0;try{let e=await _(`请提供广告投放优化策略：
1. 最佳投放时段
2. 目标人群定位
3. 广告创意建议
4. 预算分配建议
5. A/B测试方案`,{systemInstruction:`你是一位广告策略优化专家`,temperature:.8});P.value=h.parse(e)}catch(e){f.error(`优化失败：`+e.message)}finally{A.value=!1}},H=async()=>{if(!L.value.productName){f.warning(`请输入产品名称`);return}j.value=!0;try{let e=await _(`请为产品"${L.value.productName}"优化SEO：

${L.value.currentTitle?`当前标题：${L.value.currentTitle}`:``}

请提供：
1. 优化后的标题（包含核心关键词）
2. 产品描述优化建议
3. 关键词建议（主关键词+长尾关键词）
4. SEO优化要点
5. 搜索排名提升策略`,{systemInstruction:`你是一位SEO优化专家，擅长关键词研究和内容优化`,temperature:.8});F.value=h.parse(e)}catch(e){f.error(`优化失败：`+e.message)}finally{j.value=!1}};return(e,l)=>{let f=u(`el-option`),h=u(`el-select`),_=u(`el-form-item`),U=u(`el-input`),W=u(`el-button`),G=u(`el-form`);return p(),a(`div`,v,[l[9]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📱 线上营销AI助手`),n(`p`,{class:`subtitle`},`智能内容创作与营销策略优化`)],-1),n(`div`,y,[(p(),a(r,null,s(R,e=>n(`div`,{key:e.id,onClick:t=>g.value=e.id,class:m([`tab-item`,{active:g.value===e.id}])},o(e.icon)+` `+o(e.name),11,b)),64))]),g.value===`content`?(p(),a(`div`,x,[c(G,{model:I.value,"label-width":`100px`},{default:d(()=>[c(_,{label:`内容类型`},{default:d(()=>[c(h,{modelValue:I.value.type,"onUpdate:modelValue":l[0]||=e=>I.value.type=e},{default:d(()=>[c(f,{label:`小红书文案`,value:`xiaohongshu`}),c(f,{label:`朋友圈文案`,value:`wechat`}),c(f,{label:`产品描述`,value:`product`}),c(f,{label:`活动海报文案`,value:`poster`})]),_:1},8,[`modelValue`])]),_:1}),c(_,{label:`产品/主题`},{default:d(()=>[c(U,{modelValue:I.value.topic,"onUpdate:modelValue":l[1]||=e=>I.value.topic=e,placeholder:`输入产品名称或主题`},null,8,[`modelValue`])]),_:1}),c(_,{label:`风格要求`},{default:d(()=>[c(U,{modelValue:I.value.style,"onUpdate:modelValue":l[2]||=e=>I.value.style=e,placeholder:`如：自然、文艺、专业等`},null,8,[`modelValue`])]),_:1}),c(_,null,{default:d(()=>[c(W,{type:`primary`,onClick:z,loading:O.value},{default:d(()=>[...l[5]||=[t(` 生成内容 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),M.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:M.value},null,8,S)):i(``,!0)])):i(``,!0),g.value===`ad`?(p(),a(`div`,C,[c(W,{type:`primary`,onClick:B,loading:k.value},{default:d(()=>[...l[6]||=[t(`分析广告效果`,-1)]]),_:1},8,[`loading`]),c(W,{type:`primary`,onClick:V,loading:A.value},{default:d(()=>[...l[7]||=[t(`优化投放策略`,-1)]]),_:1},8,[`loading`]),N.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:N.value},null,8,w)):i(``,!0),P.value?(p(),a(`div`,{key:1,class:`result-box`,innerHTML:P.value},null,8,T)):i(``,!0)])):i(``,!0),g.value===`seo`?(p(),a(`div`,E,[c(G,{model:L.value,"label-width":`120px`},{default:d(()=>[c(_,{label:`产品名称`},{default:d(()=>[c(U,{modelValue:L.value.productName,"onUpdate:modelValue":l[3]||=e=>L.value.productName=e},null,8,[`modelValue`])]),_:1}),c(_,{label:`当前标题`},{default:d(()=>[c(U,{modelValue:L.value.currentTitle,"onUpdate:modelValue":l[4]||=e=>L.value.currentTitle=e},null,8,[`modelValue`])]),_:1}),c(_,null,{default:d(()=>[c(W,{type:`primary`,onClick:H,loading:j.value},{default:d(()=>[...l[8]||=[t(` 优化SEO `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,D)):i(``,!0)])):i(``,!0)])}}},[[`__scopeId`,`data-v-c5e64ba1`]]);export{O as default};