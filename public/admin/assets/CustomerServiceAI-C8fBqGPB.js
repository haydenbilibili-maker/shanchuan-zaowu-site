import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,y as p}from"./index-nwDdqFlp.js";var m={class:`customer-service-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b={class:`section-card`},x=[`innerHTML`],S=f({__name:`CustomerServiceAI`,props:{feature:Object},setup(e){let f=o(``),S=o(``),C=o(!1),w=o(!1),T=o(!1),E=o(``),D=o(``),O=o(``),k=async()=>{if(!f.value.trim()){l.warning(`请输入客户问题`);return}C.value=!0;try{let e=await p(`生成专业客服回复话术：
客户问题：${f.value}

请提供：
1. 专业、友好的回复话术
2. 处理建议
3. 可能的后续跟进话术`,{systemInstruction:`你是专业的客服专家，擅长用友好、专业的方式回复客户问题`,temperature:.9});E.value=d.parse(e)}catch(e){l.error(`生成失败：`+(e.message||`未知错误`))}finally{C.value=!1}},A=async()=>{w.value=!0;try{let e=await p(`为标本艺术馆"山海造物"生成常见问题库：

请生成10-15个常见问题及专业回答，包括：
1. 产品相关问题（标本保存、展示等）
2. 购买相关问题（配送、退换货等）
3. 服务相关问题（课程、预约等）
4. 其他常见问题

每个问题需要：
- 清晰的问题描述
- 专业友好的回答
- 相关建议或提示`,{systemInstruction:`你是客户服务专家，擅长编写FAQ和客户问题解答`,temperature:.8});D.value=d.parse(e)}catch(e){l.error(`生成失败：`+(e.message||`未知错误`))}finally{w.value=!1}},j=async()=>{if(!S.value.trim()){l.warning(`请输入客户消息内容`);return}T.value=!0;try{let e=await p(`分析客户消息的情绪和意图：
客户消息：${S.value}

请提供：
1. 情绪分析（正面/中性/负面）
2. 情绪强度评估
3. 客户意图识别
4. 处理建议
5. 回复策略建议`,{systemInstruction:`你是客户情绪分析专家，擅长分析客户消息中的情绪和意图`,temperature:.7});O.value=d.parse(e)}catch(e){l.error(`分析失败：`+(e.message||`未知错误`))}finally{T.value=!1}};return(e,o)=>{let l=s(`el-input`),d=s(`el-button`);return u(),i(`div`,m,[o[8]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`💬 客服智能助手`),n(`p`,{class:`subtitle`},`AI客服话术生成、问题解答与客户情绪分析`)],-1),n(`div`,h,[n(`div`,g,[o[3]||=n(`h4`,null,`📝 客服话术生成`,-1),a(l,{modelValue:f.value,"onUpdate:modelValue":o[0]||=e=>f.value=e,type:`textarea`,rows:3,placeholder:`输入客户问题或场景描述...`,class:`query-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:k,loading:C.value,style:{"margin-top":`12px`}},{default:c(()=>[...o[2]||=[t(` 生成回复话术 `,-1)]]),_:1},8,[`loading`]),E.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:E.value},null,8,_)):r(``,!0)]),n(`div`,v,[o[5]||=n(`h4`,null,`❓ 常见问题解答`,-1),a(d,{type:`primary`,onClick:A,loading:w.value},{default:c(()=>[...o[4]||=[t(` 生成常见问题库 `,-1)]]),_:1},8,[`loading`]),D.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:D.value},null,8,y)):r(``,!0)]),n(`div`,b,[o[7]||=n(`h4`,null,`😊 客户情绪分析`,-1),a(l,{modelValue:S.value,"onUpdate:modelValue":o[1]||=e=>S.value=e,type:`textarea`,rows:3,placeholder:`输入客户消息内容...`,class:`query-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:j,loading:T.value},{default:c(()=>[...o[6]||=[t(` 分析客户情绪 `,-1)]]),_:1},8,[`loading`]),O.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:O.value},null,8,x)):r(``,!0)])])])}}},[[`__scopeId`,`data-v-bad8cddf`]]);export{S as default};