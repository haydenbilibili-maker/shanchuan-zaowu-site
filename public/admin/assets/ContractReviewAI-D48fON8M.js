import{Dn as e,an as t,bn as n,cn as r,in as i,ln as a,nn as o,r as s,vn as c,wn as l}from"./element-plus-CfxNpNys.js";import{H as u,N as d,j as f}from"./index-BV73hT4j.js";var p={class:`contract-review-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_=u({__name:`ContractReviewAI`,props:{feature:Object},setup(u){let _=e(``),v=e(!1),y=e(``),b=async()=>{if(!_.value.trim()){s.warning(`请输入合同内容`);return}v.value=!0;try{let e=await d(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${_.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=f.parse(e)}catch(e){s.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(e,s)=>{let u=n(`el-input`),d=n(`el-button`);return c(),t(`div`,p,[s[3]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`📄 合同智能审查AI`),o(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),o(`div`,m,[o(`div`,h,[s[2]||=o(`h4`,null,`📋 合同审查`,-1),a(u,{modelValue:_.value,"onUpdate:modelValue":s[0]||=e=>_.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:l(()=>[...s[1]||=[r(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(c(),t(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,g)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{_ as default};