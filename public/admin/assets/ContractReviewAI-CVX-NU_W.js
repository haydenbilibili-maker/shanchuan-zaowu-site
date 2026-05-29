import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,y as p}from"./index-nwDdqFlp.js";var m={class:`contract-review-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v=f({__name:`ContractReviewAI`,props:{feature:Object},setup(e){let f=o(``),v=o(!1),y=o(``),b=async()=>{if(!f.value.trim()){l.warning(`请输入合同内容`);return}v.value=!0;try{let e=await p(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${f.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=d.parse(e)}catch(e){l.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(e,o)=>{let l=s(`el-input`),d=s(`el-button`);return u(),i(`div`,m,[o[3]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📄 合同智能审查AI`),n(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),n(`div`,h,[n(`div`,g,[o[2]||=n(`h4`,null,`📋 合同审查`,-1),a(l,{modelValue:f.value,"onUpdate:modelValue":o[0]||=e=>f.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:c(()=>[...o[1]||=[t(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,_)):r(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{v as default};