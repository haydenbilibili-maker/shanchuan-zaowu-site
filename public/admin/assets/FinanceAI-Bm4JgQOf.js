import{$t as e,Jt as t,Wt as n,Xt as r,Zt as i,_n as a,cn as o,en as s,ln as c,mn as l,r as u,un as d,xn as f,yn as p}from"./element-plus-CVfHhcL0.js";import{_ as m,h,m as g,o as _}from"./index-D_jnvNgu.js";var v={class:`finance-ai`},y={class:`finance-tabs`},b=[`onClick`],x={key:0,class:`analysis-section`},S=[`innerHTML`],C={key:1,class:`forecast-section`},w=[`innerHTML`],T={key:2,class:`risk-section`},E=[`innerHTML`],D={key:3,class:`optimization-section`},O=[`innerHTML`],k=g({__name:`FinanceAI`,props:{feature:Object},setup(g){let k=a(`analysis`),A=a(!1),j=a(!1),M=a(!1),N=a(!1),P=a(``),F=a(``),I=a(``),L=a(``),R=[{id:`analysis`,name:`财务分析`,icon:`📊`},{id:`forecast`,name:`财务预测`,icon:`🔮`},{id:`risk`,name:`风险预警`,icon:`⚠️`},{id:`optimization`,name:`优化建议`,icon:`💡`}],z=a({type:`revenue`,dateRange:null}),B=a({type:`revenue`,period:`3m`}),V=a({target:`profit`}),H=async()=>{A.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){u.error(`获取财务数据失败`),A.value=!1;return}let t=await m(`作为财务分析专家，请对以下财务数据进行${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`,roi:`投资回报`}[z.value.type]}分析：

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
4. 改进建议`,{systemInstruction:`你是一位资深的财务分析专家，擅长财务数据分析和解读`,temperature:.7});P.value=h.parse(t)}catch(e){console.error(`财务分析失败:`,e),u.error(`分析失败：`+(e.message||`未知错误`))}finally{A.value=!1}},U=async()=>{j.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){u.error(`获取财务数据失败`),j.value=!1;return}let t=await m(`作为财务预测专家，请基于以下历史数据，预测${{"1m":`未来1个月`,"3m":`未来3个月`,"6m":`未来6个月`,"1y":`未来1年`}[B.value.period]}的${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`}[B.value.type]}：

历史数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}

请提供：
1. 预测结果（具体数值和趋势）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示`,{systemInstruction:`你是一位财务预测专家，擅长基于历史数据进行财务预测`,temperature:.7});F.value=h.parse(t)}catch(e){console.error(`财务预测失败:`,e),u.error(`预测失败：`+(e.message||`未知错误`))}finally{j.value=!1}},W=async()=>{M.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){u.error(`获取财务数据失败`),M.value=!1;return}let t=await m(`作为财务风险专家，请分析以下财务数据，识别潜在风险：

财务数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}
- 库存状况：低库存${e.inventory?.lowStock||0}件，缺货${e.inventory?.outOfStock||0}件

请识别：
1. 财务风险点
2. 风险等级评估
3. 风险原因分析
4. 应对措施建议`,{systemInstruction:`你是一位财务风险专家，擅长识别和分析财务风险`,temperature:.7});I.value=h.parse(t)}catch(e){console.error(`风险检查失败:`,e),u.error(`检查失败：`+(e.message||`未知错误`))}finally{M.value=!1}},G=async()=>{N.value=!0;try{let e=await _(!1,{useFinancialData:!0,period:`month`});if(!e){u.error(`获取财务数据失败`),N.value=!1;return}let t=await m(`作为财务优化专家，请针对"${{profit:`提升利润率`,cost:`降低成本`,cashflow:`改善现金流`,roi:`提升投资回报`}[V.value.target]}"目标，提供具体的优化方案：

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
5. 风险提示`,{systemInstruction:`你是一位财务优化专家，擅长提供财务优化方案`,temperature:.8});L.value=h.parse(t)}catch(e){console.error(`优化方案生成失败:`,e),u.error(`生成失败：`+(e.message||`未知错误`))}finally{N.value=!1}};return(a,u)=>{let m=d(`el-option`),h=d(`el-select`),g=d(`el-form-item`),_=d(`el-date-picker`),K=d(`el-button`),q=d(`el-form`);return o(),i(`div`,v,[u[9]||=t(`div`,{class:`ai-header`},[t(`h3`,null,`💰 财务AI助手`),t(`p`,{class:`subtitle`},`智能财务分析与决策支持`)],-1),t(`div`,y,[(o(),i(n,null,c(R,e=>t(`div`,{key:e.id,onClick:t=>k.value=e.id,class:p([`tab-item`,{active:k.value===e.id}])},f(e.icon)+` `+f(e.name),11,b)),64))]),k.value===`analysis`?(o(),i(`div`,x,[s(q,{model:z.value,"label-width":`120px`},{default:l(()=>[s(g,{label:`分析类型`},{default:l(()=>[s(h,{modelValue:z.value.type,"onUpdate:modelValue":u[0]||=e=>z.value.type=e},{default:l(()=>[s(m,{label:`营收分析`,value:`revenue`}),s(m,{label:`成本分析`,value:`cost`}),s(m,{label:`利润分析`,value:`profit`}),s(m,{label:`现金流分析`,value:`cashflow`}),s(m,{label:`投资回报分析`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),s(g,{label:`时间范围`},{default:l(()=>[s(_,{modelValue:z.value.dateRange,"onUpdate:modelValue":u[1]||=e=>z.value.dateRange=e,type:`daterange`,"range-separator":`至`,"start-placeholder":`开始日期`,"end-placeholder":`结束日期`},null,8,[`modelValue`])]),_:1}),s(g,null,{default:l(()=>[s(K,{type:`primary`,onClick:H,loading:A.value},{default:l(()=>[...u[5]||=[e(` 开始分析 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),P.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:P.value},null,8,S)):r(``,!0)])):r(``,!0),k.value===`forecast`?(o(),i(`div`,C,[s(q,{model:B.value,"label-width":`120px`},{default:l(()=>[s(g,{label:`预测类型`},{default:l(()=>[s(h,{modelValue:B.value.type,"onUpdate:modelValue":u[2]||=e=>B.value.type=e},{default:l(()=>[s(m,{label:`营收预测`,value:`revenue`}),s(m,{label:`成本预测`,value:`cost`}),s(m,{label:`利润预测`,value:`profit`}),s(m,{label:`现金流预测`,value:`cashflow`})]),_:1},8,[`modelValue`])]),_:1}),s(g,{label:`预测周期`},{default:l(()=>[s(h,{modelValue:B.value.period,"onUpdate:modelValue":u[3]||=e=>B.value.period=e},{default:l(()=>[s(m,{label:`未来1个月`,value:`1m`}),s(m,{label:`未来3个月`,value:`3m`}),s(m,{label:`未来6个月`,value:`6m`}),s(m,{label:`未来1年`,value:`1y`})]),_:1},8,[`modelValue`])]),_:1}),s(g,null,{default:l(()=>[s(K,{type:`primary`,onClick:U,loading:j.value},{default:l(()=>[...u[6]||=[e(` 生成预测 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,w)):r(``,!0)])):r(``,!0),k.value===`risk`?(o(),i(`div`,T,[s(K,{type:`primary`,onClick:W,loading:M.value},{default:l(()=>[...u[7]||=[e(` 检查财务风险 `,-1)]]),_:1},8,[`loading`]),I.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:I.value},null,8,E)):r(``,!0)])):r(``,!0),k.value===`optimization`?(o(),i(`div`,D,[s(q,{model:V.value,"label-width":`120px`},{default:l(()=>[s(g,{label:`优化目标`},{default:l(()=>[s(h,{modelValue:V.value.target,"onUpdate:modelValue":u[4]||=e=>V.value.target=e},{default:l(()=>[s(m,{label:`提升利润率`,value:`profit`}),s(m,{label:`降低成本`,value:`cost`}),s(m,{label:`改善现金流`,value:`cashflow`}),s(m,{label:`提升投资回报`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),s(g,null,{default:l(()=>[s(K,{type:`primary`,onClick:G,loading:N.value},{default:l(()=>[...u[8]||=[e(` 生成优化方案 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),L.value?(o(),i(`div`,{key:0,class:`result-box`,innerHTML:L.value},null,8,O)):r(``,!0)])):r(``,!0)])}}},[[`__scopeId`,`data-v-8b183fe4`]]);export{k as t};