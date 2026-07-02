import{Qt as e,Yt as t,Zt as n,dn as r,en as i,hn as a,ln as o,r as s,tn as c,vn as l}from"./element-plus-BAAD72xB.js";import{_ as u,h as d,m as f}from"./index-Cbn80Adr.js";var p={class:`contract-review-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_=f({__name:`ContractReviewAI`,props:{feature:Object},setup(f){let _=l(``),v=l(!1),y=l(``),b=async()=>{if(!_.value.trim()){s.warning(`请输入合同内容`);return}v.value=!0;try{let e=await u(`审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${_.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`,{systemInstruction:`你是合同审查专家，擅长识别合同风险点和提供专业修改建议`,temperature:.7,maxOutputTokens:2048});y.value=d.parse(e)}catch(e){s.error(`审查失败：`+(e.message||`未知错误`))}finally{v.value=!1}};return(s,l)=>{let u=r(`el-input`),d=r(`el-button`);return o(),e(`div`,p,[l[3]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`📄 合同智能审查AI`),t(`p`,{class:`subtitle`},`AI审查合同条款，识别风险点并提供修改建议`)],-1),t(`div`,m,[t(`div`,h,[l[2]||=t(`h4`,null,`📋 合同审查`,-1),c(u,{modelValue:_.value,"onUpdate:modelValue":l[0]||=e=>_.value=e,type:`textarea`,rows:8,placeholder:`粘贴合同内容...`,class:`contract-input`},null,8,[`modelValue`]),c(d,{type:`primary`,onClick:b,loading:v.value,style:{"margin-top":`12px`}},{default:a(()=>[...l[1]||=[i(` 审查合同 `,-1)]]),_:1},8,[`loading`]),y.value?(o(),e(`div`,{key:0,class:`result-content`,innerHTML:y.value},null,8,g)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-a8667e81`]]);export{_ as default};