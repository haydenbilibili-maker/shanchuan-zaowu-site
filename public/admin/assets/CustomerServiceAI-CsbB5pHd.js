import{Sn as e,Tn as t,gn as n,in as r,on as i,r as a,rn as o,sn as s,tn as c,vn as l}from"./element-plus-DAUmSRMo.js";import{H as u,N as d,j as f}from"./index-Cv51IX2O.js";var p={class:`customer-service-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_={class:`section-card`},v=[`innerHTML`],y={class:`section-card`},b=[`innerHTML`],x=u({__name:`CustomerServiceAI`,props:{feature:Object},setup(u){let x=t(``),S=t(``),C=t(!1),w=t(!1),T=t(!1),E=t(``),D=t(``),O=t(``),k=async()=>{if(!x.value.trim()){a.warning(`请输入客户问题`);return}C.value=!0;try{let e=await d(`生成专业客服回复话术：
客户问题：${x.value}

请提供：
1. 专业、友好的回复话术
2. 处理建议
3. 可能的后续跟进话术`,{systemInstruction:`你是专业的客服专家，擅长用友好、专业的方式回复客户问题`,temperature:.9});E.value=f.parse(e)}catch(e){a.error(`生成失败：`+(e.message||`未知错误`))}finally{C.value=!1}},A=async()=>{w.value=!0;try{let e=await d(`为标本艺术馆"山海造物"生成常见问题库：

请生成10-15个常见问题及专业回答，包括：
1. 产品相关问题（标本保存、展示等）
2. 购买相关问题（配送、退换货等）
3. 服务相关问题（课程、预约等）
4. 其他常见问题

每个问题需要：
- 清晰的问题描述
- 专业友好的回答
- 相关建议或提示`,{systemInstruction:`你是客户服务专家，擅长编写FAQ和客户问题解答`,temperature:.8});D.value=f.parse(e)}catch(e){a.error(`生成失败：`+(e.message||`未知错误`))}finally{w.value=!1}},j=async()=>{if(!S.value.trim()){a.warning(`请输入客户消息内容`);return}T.value=!0;try{let e=await d(`分析客户消息的情绪和意图：
客户消息：${S.value}

请提供：
1. 情绪分析（正面/中性/负面）
2. 情绪强度评估
3. 客户意图识别
4. 处理建议
5. 回复策略建议`,{systemInstruction:`你是客户情绪分析专家，擅长分析客户消息中的情绪和意图`,temperature:.7});O.value=f.parse(e)}catch(e){a.error(`分析失败：`+(e.message||`未知错误`))}finally{T.value=!1}};return(t,a)=>{let u=l(`el-input`),d=l(`el-button`);return n(),r(`div`,p,[a[8]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`💬 客服智能助手`),c(`p`,{class:`subtitle`},`AI客服话术生成、问题解答与客户情绪分析`)],-1),c(`div`,m,[c(`div`,h,[a[3]||=c(`h4`,null,`📝 客服话术生成`,-1),s(u,{modelValue:x.value,"onUpdate:modelValue":a[0]||=e=>x.value=e,type:`textarea`,rows:3,placeholder:`输入客户问题或场景描述...`,class:`query-input`},null,8,[`modelValue`]),s(d,{type:`primary`,onClick:k,loading:C.value,style:{"margin-top":`12px`}},{default:e(()=>[...a[2]||=[i(` 生成回复话术 `,-1)]]),_:1},8,[`loading`]),E.value?(n(),r(`div`,{key:0,class:`result-content`,innerHTML:E.value},null,8,g)):o(``,!0)]),c(`div`,_,[a[5]||=c(`h4`,null,`❓ 常见问题解答`,-1),s(d,{type:`primary`,onClick:A,loading:w.value},{default:e(()=>[...a[4]||=[i(` 生成常见问题库 `,-1)]]),_:1},8,[`loading`]),D.value?(n(),r(`div`,{key:0,class:`result-content`,innerHTML:D.value},null,8,v)):o(``,!0)]),c(`div`,y,[a[7]||=c(`h4`,null,`😊 客户情绪分析`,-1),s(u,{modelValue:S.value,"onUpdate:modelValue":a[1]||=e=>S.value=e,type:`textarea`,rows:3,placeholder:`输入客户消息内容...`,class:`query-input`},null,8,[`modelValue`]),s(d,{type:`primary`,onClick:j,loading:T.value},{default:e(()=>[...a[6]||=[i(` 分析客户情绪 `,-1)]]),_:1},8,[`loading`]),O.value?(n(),r(`div`,{key:0,class:`result-content`,innerHTML:O.value},null,8,b)):o(``,!0)])])])}}},[[`__scopeId`,`data-v-bad8cddf`]]);export{x as default};