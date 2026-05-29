import{s as e}from"./rolldown-runtime-Bmd_1KMr.js";import{$t as t,Jt as n,Xt as r,Zt as i,en as a,gn as o,ln as s,pn as c,r as l,sn as u}from"./element-plus-Bnc69kxf.js";import{_ as d,g as f,s as p,y as m}from"./index-nwDdqFlp.js";var h={class:`competitor-analysis-ai`},g={class:`ai-sections`},_={class:`section-card`},v=[`innerHTML`],y={class:`section-card`},b=[`innerHTML`],x={class:`section-card`},S=[`innerHTML`],C=f({__name:`CompetitorAnalysisAI`,props:{feature:Object},setup(e){let f=o(``),C=o(!1),w=o(!1),T=o(!1),E=o(``),D=o(``),O=o(``),k=async()=>{C.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`});if(!e){l.error(`获取数据失败`);return}let t=await m(`分析竞品价格策略：
${f.value||`请基于行业平均水平分析`}

当前业务数据：
- 平均客单价：¥${e.finance?.averageOrderValue?.toFixed(2)||0}
- 商品总数：${e.products.total}
- 定价策略：标本艺术馆，高端定位

请提供：
1. 竞品价格对比分析
2. 价格优势/劣势
3. 定价建议
4. 价格竞争策略`,{systemInstruction:`你是市场分析专家，擅长竞品价格分析和定价策略`,temperature:.8});E.value=d.parse(t)}catch(e){l.error(`分析失败：`+(e.message||`未知错误`))}finally{C.value=!1}},A=async()=>{w.value=!0;try{let e=await m(`分析竞品营销策略：
${f.value||`请基于标本艺术/自然教育行业分析`}

请提供：
1. 竞品营销渠道分析
2. 内容营销策略
3. 促销活动分析
4. 品牌定位对比`,{systemInstruction:`你是营销策略专家，擅长分析竞品营销策略`,temperature:.8});D.value=d.parse(e)}catch(e){l.error(`分析失败：`+(e.message||`未知错误`))}finally{w.value=!1}},j=async()=>{T.value=!0;try{await p(!1,{useFinancialData:!0,period:`month`});let e=await m(`生成差异化竞争策略：
当前业务：
- 品牌：山海造物标本艺术馆
- 定位：自然美学、手作体验、教育价值
- 目标人群：25-40岁新中产、自然爱好者、教育焦虑家长
${f.value?`\n竞品信息：\n${f.value}`:``}

请提供：
1. 核心竞争力识别
2. 差异化定位建议
3. 独特卖点提炼
4. 竞争策略建议`,{systemInstruction:`你是战略定位专家，擅长差异化竞争策略`,temperature:.9});O.value=d.parse(e)}catch(e){l.error(`生成失败：`+(e.message||`未知错误`))}finally{T.value=!1}};return(e,o)=>{let l=s(`el-input`),d=s(`el-button`);return u(),i(`div`,h,[o[7]||=n(`div`,{class:`ai-header`},[n(`h3`,null,`🔍 竞品分析助手`),n(`p`,{class:`subtitle`},`AI分析竞品策略，提供竞争洞察与差异化建议`)],-1),n(`div`,g,[n(`div`,_,[o[2]||=n(`h4`,null,`💰 竞品价格分析`,-1),a(l,{modelValue:f.value,"onUpdate:modelValue":o[0]||=e=>f.value=e,type:`textarea`,rows:4,placeholder:`输入竞品信息：名称、价格、产品特点等...`,class:`query-input`},null,8,[`modelValue`]),a(d,{type:`primary`,onClick:k,loading:C.value,style:{"margin-top":`12px`}},{default:c(()=>[...o[1]||=[t(` 分析竞品价格 `,-1)]]),_:1},8,[`loading`]),E.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:E.value},null,8,v)):r(``,!0)]),n(`div`,y,[o[4]||=n(`h4`,null,`📢 竞品营销策略分析`,-1),a(d,{type:`primary`,onClick:A,loading:w.value},{default:c(()=>[...o[3]||=[t(` 分析营销策略 `,-1)]]),_:1},8,[`loading`]),D.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:D.value},null,8,b)):r(``,!0)]),n(`div`,x,[o[6]||=n(`h4`,null,`💡 差异化建议`,-1),a(d,{type:`primary`,onClick:j,loading:T.value},{default:c(()=>[...o[5]||=[t(` 生成差异化策略 `,-1)]]),_:1},8,[`loading`]),O.value?(u(),i(`div`,{key:0,class:`result-content`,innerHTML:O.value},null,8,S)):r(``,!0)])])])}}},[[`__scopeId`,`data-v-d605ce38`]]);export{C as default};