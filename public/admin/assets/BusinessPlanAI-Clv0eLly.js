import{Cn as e,Mn as t,Tn as n,kn as r,ln as i,mn as a,pn as o,r as s,sn as c,un as l}from"./element-plus-B7Q2su-S.js";import{C as u,F as d,N as f,W as p}from"./index-CgnSLnSh.js";var m={class:`business-plan-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b=p({__name:`BusinessPlanAI`,props:{feature:Object},setup(p){let b=t({type:`startup`,audience:`投资人`}),x=t(``),S=t(!1),C=t(!1),w=t(``),T=t(``),E=async()=>{S.value=!0;try{let e=await u(!1,{useFinancialData:!0,period:`month`}),t={startup:`创业计划书`,expansion:`扩张计划书`,funding:`融资计划书`},n=await d(`生成${t[b.value.type]}：
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
10. 发展规划`,{systemInstruction:`你是商业计划书撰写专家，擅长撰写专业、全面的商业计划书`,temperature:.8,maxOutputTokens:4096});w.value=f.parse(n)}catch(e){s.error(`生成失败：`+(e.message||`未知错误`))}finally{S.value=!1}},D=async()=>{if(!x.value.trim()){s.warning(`请输入项目描述`);return}C.value=!0;try{let e=await d(`生成项目提案：
项目描述：${x.value}

请生成专业的项目提案，包括：
1. 项目背景
2. 项目目标
3. 实施方案
4. 预期成果
5. 资源需求
6. 时间计划
7. 风险评估
8. 成功指标`,{systemInstruction:`你是项目提案撰写专家`,temperature:.8,maxOutputTokens:2048});T.value=f.parse(e)}catch(e){s.error(`生成失败：`+(e.message||`未知错误`))}finally{C.value=!1}};return(t,s)=>{let u=n(`el-option`),d=n(`el-select`),f=n(`el-form-item`),p=n(`el-input`),O=n(`el-button`),k=n(`el-form`);return e(),l(`div`,m,[s[7]||=c(`div`,{class:`ai-header`},[c(`h3`,null,`📋 商业计划生成AI`),c(`p`,{class:`subtitle`},`快速生成商业计划书、项目提案与投资路演材料`)],-1),c(`div`,h,[c(`div`,g,[s[4]||=c(`h4`,null,`📄 商业计划书生成`,-1),a(k,{model:b.value,"label-width":`120px`},{default:r(()=>[a(f,{label:`计划类型`},{default:r(()=>[a(d,{modelValue:b.value.type,"onUpdate:modelValue":s[0]||=e=>b.value.type=e},{default:r(()=>[a(u,{label:`创业计划书`,value:`startup`}),a(u,{label:`扩张计划书`,value:`expansion`}),a(u,{label:`融资计划书`,value:`funding`})]),_:1},8,[`modelValue`])]),_:1}),a(f,{label:`目标受众`},{default:r(()=>[a(p,{modelValue:b.value.audience,"onUpdate:modelValue":s[1]||=e=>b.value.audience=e,placeholder:`如：投资人、合作伙伴等`},null,8,[`modelValue`])]),_:1}),a(f,null,{default:r(()=>[a(O,{type:`primary`,onClick:E,loading:S.value},{default:r(()=>[...s[3]||=[o(` 生成商业计划书 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),w.value?(e(),l(`div`,{key:0,class:`result-content`,innerHTML:w.value},null,8,_)):i(``,!0)]),c(`div`,v,[s[6]||=c(`h4`,null,`🎯 项目提案生成`,-1),a(p,{modelValue:x.value,"onUpdate:modelValue":s[2]||=e=>x.value=e,type:`textarea`,rows:4,placeholder:`描述项目背景、目标、需求等...`,class:`query-input`},null,8,[`modelValue`]),a(O,{type:`primary`,onClick:D,loading:C.value,style:{"margin-top":`12px`}},{default:r(()=>[...s[5]||=[o(` 生成项目提案 `,-1)]]),_:1},8,[`loading`]),T.value?(e(),l(`div`,{key:0,class:`result-content`,innerHTML:T.value},null,8,y)):i(``,!0)])])])}}},[[`__scopeId`,`data-v-b0d06312`]]);export{b as default};