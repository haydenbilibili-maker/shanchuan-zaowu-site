import{_n as e,an as t,en as n,hn as r,nn as i,on as a,r as o,rn as s,wn as c,xn as l}from"./element-plus-CxgvyxlJ.js";import{M as u,P as d,j as f}from"./index-49kSiBUH.js";var p={class:`contract-review-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_=f({__name:`ContractReviewAI`,props:{feature:Object},setup(f){let _=c(``),v=c(!1),y=c(``),b=async()=>{if(!_.value.trim()){o.warning(`请输入合同内容`);return}v.value=!0;try{let e=await d(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${_.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=u.parse(e)}catch(e){o.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(o,c)=>{let u=e(`el-input`),d=e(`el-button`);return r(),s(`div`,p,[c[3]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📄 合同智能审查AI`),n(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),n(`div`,m,[n(`div`,h,[c[2]||=n(`h4`,null,`📋 合同审查`,-1),a(u,{modelValue:_.value,"onUpdate:modelValue":c[0]||=e=>_.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:l(()=>[...c[1]||=[t(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(r(),s(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,g)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{_ as default};