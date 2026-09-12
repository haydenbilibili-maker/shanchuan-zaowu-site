import{Cn as e,Mn as t,Tn as n,kn as r,ln as i,mn as a,pn as o,r as s,sn as c,un as l}from"./element-plus-BG1-t9RV.js";import{F as u,N as d,W as f}from"./index-xE0iZrEm.js";var p={class:`contract-review-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_=f({__name:`ContractReviewAI`,props:{feature:Object},setup(f){let _=t(``),v=t(!1),y=t(``),b=async()=>{if(!_.value.trim()){s.warning(`请输入合同内容`);return}v.value=!0;try{let e=await u(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${_.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=d.parse(e)}catch(e){s.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(t,s)=>{let u=n(`el-input`),d=n(`el-button`);return e(),l(`div`,p,[s[3]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`📄 合同智能审查AI`),c(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),c(`div`,m,[c(`div`,h,[s[2]||=c(`h4`,null,`📋 合同审查`,-1),a(u,{modelValue:_.value,"onUpdate:modelValue":s[0]||=e=>_.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:r(()=>[...s[1]||=[o(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(e(),l(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,g)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{_ as default};