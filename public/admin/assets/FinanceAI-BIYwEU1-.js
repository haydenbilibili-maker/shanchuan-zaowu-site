import{$t as e,Cn as t,Kt as n,Qt as r,Xt as i,dn as a,fn as o,gn as s,nn as c,r as l,tn as u,un as d,xn as f,yn as p}from"./element-plus-UT91gMua.js";import{g as m,h,s as g,v as _}from"./index-Cc4SPh2y.js";var v={class:`finance-ai`},y={class:`finance-tabs`},b=[`onClick`],x={key:0,class:`analysis-section`},S=[`innerHTML`],C={key:1,class:`forecast-section`},w=[`innerHTML`],T={key:2,class:`risk-section`},E=[`innerHTML`],D={key:3,class:`optimization-section`},O=[`innerHTML`],k=h({__name:`FinanceAI`,props:{feature:Object},setup(h){let k=p(`analysis`),A=p(!1),j=p(!1),M=p(!1),N=p(!1),P=p(``),F=p(``),I=p(``),L=p(``),R=[{id:`analysis`,name:`财务分析`,icon:`📊`},{id:`forecast`,name:`财务预测`,icon:`🔮`},{id:`risk`,name:`风险预警`,icon:`⚠️`},{id:`optimization`,name:`优化建议`,icon:`💡`}],z=p({type:`revenue`,dateRange:null}),B=p({type:`revenue`,period:`3m`}),V=p({target:`profit`}),H=async()=>{A.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){l.error(`获取财务数据失败`),A.value=!1;return}let t=await _(`作为财务分析专家，请对以下财务数据进行${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`,roi:`投资回报`}[z.value.type]}分析：

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
4. 改进建议`,{systemInstruction:`你是一位资深的财务分析专家，擅长财务数据分析和解读`,temperature:.7});P.value=m.parse(t)}catch(e){console.error(`财务分析失败:`,e),l.error(`分析失败：`+(e.message||`未知错误`))}finally{A.value=!1}},U=async()=>{j.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){l.error(`获取财务数据失败`),j.value=!1;return}let t=await _(`作为财务预测专家，请基于以下历史数据，预测${{"1m":`未来1个月`,"3m":`未来3个月`,"6m":`未来6个月`,"1y":`未来1年`}[B.value.period]}的${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`}[B.value.type]}：

历史数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}

请提供：
1. 预测结果（具体数值和趋势）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示`,{systemInstruction:`你是一位财务预测专家，擅长基于历史数据进行财务预测`,temperature:.7});F.value=m.parse(t)}catch(e){console.error(`财务预测失败:`,e),l.error(`预测失败：`+(e.message||`未知错误`))}finally{j.value=!1}},W=async()=>{M.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){l.error(`获取财务数据失败`),M.value=!1;return}let t=await _(`作为财务风险专家，请分析以下财务数据，识别潜在风险：

财务数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}
- 库存状况：低库存${e.inventory?.lowStock||0}件，缺货${e.inventory?.outOfStock||0}件

请识别：
1. 财务风险点
2. 风险等级评估
3. 风险原因分析
4. 应对措施建议`,{systemInstruction:`你是一位财务风险专家，擅长识别和分析财务风险`,temperature:.7});I.value=m.parse(t)}catch(e){console.error(`风险检查失败:`,e),l.error(`检查失败：`+(e.message||`未知错误`))}finally{M.value=!1}},G=async()=>{N.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){l.error(`获取财务数据失败`),N.value=!1;return}let t=await _(`作为财务优化专家，请针对"${{profit:`提升利润率`,cost:`降低成本`,cashflow:`改善现金流`,roi:`提升投资回报`}[V.value.target]}"目标，提供具体的优化方案：

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
5. 风险提示`,{systemInstruction:`你是一位财务优化专家，擅长提供财务优化方案`,temperature:.8});L.value=m.parse(t)}catch(e){console.error(`优化方案生成失败:`,e),l.error(`生成失败：`+(e.message||`未知错误`))}finally{N.value=!1}};return(l,p)=>{let m=o(`el-option`),h=o(`el-select`),g=o(`el-form-item`),_=o(`el-date-picker`),K=o(`el-button`),q=o(`el-form`);return d(),e(`div`,v,[p[9]||=i(`div`,{class:`ai-header`},[i(`h3`,null,`💰 财务AI助手`),i(`p`,{class:`subtitle`},`智能财务分析与决策支持`)],-1),i(`div`,y,[(d(),e(n,null,a(R,e=>i(`div`,{key:e.id,onClick:t=>k.value=e.id,class:f([`tab-item`,{active:k.value===e.id}])},t(e.icon)+` `+t(e.name),11,b)),64))]),k.value===`analysis`?(d(),e(`div`,x,[c(q,{model:z.value,"label-width":`120px`},{default:s(()=>[c(g,{label:`分析类型`},{default:s(()=>[c(h,{modelValue:z.value.type,"onUpdate:modelValue":p[0]||=e=>z.value.type=e},{default:s(()=>[c(m,{label:`营收分析`,value:`revenue`}),c(m,{label:`成本分析`,value:`cost`}),c(m,{label:`利润分析`,value:`profit`}),c(m,{label:`现金流分析`,value:`cashflow`}),c(m,{label:`投资回报分析`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),c(g,{label:`时间范围`},{default:s(()=>[c(_,{modelValue:z.value.dateRange,"onUpdate:modelValue":p[1]||=e=>z.value.dateRange=e,type:`daterange`,"range-separator":`至`,"start-placeholder":`开始日期`,"end-placeholder":`结束日期`},null,8,[`modelValue`])]),_:1}),c(g,null,{default:s(()=>[c(K,{type:`primary`,onClick:H,loading:A.value},{default:s(()=>[...p[5]||=[u(` 开始分析 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),P.value?(d(),e(`div`,{key:0,class:`result-box`,innerHTML:P.value},null,8,S)):r(``,!0)])):r(``,!0),k.value===`forecast`?(d(),e(`div`,C,[c(q,{model:B.value,"label-width":`120px`},{default:s(()=>[c(g,{label:`预测类型`},{default:s(()=>[c(h,{modelValue:B.value.type,"onUpdate:modelValue":p[2]||=e=>B.value.type=e},{default:s(()=>[c(m,{label:`营收预测`,value:`revenue`}),c(m,{label:`成本预测`,value:`cost`}),c(m,{label:`利润预测`,value:`profit`}),c(m,{label:`现金流预测`,value:`cashflow`})]),_:1},8,[`modelValue`])]),_:1}),c(g,{label:`预测周期`},{default:s(()=>[c(h,{modelValue:B.value.period,"onUpdate:modelValue":p[3]||=e=>B.value.period=e},{default:s(()=>[c(m,{label:`未来1个月`,value:`1m`}),c(m,{label:`未来3个月`,value:`3m`}),c(m,{label:`未来6个月`,value:`6m`}),c(m,{label:`未来1年`,value:`1y`})]),_:1},8,[`modelValue`])]),_:1}),c(g,null,{default:s(()=>[c(K,{type:`primary`,onClick:U,loading:j.value},{default:s(()=>[...p[6]||=[u(` 生成预测 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(d(),e(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,w)):r(``,!0)])):r(``,!0),k.value===`risk`?(d(),e(`div`,T,[c(K,{type:`primary`,onClick:W,loading:M.value},{default:s(()=>[...p[7]||=[u(` 检查财务风险 `,-1)]]),_:1},8,[`loading`]),I.value?(d(),e(`div`,{key:0,class:`result-box`,innerHTML:I.value},null,8,E)):r(``,!0)])):r(``,!0),k.value===`optimization`?(d(),e(`div`,D,[c(q,{model:V.value,"label-width":`120px`},{default:s(()=>[c(g,{label:`优化目标`},{default:s(()=>[c(h,{modelValue:V.value.target,"onUpdate:modelValue":p[4]||=e=>V.value.target=e},{default:s(()=>[c(m,{label:`提升利润率`,value:`profit`}),c(m,{label:`降低成本`,value:`cost`}),c(m,{label:`改善现金流`,value:`cashflow`}),c(m,{label:`提升投资回报`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),c(g,null,{default:s(()=>[c(K,{type:`primary`,onClick:G,loading:N.value},{default:s(()=>[...p[8]||=[u(` 生成优化方案 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),L.value?(d(),e(`div`,{key:0,class:`result-box`,innerHTML:L.value},null,8,O)):r(``,!0)])):r(``,!0)])}}},[[`__scopeId`,`data-v-8b183fe4`]]);export{k as t};