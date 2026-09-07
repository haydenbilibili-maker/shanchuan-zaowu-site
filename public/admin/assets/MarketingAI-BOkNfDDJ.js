import{$t as e,An as t,Mn as n,On as r,Tn as i,an as a,bn as o,ln as s,on as c,r as l,rn as u,un as d,xn as f,yn as p}from"./element-plus-DU8uayx_.js";import{H as m,N as h,j as g}from"./index-DM-1O6Qs.js";var _={class:`marketing-ai`},v={class:`marketing-tabs`},y=[`onClick`],b={key:0,class:`content-gen`},x=[`innerHTML`],S={key:1,class:`ad-strategy`},C=[`innerHTML`],w=[`innerHTML`],T={key:2,class:`seo-optimize`},E=[`innerHTML`],D=m({__name:`MarketingAI`,props:{feature:Object},setup(m){let D=r(`content`),O=r(!1),k=r(!1),A=r(!1),j=r(!1),M=r(``),N=r(``),P=r(``),F=r(``),I=r({type:`xiaohongshu`,topic:``,style:``}),L=r({productName:``,currentTitle:``}),R=[{id:`content`,name:`内容创作`,icon:`✍️`},{id:`ad`,name:`广告策略`,icon:`📢`},{id:`seo`,name:`SEO优化`,icon:`🔍`}],z=async()=>{if(!I.value.topic){l.warning(`请输入产品/主题`);return}O.value=!0;try{let e={xiaohongshu:`小红书种草文案`,wechat:`朋友圈文案`,product:`产品描述`,poster:`活动海报文案`}[I.value.type],t=await h(`请为"${I.value.topic}"生成${e}。

${I.value.style?`风格要求：${I.value.style}`:``}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${e}的写作风格
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播

请生成3个不同版本供选择。`,{systemInstruction:`你是一位资深的内容创作专家，擅长撰写各种营销文案`,temperature:.9});M.value=g.parse(t)}catch(e){l.error(`生成失败：`+e.message)}finally{O.value=!1}},B=async()=>{k.value=!0;try{let e=await h(`请分析线上广告投放效果，提供：
1. 关键指标分析（点击率、转化率、ROI等）
2. 表现好的广告特征
3. 表现差的广告问题
4. 优化建议`,{systemInstruction:`你是一位数字营销专家，擅长广告效果分析`,temperature:.8});N.value=g.parse(e)}catch(e){l.error(`分析失败：`+e.message)}finally{k.value=!1}},V=async()=>{A.value=!0;try{let e=await h(`请提供广告投放优化策略：
1. 最佳投放时段
2. 目标人群定位
3. 广告创意建议
4. 预算分配建议
5. A/B测试方案`,{systemInstruction:`你是一位广告策略优化专家`,temperature:.8});P.value=g.parse(e)}catch(e){l.error(`优化失败：`+e.message)}finally{A.value=!1}},H=async()=>{if(!L.value.productName){l.warning(`请输入产品名称`);return}j.value=!0;try{let e=await h(`请为产品"${L.value.productName}"优化SEO：

${L.value.currentTitle?`当前标题：${L.value.currentTitle}`:``}

请提供：
1. 优化后的标题（包含核心关键词）
2. 产品描述优化建议
3. 关键词建议（主关键词+长尾关键词）
4. SEO优化要点
5. 搜索排名提升策略`,{systemInstruction:`你是一位SEO优化专家，擅长关键词研究和内容优化`,temperature:.8});F.value=g.parse(e)}catch(e){l.error(`优化失败：`+e.message)}finally{j.value=!1}};return(r,l)=>{let m=f(`el-option`),h=f(`el-select`),g=f(`el-form-item`),U=f(`el-input`),W=f(`el-button`),G=f(`el-form`);return p(),c(`div`,_,[l[9]||=u(`div`,{class:`ai-header`},[u(`h3`,null,`📱 线上营销AI助手`),u(`p`,{class:`subtitle`},`智能内容创作与营销策略优化`)],-1),u(`div`,v,[(p(),c(e,null,o(R,e=>u(`div`,{key:e.id,onClick:t=>D.value=e.id,class:t([`tab-item`,{active:D.value===e.id}])},n(e.icon)+` `+n(e.name),11,y)),64))]),D.value===`content`?(p(),c(`div`,b,[d(G,{model:I.value,"label-width":`100px`},{default:i(()=>[d(g,{label:`内容类型`},{default:i(()=>[d(h,{modelValue:I.value.type,"onUpdate:modelValue":l[0]||=e=>I.value.type=e},{default:i(()=>[d(m,{label:`小红书文案`,value:`xiaohongshu`}),d(m,{label:`朋友圈文案`,value:`wechat`}),d(m,{label:`产品描述`,value:`product`}),d(m,{label:`活动海报文案`,value:`poster`})]),_:1},8,[`modelValue`])]),_:1}),d(g,{label:`产品/主题`},{default:i(()=>[d(U,{modelValue:I.value.topic,"onUpdate:modelValue":l[1]||=e=>I.value.topic=e,placeholder:`输入产品名称或主题`},null,8,[`modelValue`])]),_:1}),d(g,{label:`风格要求`},{default:i(()=>[d(U,{modelValue:I.value.style,"onUpdate:modelValue":l[2]||=e=>I.value.style=e,placeholder:`如：自然、文艺、专业等`},null,8,[`modelValue`])]),_:1}),d(g,null,{default:i(()=>[d(W,{type:`primary`,onClick:z,loading:O.value},{default:i(()=>[...l[5]||=[s(` 生成内容 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),M.value?(p(),c(`div`,{key:0,class:`result-box`,innerHTML:M.value},null,8,x)):a(``,!0)])):a(``,!0),D.value===`ad`?(p(),c(`div`,S,[d(W,{type:`primary`,onClick:B,loading:k.value},{default:i(()=>[...l[6]||=[s(`分析广告效果`,-1)]]),_:1},8,[`loading`]),d(W,{type:`primary`,onClick:V,loading:A.value},{default:i(()=>[...l[7]||=[s(`优化投放策略`,-1)]]),_:1},8,[`loading`]),N.value?(p(),c(`div`,{key:0,class:`result-box`,innerHTML:N.value},null,8,C)):a(``,!0),P.value?(p(),c(`div`,{key:1,class:`result-box`,innerHTML:P.value},null,8,w)):a(``,!0)])):a(``,!0),D.value===`seo`?(p(),c(`div`,T,[d(G,{model:L.value,"label-width":`120px`},{default:i(()=>[d(g,{label:`产品名称`},{default:i(()=>[d(U,{modelValue:L.value.productName,"onUpdate:modelValue":l[3]||=e=>L.value.productName=e},null,8,[`modelValue`])]),_:1}),d(g,{label:`当前标题`},{default:i(()=>[d(U,{modelValue:L.value.currentTitle,"onUpdate:modelValue":l[4]||=e=>L.value.currentTitle=e},null,8,[`modelValue`])]),_:1}),d(g,null,{default:i(()=>[d(W,{type:`primary`,onClick:H,loading:j.value},{default:i(()=>[...l[8]||=[s(` 优化SEO `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(p(),c(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,E)):a(``,!0)])):a(``,!0)])}}},[[`__scopeId`,`data-v-c5e64ba1`]]);export{D as default};