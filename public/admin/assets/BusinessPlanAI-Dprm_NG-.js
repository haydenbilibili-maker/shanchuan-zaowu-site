import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,s as p,y as m}from"./index-nwDdqFlp.js";var h={class:`business-plan-ai`},g={class:`ai-sections`},_={class:`section-card`},v=[`innerHTML`],y={class:`section-card`},b=[`innerHTML`],x=f({__name:`BusinessPlanAI`,props:{feature:Object},setup(e){let f=o({type:`startup`,audience:`投资人`}),x=o(``),S=o(!1),C=o(!1),w=o(``),T=o(``),E=async()=>{S.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`}),t={startup:`创业计划书`,expansion:`扩张计划书`,funding:`融资计划书`},n=await m(`生成${t[f.value.type]}：
目标受众：${f.value.audience}

当前业务数据：
- 月营收：¥${e?.finance?.monthSales?.toLocaleString()||`130k-200k`}
- 商品总数：${e?.products?.total||0}
- 会员总数：${e?.members?.total||0}

品牌定位：山海造物标本艺术馆
- 自然美学、手作体验、教育价值
- 目标人群：25-40岁新中产、自然爱好者、教育焦虑家长

请生成完整的${t[f.value.type]}，包括：
1. 执行摘要
2. 市场分析
3. 产品与服务
4. 商业模式
5. 营销策略
6. 财务预测
7. 团队与管理
8. 风险分析
9. 资金需求（如适用）
10. 发展规划`,{systemInstruction:`你是商业计划书撰写专家，擅长撰写专业、全面的商业计划书`,temperature:.8,maxOutputTokens:4096});w.value=d.parse(n)}catch(e){l.error(`生成失败：`+(e.message||`未知错误`))}finally{S.value=!1}},D=async()=>{if(!x.value.trim()){l.warning(`请输入项目描述`);return}C.value=!0;try{let e=await m(`生成项目提案：
项目描述：${x.value}

请生成专业的项目提案，包括：
1. 项目背景
2. 项目目标
3. 实施方案
4. 预期成果
5. 资源需求
6. 时间计划
7. 风险评估
8. 成功指标`,{systemInstruction:`你是项目提案撰写专家`,temperature:.8,maxOutputTokens:2048});T.value=d.parse(e)}catch(e){l.error(`生成失败：`+(e.message||`未知错误`))}finally{C.value=!1}};return(e,o)=>{let l=s(`el-option`),d=s(`el-select`),p=s(`el-form-item`),m=s(`el-input`),O=s(`el-button`),k=s(`el-form`);return u(),i(`div`,h,[o[7]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`📋 商业计划生成AI`),n(`p`,{class:`subtitle`},`快速生成商业计划书、项目提案与投资路演材料`)],-1),n(`div`,g,[n(`div`,_,[o[4]||=n(`h4`,null,`📄 商业计划书生成`,-1),a(k,{model:f.value,"label-width":`120px`},{default:c(()=>[a(p,{label:`计划类型`},{default:c(()=>[a(d,{modelValue:f.value.type,"onUpdate:modelValue":o[0]||=e=>f.value.type=e},{default:c(()=>[a(l,{label:`创业计划书`,value:`startup`}),a(l,{label:`扩张计划书`,value:`expansion`}),a(l,{label:`融资计划书`,value:`funding`})]),_:1},8,[`modelValue`])]),_:1}),a(p,{label:`目标受众`},{default:c(()=>[a(m,{modelValue:f.value.audience,"onUpdate:modelValue":o[1]||=e=>f.value.audience=e,placeholder:`如：投资人、合作伙伴等`},null,8,[`modelValue`])]),_:1}),a(p,null,{default:c(()=>[a(O,{type:`primary`,onClick:E,loading:S.value},{default:c(()=>[...o[3]||=[t(` 生成商业计划书 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),w.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:w.value},null,8,v)):r(``,!0)]),n(`div`,y,[o[6]||=n(`h4`,null,`🎯 项目提案生成`,-1),a(m,{modelValue:x.value,"onUpdate:modelValue":o[2]||=e=>x.value=e,type:`textarea`,rows:4,placeholder:`描述项目背景、目标、需求等...`,class:`query-input`},null,8,[`modelValue`]),a(O,{type:`primary`,onClick:D,loading:C.value,style:{"margin-top":`12px`}},{default:c(()=>[...o[5]||=[t(` 生成项目提案 `,-1)]]),_:1},8,[`loading`]),T.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:T.value},null,8,b)):r(``,!0)])])])}}},[[`__scopeId`,`data-v-b0d06312`]]);export{x as default};