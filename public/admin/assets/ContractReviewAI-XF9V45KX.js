import{Sn as e,Tn as t,gn as n,in as r,on as i,r as a,rn as o,sn as s,tn as c,vn as l}from"./element-plus-DAUmSRMo.js";import{M as u,P as d,j as f}from"./index-nIJIQ-bh.js";var p={class:`contract-review-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_=f({__name:`ContractReviewAI`,props:{feature:Object},setup(f){let _=t(``),v=t(!1),y=t(``),b=async()=>{if(!_.value.trim()){a.warning(`请输入合同内容`);return}v.value=!0;try{let e=await d(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${_.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=u.parse(e)}catch(e){a.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(t,a)=>{let u=l(`el-input`),d=l(`el-button`);return n(),r(`div`,p,[a[3]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`📄 合同智能审查AI`),c(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),c(`div`,m,[c(`div`,h,[a[2]||=c(`h4`,null,`📋 合同审查`,-1),s(u,{modelValue:_.value,"onUpdate:modelValue":a[0]||=e=>_.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),s(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:e(()=>[...a[1]||=[i(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(n(),r(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,g)):o(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{_ as default};