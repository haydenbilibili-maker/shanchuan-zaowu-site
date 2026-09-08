import{On as e,Tn as t,an as n,ln as r,on as i,r as a,rn as o,un as s,xn as c,yn as l}from"./element-plus-DU8uayx_.js";import{H as u,N as d,j as f}from"./index-BPI9FXuM.js";var p={class:`contract-review-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_=u({__name:`ContractReviewAI`,props:{feature:Object},setup(u){let _=e(``),v=e(!1),y=e(``),b=async()=>{if(!_.value.trim()){a.warning(`请输入合同内容`);return}v.value=!0;try{let e=await d(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${_.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=f.parse(e)}catch(e){a.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(e,a)=>{let u=c(`el-input`),d=c(`el-button`);return l(),i(`div`,p,[a[3]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`📄 合同智能审查AI`),o(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),o(`div`,m,[o(`div`,h,[a[2]||=o(`h4`,null,`📋 合同审查`,-1),s(u,{modelValue:_.value,"onUpdate:modelValue":a[0]||=e=>_.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),s(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:t(()=>[...a[1]||=[r(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,g)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{_ as default};