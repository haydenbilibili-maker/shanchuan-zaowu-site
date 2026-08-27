import{_n as e,an as t,en as n,hn as r,nn as i,on as a,r as o,rn as s,wn as c,xn as l}from"./element-plus-CxgvyxlJ.js";import{M as u,P as d,j as f,x as p}from"./index-10z0fyVZ.js";var m={class:`business-plan-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b=f({__name:`BusinessPlanAI`,props:{feature:Object},setup(f){let b=c({type:`startup`,audience:`投资人`}),x=c(``),S=c(!1),C=c(!1),w=c(``),T=c(``),E=async()=>{S.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`}),t={startup:`创业计划书`,expansion:`扩张计划书`,funding:`融资计划书`},n=await d(`生成${t[b.value.type]}：
目标受众：${b.value.audience}

当前业务数据：
- 月营收：¥${e?.finance?.monthSales?.toLocaleString()||`130k-200k`}
- 商品总数：${e?.products?.total||0}
- 会员总数：${e?.members?.total||0}

品牌定位：山海造物标本艺术馆
- 自然美学、手作体验、教育价值
- 目标人群：25-40岁新中产、自然爱好者、教育焦虑家长

请生成完整的${t[b.value.type]}，包括：
1. 执行摘要
2. 市场分析
3. 产品与服务
4. 商业模式
5. 营销策略
6. 财务预测
7. 团队与管理
8. 风险分析
9. 资金需求（如适用）
10. 发展规划`,{systemInstruction:`你是商业计划书撰写专家，擅长撰写专业、全面的商业计划书`,temperature:.8,maxOutputTokens:4096});w.value=u.parse(n)}catch(e){o.error(`生成失败：`+(e.message||`未知错误`))}finally{S.value=!1}},D=async()=>{if(!x.value.trim()){o.warning(`请输入项目描述`);return}C.value=!0;try{let e=await d(`生成项目提案：
项目描述：${x.value}

请生成专业的项目提案，包括：
1. 项目背景
2. 项目目标
3. 实施方案
4. 预期成果
5. 资源需求
6. 时间计划
7. 风险评估
8. 成功指标`,{systemInstruction:`你是项目提案撰写专家`,temperature:.8,maxOutputTokens:2048});T.value=u.parse(e)}catch(e){o.error(`生成失败：`+(e.message||`未知错误`))}finally{C.value=!1}};return(o,c)=>{let u=e(`el-option`),d=e(`el-select`),f=e(`el-form-item`),p=e(`el-input`),O=e(`el-button`),k=e(`el-form`);return r(),s(`div`,m,[c[7]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📋 商业计划生成AI`),n(`p`,{class:`subtitle`},`快速生成商业计划书、项目提案与投资路演材料`)],-1),n(`div`,h,[n(`div`,g,[c[4]||=n(`h4`,null,`📄 商业计划书生成`,-1),a(k,{model:b.value,"label-width":`120px`},{default:l(()=>[a(f,{label:`计划类型`},{default:l(()=>[a(d,{modelValue:b.value.type,"onUpdate:modelValue":c[0]||=e=>b.value.type=e},{default:l(()=>[a(u,{label:`创业计划书`,value:`startup`}),a(u,{label:`扩张计划书`,value:`expansion`}),a(u,{label:`融资计划书`,value:`funding`})]),_:1},8,[`modelValue`])]),_:1}),a(f,{label:`目标受众`},{default:l(()=>[a(p,{modelValue:b.value.audience,"onUpdate:modelValue":c[1]||=e=>b.value.audience=e,placeholder:`如：投资人、合作伙伴等`},null,8,[`modelValue`])]),_:1}),a(f,null,{default:l(()=>[a(O,{type:`primary`,onClick:E,loading:S.value},{default:l(()=>[...c[3]||=[t(` 生成商业计划书 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),w.value?(r(),s(`div`,{key:0,class:`result-content`,innerHTML:w.value},null,8,_)):i(``,!0)]),n(`div`,v,[c[6]||=n(`h4`,null,`🎯 项目提案生成`,-1),a(p,{modelValue:x.value,"onUpdate:modelValue":c[2]||=e=>x.value=e,type:`textarea`,rows:4,placeholder:`描述项目背景、目标、需求等...`,class:`query-input`},null,8,[`modelValue`]),a(O,{type:`primary`,onClick:D,loading:C.value,style:{"margin-top":`12px`}},{default:l(()=>[...c[5]||=[t(` 生成项目提案 `,-1)]]),_:1},8,[`loading`]),T.value?(r(),s(`div`,{key:0,class:`result-content`,innerHTML:T.value},null,8,y)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-b0d06312`]]);export{b as default};