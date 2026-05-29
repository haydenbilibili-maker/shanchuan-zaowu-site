import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Wt as r,Xt as i,Zt as a,bn as o,cn as s,en as c,gn as l,ln as u,pn as d,r as f,sn as p,vn as m}from"./element-plus-Bnc69kxf.js";import{_ as h,g,s as _,y as v}from"./index-nwDdqFlp.js";var y={class:`finance-ai`},b={class:`finance-tabs`},x=[`onClick`],S={key:0,class:`analysis-section`},C=[`innerHTML`],w={key:1,class:`forecast-section`},T=[`innerHTML`],E={key:2,class:`risk-section`},D=[`innerHTML`],O={key:3,class:`optimization-section`},k=[`innerHTML`],A=g({__name:`FinanceAI`,props:{feature:Object},setup(e){let g=l(`analysis`),A=l(!1),j=l(!1),M=l(!1),N=l(!1),P=l(``),F=l(``),I=l(``),L=l(``),R=[{id:`analysis`,name:`财务分析`,icon:`📊`},{id:`forecast`,name:`财务预测`,icon:`🔮`},{id:`risk`,name:`风险预警`,icon:`⚠️`},{id:`optimization`,name:`优化建议`,icon:`💡`}],z=l({type:`revenue`,dateRange:null}),B=l({type:`revenue`,period:`3m`}),V=l({target:`profit`}),H=async()=>{A.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){f.error(`获取财务数据失败`),A.value=!1;return}let t=await v(`作为财务分析专家，请对以下财务数据进行${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`,roi:`投资回报`}[z.value.type]}分析：

财务数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}
- 总营收：¥${e.finance?.totalRevenue||0}

${z.value.dateRange?`时间范围：${z.value.dateRange[0]} 至 ${z.value.dateRange[1]}`:``}

请提供：
1. 数据趋势分析
2. 关键指标解读
3. 异常情况识别
4. 改进建议`,{systemInstruction:`你是一位资深的财务分析专家，擅长财务数据分析和解读`,temperature:.7,provider:`deepseek`});P.value=h.parse(t)}catch(e){console.error(`财务分析失败:`,e),f.error(`分析失败：`+(e.message||`未知错误`))}finally{A.value=!1}},U=async()=>{j.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){f.error(`获取财务数据失败`),j.value=!1;return}let t=await v(`作为财务预测专家，请基于以下历史数据，预测${{"1m":`未来1个月`,"3m":`未来3个月`,"6m":`未来6个月`,"1y":`未来1年`}[B.value.period]}的${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`}[B.value.type]}：

历史数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}

请提供：
1. 预测结果（具体数值和趋势）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示`,{systemInstruction:`你是一位财务预测专家，擅长基于历史数据进行财务预测`,temperature:.7,provider:`deepseek`});F.value=h.parse(t)}catch(e){console.error(`财务预测失败:`,e),f.error(`预测失败：`+(e.message||`未知错误`))}finally{j.value=!1}},W=async()=>{M.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){f.error(`获取财务数据失败`),M.value=!1;return}let t=await v(`作为财务风险专家，请分析以下财务数据，识别潜在风险：

财务数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}
- 库存状况：低库存${e.inventory?.lowStock||0}件，缺货${e.inventory?.outOfStock||0}件

请识别：
1. 财务风险点
2. 风险等级评估
3. 风险原因分析
4. 应对措施建议`,{systemInstruction:`你是一位财务风险专家，擅长识别和分析财务风险`,temperature:.7,provider:`deepseek`});I.value=h.parse(t)}catch(e){console.error(`风险检查失败:`,e),f.error(`检查失败：`+(e.message||`未知错误`))}finally{M.value=!1}},G=async()=>{N.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){f.error(`获取财务数据失败`),N.value=!1;return}let t=await v(`作为财务优化专家，请针对"${{profit:`提升利润率`,cost:`降低成本`,cashflow:`改善现金流`,roi:`提升投资回报`}[V.value.target]}"目标，提供具体的优化方案：

当前财务数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}
- 库存状况：低库存${e.inventory?.lowStock||0}件，缺货${e.inventory?.outOfStock||0}件

请提供：
1. 优化目标设定
2. 具体优化措施（至少5条）
3. 预期效果评估
4. 实施步骤和时间表
5. 风险提示`,{systemInstruction:`你是一位财务优化专家，擅长提供财务优化方案`,temperature:.8,provider:`deepseek`});L.value=h.parse(t)}catch(e){console.error(`优化方案生成失败:`,e),f.error(`生成失败：`+(e.message||`未知错误`))}finally{N.value=!1}};return(e,l)=>{let f=u(`el-option`),h=u(`el-select`),_=u(`el-form-item`),v=u(`el-date-picker`),K=u(`el-button`),q=u(`el-form`);return p(),a(`div`,y,[l[9]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`💰 财务AI助手`),n(`p`,{class:`subtitle`},`智能财务分析与决策支持`)],-1),n(`div`,b,[(p(),a(r,null,s(R,e=>n(`div`,{key:e.id,onClick:t=>g.value=e.id,class:m([`tab-item`,{active:g.value===e.id}])},o(e.icon)+` `+o(e.name),11,x)),64))]),g.value===`analysis`?(p(),a(`div`,S,[c(q,{model:z.value,"label-width":`120px`},{default:d(()=>[c(_,{label:`分析类型`},{default:d(()=>[c(h,{modelValue:z.value.type,"onUpdate:modelValue":l[0]||=e=>z.value.type=e},{default:d(()=>[c(f,{label:`营收分析`,value:`revenue`}),c(f,{label:`成本分析`,value:`cost`}),c(f,{label:`利润分析`,value:`profit`}),c(f,{label:`现金流分析`,value:`cashflow`}),c(f,{label:`投资回报分析`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),c(_,{label:`时间范围`},{default:d(()=>[c(v,{modelValue:z.value.dateRange,"onUpdate:modelValue":l[1]||=e=>z.value.dateRange=e,type:`daterange`,"range-separator":`至`,"start-placeholder":`开始日期`,"end-placeholder":`结束日期`},null,8,[`modelValue`])]),_:1}),c(_,null,{default:d(()=>[c(K,{type:`primary`,onClick:H,loading:A.value},{default:d(()=>[...l[5]||=[t(` 开始分析 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),P.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:P.value},null,8,C)):i(``,!0)])):i(``,!0),g.value===`forecast`?(p(),a(`div`,w,[c(q,{model:B.value,"label-width":`120px`},{default:d(()=>[c(_,{label:`预测类型`},{default:d(()=>[c(h,{modelValue:B.value.type,"onUpdate:modelValue":l[2]||=e=>B.value.type=e},{default:d(()=>[c(f,{label:`营收预测`,value:`revenue`}),c(f,{label:`成本预测`,value:`cost`}),c(f,{label:`利润预测`,value:`profit`}),c(f,{label:`现金流预测`,value:`cashflow`})]),_:1},8,[`modelValue`])]),_:1}),c(_,{label:`预测周期`},{default:d(()=>[c(h,{modelValue:B.value.period,"onUpdate:modelValue":l[3]||=e=>B.value.period=e},{default:d(()=>[c(f,{label:`未来1个月`,value:`1m`}),c(f,{label:`未来3个月`,value:`3m`}),c(f,{label:`未来6个月`,value:`6m`}),c(f,{label:`未来1年`,value:`1y`})]),_:1},8,[`modelValue`])]),_:1}),c(_,null,{default:d(()=>[c(K,{type:`primary`,onClick:U,loading:j.value},{default:d(()=>[...l[6]||=[t(` 生成预测 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,T)):i(``,!0)])):i(``,!0),g.value===`risk`?(p(),a(`div`,E,[c(K,{type:`primary`,onClick:W,loading:M.value},{default:d(()=>[...l[7]||=[t(` 检查财务风险 `,-1)]]),_:1},8,[`loading`]),I.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:I.value},null,8,D)):i(``,!0)])):i(``,!0),g.value===`optimization`?(p(),a(`div`,O,[c(q,{model:V.value,"label-width":`120px`},{default:d(()=>[c(_,{label:`优化目标`},{default:d(()=>[c(h,{modelValue:V.value.target,"onUpdate:modelValue":l[4]||=e=>V.value.target=e},{default:d(()=>[c(f,{label:`提升利润率`,value:`profit`}),c(f,{label:`降低成本`,value:`cost`}),c(f,{label:`改善现金流`,value:`cashflow`}),c(f,{label:`提升投资回报`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),c(_,null,{default:d(()=>[c(K,{type:`primary`,onClick:G,loading:N.value},{default:d(()=>[...l[8]||=[t(` 生成优化方案 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),L.value?(p(),a(`div`,{key:0,class:`result-box`,innerHTML:L.value},null,8,k)):i(``,!0)])):i(``,!0)])}}},[[`__scopeId`,`data-v-3a5b752b`]]);export{A as t};