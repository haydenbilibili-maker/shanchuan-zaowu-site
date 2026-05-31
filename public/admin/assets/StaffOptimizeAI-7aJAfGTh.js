import{$t as e,Jt as t,Xt as n,Zt as r,en as i,gn as a,ln as o,pn as s,r as c,sn as l}from"./element-plus-pOJ5hHBv.js";import{g as u,h as d,v as f}from"./index-CU_veymZ.js";var p={class:`staff-optimize-ai`},m={class:`ai-sections`},h={class:`section-card`},g=[`innerHTML`],_={class:`section-card`},v=[`innerHTML`],y=d({__name:`StaffOptimizeAI`,props:{feature:Object},setup(d){let y=a({period:`week`,staffCount:5}),b=a(!1),x=a(!1),S=a(``),C=a(``),w=()=>{try{let e=localStorage.getItem(`shanhai_v12`),t=e?JSON.parse(e):[];if(!t||t.length===0)return{orderCount:0,revenue:0,averageOrderValue:0,periodLabel:y.value.period===`week`?`本周`:`本月`};let n=new Date,r=n.toISOString().split(`T`)[0],i=r.substring(0,7),a,o,s;if(y.value.period===`week`){let e=n.getDay(),t=new Date(n);t.setDate(n.getDate()-(e===0?6:e-1)),t.setHours(0,0,0,0),a=t.toISOString().split(`T`)[0],o=r,s=`本周`}else a=`${i}-01`,o=r,s=`本月`;let c=t.filter(e=>{let t=e.date;return t>=a&&t<=o}),l=c.reduce((e,t)=>e+(t.orderCount||0),0),u=c.reduce((e,t)=>e+(t.revenue||0),0);return{orderCount:l,revenue:u,averageOrderValue:l>0?u/l:0,periodLabel:s,records:c}}catch(e){return console.error(`读取财务报表数据失败:`,e),{orderCount:0,revenue:0,averageOrderValue:0,periodLabel:y.value.period===`week`?`本周`:`本月`}}},T=async()=>{b.value=!0;try{let e=w();if(!e){c.error(`获取财务报表数据失败`);return}let t=await f(`你是山海造物标本艺术馆的人力资源管理专家，擅长排班优化和人力成本控制。

${`
${e.periodLabel}财务数据：
- 订单数量：${e.orderCount}单
- 总营收：¥${e.revenue.toFixed(2)}
- 平均客单价：¥${e.averageOrderValue.toFixed(2)}
- 日期范围：${e.periodLabel}
`}

排班需求：
- 排班周期：${e.periodLabel}
- 店员数量：${y.value.staffCount}人

请基于以上财务数据，生成一份专业的智能排班方案，包含：
1. **每日排班建议**（考虑客流高峰时段，根据订单数据分布优化）
2. **人力配置优化**（根据${e.periodLabel}的订单量和营收情况，合理配置人力）
3. **排班成本分析**（估算排班成本，对比营收分析投入产出比）
4. **人员效率提升建议**（基于当前数据，提出提升人效的具体建议）

如果订单数据为0或较低，请特别说明在淡季/低客流情况下的排班策略。`,{systemInstruction:`你是人力资源管理专家，擅长基于财务数据做排班优化和人力成本控制。你会根据订单数据和营收情况，提供专业的排班建议。`,temperature:.8,maxOutputTokens:3e3});S.value=u.parse(t)}catch(e){console.error(`生成排班方案失败:`,e),c.error(`生成失败：`+(e.message||`未知错误`))}finally{b.value=!1}},E=async()=>{x.value=!0;try{let e=w(),t=localStorage.getItem(`sc_finance_v12`),n=(t?JSON.parse(t).settings:{}).staffSalary||5e3,r=y.value.staffCount,i=await f(`你是山海造物标本艺术馆的人力成本优化专家。

${`
${e.periodLabel}财务数据：
- 订单数量：${e.orderCount}单
- 总营收：¥${e.revenue.toFixed(2)}
- 平均客单价：¥${e.averageOrderValue.toFixed(2)}
- 店员数量：${r}人
- 人均月薪：¥${n}（参考值）
`}

请基于以上数据，提供专业的人力成本优化分析，包含：
1. **人力成本结构分析**（基于${e.periodLabel}的订单量和营收，分析人力成本占比）
2. **优化排班降低成本**（提出具体的排班优化方案，在不影响服务质量的前提下降低成本）
3. **提升人效的建议**（基于平均客单价和订单量，提出提升人均产出的具体措施）
4. **成本节约方案**（给出可执行的成本节约建议，包括排班、激励、培训等方面）

如果营收较低或订单较少，请特别说明如何通过优化排班和提升效率来控制成本。`,{systemInstruction:`你是人力成本优化专家，擅长基于财务数据分析人力成本结构，提供优化建议。`,temperature:.8,maxOutputTokens:3e3});C.value=u.parse(i)}catch(e){console.error(`分析人力成本失败:`,e),c.error(`分析失败：`+(e.message||`未知错误`))}finally{x.value=!1}};return(a,c)=>{let u=o(`el-option`),d=o(`el-select`),f=o(`el-form-item`),w=o(`el-input-number`),D=o(`el-button`),O=o(`el-form`);return l(),r(`div`,p,[c[6]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`👔 人力排班优化AI`),t(`p`,{class:`subtitle`},`基于客流数据的智能排班与人力配置优化`)],-1),t(`div`,m,[t(`div`,h,[c[3]||=t(`h4`,null,`📅 智能排班建议`,-1),i(O,{model:y.value,"label-width":`120px`},{default:s(()=>[i(f,{label:`排班周期`},{default:s(()=>[i(d,{modelValue:y.value.period,"onUpdate:modelValue":c[0]||=e=>y.value.period=e},{default:s(()=>[i(u,{label:`本周`,value:`week`}),i(u,{label:`本月`,value:`month`})]),_:1},8,[`modelValue`])]),_:1}),i(f,{label:`店员数量`},{default:s(()=>[i(w,{modelValue:y.value.staffCount,"onUpdate:modelValue":c[1]||=e=>y.value.staffCount=e,min:1,max:20},null,8,[`modelValue`])]),_:1}),i(f,null,{default:s(()=>[i(D,{type:`primary`,onClick:T,loading:b.value},{default:s(()=>[...c[2]||=[e(` 生成排班方案 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),S.value?(l(),r(`div`,{key:0,class:`result-content`,innerHTML:S.value},null,8,g)):n(``,!0)]),t(`div`,_,[c[5]||=t(`h4`,null,`💰 人力成本优化`,-1),i(D,{type:`primary`,onClick:E,loading:x.value},{default:s(()=>[...c[4]||=[e(` 分析人力成本 `,-1)]]),_:1},8,[`loading`]),C.value?(l(),r(`div`,{key:0,class:`result-content`,innerHTML:C.value},null,8,v)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-eacde77a`]]);export{y as default};