import{$t as e,Sn as t,Zt as n,_n as r,bn as i,dn as a,en as o,fn as s,nn as c,pn as l,qt as u,r as d,rn as f,wn as p}from"./element-plus-fsBmGXUl.js";import{g as m,h,s as g,v as _}from"./index-B_BVpAxk.js";var v={class:`finance-ai`},y={class:`finance-tabs`},b=[`onClick`],x={key:0,class:`analysis-section`},S=[`innerHTML`],C={key:1,class:`forecast-section`},w=[`innerHTML`],T={key:2,class:`risk-section`},E=[`innerHTML`],D={key:3,class:`optimization-section`},O=[`innerHTML`],k=h({__name:`FinanceAI`,props:{feature:Object},setup(h){let k=i(`analysis`),A=i(!1),j=i(!1),M=i(!1),N=i(!1),P=i(``),F=i(``),I=i(``),L=i(``),R=[{id:`analysis`,name:`财务分析`,icon:`📊`},{id:`forecast`,name:`财务预测`,icon:`🔮`},{id:`risk`,name:`风险预警`,icon:`⚠️`},{id:`optimization`,name:`优化建议`,icon:`💡`}],z=i({type:`revenue`,dateRange:null}),B=i({type:`revenue`,period:`3m`}),V=i({target:`profit`}),H=async()=>{A.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){d.error(`获取财务数据失败`),A.value=!1;return}let t=await _(`作为财务分析专家，请对以下财务数据进行${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`,roi:`投资回报`}[z.value.type]}分析：

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
4. 改进建议`,{systemInstruction:`你是一位资深的财务分析专家，擅长财务数据分析和解读`,temperature:.7});P.value=m.parse(t)}catch(e){console.error(`财务分析失败:`,e),d.error(`分析失败：`+(e.message||`未知错误`))}finally{A.value=!1}},U=async()=>{j.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){d.error(`获取财务数据失败`),j.value=!1;return}let t=await _(`作为财务预测专家，请基于以下历史数据，预测${{"1m":`未来1个月`,"3m":`未来3个月`,"6m":`未来6个月`,"1y":`未来1年`}[B.value.period]}的${{revenue:`营收`,cost:`成本`,profit:`利润`,cashflow:`现金流`}[B.value.type]}：

历史数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}

请提供：
1. 预测结果（具体数值和趋势）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示`,{systemInstruction:`你是一位财务预测专家，擅长基于历史数据进行财务预测`,temperature:.7});F.value=m.parse(t)}catch(e){console.error(`财务预测失败:`,e),d.error(`预测失败：`+(e.message||`未知错误`))}finally{j.value=!1}},W=async()=>{M.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){d.error(`获取财务数据失败`),M.value=!1;return}let t=await _(`作为财务风险专家，请分析以下财务数据，识别潜在风险：

财务数据：
- 周营收：¥${e.finance?.weeklyRevenue||0}
- 周订单数：${e.finance?.weeklyOrdersCount||0}
- 平均客单价：¥${e.finance?.averageOrderValue||0}
- 库存状况：低库存${e.inventory?.lowStock||0}件，缺货${e.inventory?.outOfStock||0}件

请识别：
1. 财务风险点
2. 风险等级评估
3. 风险原因分析
4. 应对措施建议`,{systemInstruction:`你是一位财务风险专家，擅长识别和分析财务风险`,temperature:.7});I.value=m.parse(t)}catch(e){console.error(`风险检查失败:`,e),d.error(`检查失败：`+(e.message||`未知错误`))}finally{M.value=!1}},G=async()=>{N.value=!0;try{let e=await g(!1,{useFinancialData:!0,period:`month`});if(!e){d.error(`获取财务数据失败`),N.value=!1;return}let t=await _(`作为财务优化专家，请针对"${{profit:`提升利润率`,cost:`降低成本`,cashflow:`改善现金流`,roi:`提升投资回报`}[V.value.target]}"目标，提供具体的优化方案：

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
5. 风险提示`,{systemInstruction:`你是一位财务优化专家，擅长提供财务优化方案`,temperature:.8});L.value=m.parse(t)}catch(e){console.error(`优化方案生成失败:`,e),d.error(`生成失败：`+(e.message||`未知错误`))}finally{N.value=!1}};return(i,d)=>{let m=l(`el-option`),h=l(`el-select`),g=l(`el-form-item`),_=l(`el-date-picker`),K=l(`el-button`),q=l(`el-form`);return a(),o(`div`,v,[d[9]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`💰 财务AI助手`),n(`p`,{class:`subtitle`},`智能财务分析与决策支持`)],-1),n(`div`,y,[(a(),o(u,null,s(R,e=>n(`div`,{key:e.id,onClick:t=>k.value=e.id,class:t([`tab-item`,{active:k.value===e.id}])},p(e.icon)+` `+p(e.name),11,b)),64))]),k.value===`analysis`?(a(),o(`div`,x,[f(q,{model:z.value,"label-width":`120px`},{default:r(()=>[f(g,{label:`分析类型`},{default:r(()=>[f(h,{modelValue:z.value.type,"onUpdate:modelValue":d[0]||=e=>z.value.type=e},{default:r(()=>[f(m,{label:`营收分析`,value:`revenue`}),f(m,{label:`成本分析`,value:`cost`}),f(m,{label:`利润分析`,value:`profit`}),f(m,{label:`现金流分析`,value:`cashflow`}),f(m,{label:`投资回报分析`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),f(g,{label:`时间范围`},{default:r(()=>[f(_,{modelValue:z.value.dateRange,"onUpdate:modelValue":d[1]||=e=>z.value.dateRange=e,type:`daterange`,"range-separator":`至`,"start-placeholder":`开始日期`,"end-placeholder":`结束日期`},null,8,[`modelValue`])]),_:1}),f(g,null,{default:r(()=>[f(K,{type:`primary`,onClick:H,loading:A.value},{default:r(()=>[...d[5]||=[c(` 开始分析 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),P.value?(a(),o(`div`,{key:0,class:`result-box`,innerHTML:P.value},null,8,S)):e(``,!0)])):e(``,!0),k.value===`forecast`?(a(),o(`div`,C,[f(q,{model:B.value,"label-width":`120px`},{default:r(()=>[f(g,{label:`预测类型`},{default:r(()=>[f(h,{modelValue:B.value.type,"onUpdate:modelValue":d[2]||=e=>B.value.type=e},{default:r(()=>[f(m,{label:`营收预测`,value:`revenue`}),f(m,{label:`成本预测`,value:`cost`}),f(m,{label:`利润预测`,value:`profit`}),f(m,{label:`现金流预测`,value:`cashflow`})]),_:1},8,[`modelValue`])]),_:1}),f(g,{label:`预测周期`},{default:r(()=>[f(h,{modelValue:B.value.period,"onUpdate:modelValue":d[3]||=e=>B.value.period=e},{default:r(()=>[f(m,{label:`未来1个月`,value:`1m`}),f(m,{label:`未来3个月`,value:`3m`}),f(m,{label:`未来6个月`,value:`6m`}),f(m,{label:`未来1年`,value:`1y`})]),_:1},8,[`modelValue`])]),_:1}),f(g,null,{default:r(()=>[f(K,{type:`primary`,onClick:U,loading:j.value},{default:r(()=>[...d[6]||=[c(` 生成预测 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),F.value?(a(),o(`div`,{key:0,class:`result-box`,innerHTML:F.value},null,8,w)):e(``,!0)])):e(``,!0),k.value===`risk`?(a(),o(`div`,T,[f(K,{type:`primary`,onClick:W,loading:M.value},{default:r(()=>[...d[7]||=[c(` 检查财务风险 `,-1)]]),_:1},8,[`loading`]),I.value?(a(),o(`div`,{key:0,class:`result-box`,innerHTML:I.value},null,8,E)):e(``,!0)])):e(``,!0),k.value===`optimization`?(a(),o(`div`,D,[f(q,{model:V.value,"label-width":`120px`},{default:r(()=>[f(g,{label:`优化目标`},{default:r(()=>[f(h,{modelValue:V.value.target,"onUpdate:modelValue":d[4]||=e=>V.value.target=e},{default:r(()=>[f(m,{label:`提升利润率`,value:`profit`}),f(m,{label:`降低成本`,value:`cost`}),f(m,{label:`改善现金流`,value:`cashflow`}),f(m,{label:`提升投资回报`,value:`roi`})]),_:1},8,[`modelValue`])]),_:1}),f(g,null,{default:r(()=>[f(K,{type:`primary`,onClick:G,loading:N.value},{default:r(()=>[...d[8]||=[c(` 生成优化方案 `,-1)]]),_:1},8,[`loading`])]),_:1})]),_:1},8,[`model`]),L.value?(a(),o(`div`,{key:0,class:`result-box`,innerHTML:L.value},null,8,O)):e(``,!0)])):e(``,!0)])}}},[[`__scopeId`,`data-v-8b183fe4`]]);export{k as t};