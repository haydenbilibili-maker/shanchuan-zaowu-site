import{On as e,Tn as t,an as n,ln as r,on as i,r as a,rn as o,un as s,xn as c,yn as l}from"./element-plus-DU8uayx_.js";import{H as u,N as d,j as f,x as p}from"./index-ILfaiQfc.js";var m={class:`competitor-analysis-ai`},h={class:`ai-sections`},g={class:`section-card`},_=[`innerHTML`],v={class:`section-card`},y=[`innerHTML`],b={class:`section-card`},x=[`innerHTML`],S=u({__name:`CompetitorAnalysisAI`,props:{feature:Object},setup(u){let S=e(``),C=e(!1),w=e(!1),T=e(!1),E=e(``),D=e(``),O=e(``),k=async()=>{C.value=!0;try{let e=await p(!1,{useFinancialData:!0,period:`month`});if(!e){a.error(`获取数据失败`);return}let t=await d(`分析竞品价格策略：
${S.value||`请基于行业平均水平分析`}

当前业务数据：
- 平均客单价：¥${e.finance?.averageOrderValue?.toFixed(2)||0}
- 商品总数：${e.products.total}
- 定价策略：标本艺术馆，高端定位

请提供：
1. 竞品价格对比分析
2. 价格优势/劣势
3. 定价建议
4. 价格竞争策略`,{systemInstruction:`你是市场分析专家，擅长竞品价格分析和定价策略`,temperature:.8});E.value=f.parse(t)}catch(e){a.error(`分析失败：`+(e.message||`未知错误`))}finally{C.value=!1}},A=async()=>{w.value=!0;try{let e=await d(`分析竞品营销策略：
${S.value||`请基于标本艺术/自然教育行业分析`}

请提供：
1. 竞品营销渠道分析
2. 内容营销策略
3. 促销活动分析
4. 品牌定位对比`,{systemInstruction:`你是营销策略专家，擅长分析竞品营销策略`,temperature:.8});D.value=f.parse(e)}catch(e){a.error(`分析失败：`+(e.message||`未知错误`))}finally{w.value=!1}},j=async()=>{T.value=!0;try{await p(!1,{useFinancialData:!0,period:`month`});let e=await d(`生成差异化竞争策略：
当前业务：
- 品牌：山海造物标本艺术馆
- 定位：自然美学、手作体验、教育价值
- 目标人群：25-40岁新中产、自然爱好者、教育焦虑家长
${S.value?`\n竞品信息：\n${S.value}`:``}

请提供：
1. 核心竞争力识别
2. 差异化定位建议
3. 独特卖点提炼
4. 竞争策略建议`,{systemInstruction:`你是战略定位专家，擅长差异化竞争策略`,temperature:.9});O.value=f.parse(e)}catch(e){a.error(`生成失败：`+(e.message||`未知错误`))}finally{T.value=!1}};return(e,a)=>{let u=c(`el-input`),d=c(`el-button`);return l(),i(`div`,m,[a[7]||=o(`div`,{class:`ai-header`},[o(`h3`,null,`🔍 竞品分析助手`),o(`p`,{class:`subtitle`},`AI分析竞品策略，提供竞争洞察与差异化建议`)],-1),o(`div`,h,[o(`div`,g,[a[2]||=o(`h4`,null,`💰 竞品价格分析`,-1),s(u,{modelValue:S.value,"onUpdate:modelValue":a[0]||=e=>S.value=e,type:`textarea`,rows:4,placeholder:`输入竞品信息：名称、价格、产品特点等...`,class:`query-input`},null,8,[`modelValue`]),s(d,{type:`primary`,onClick:k,loading:C.value,style:{"margin-top":`12px`}},{default:t(()=>[...a[1]||=[r(` 分析竞品价格 `,-1)]]),_:1},8,[`loading`]),E.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:E.value},null,8,_)):n(``,!0)]),o(`div`,v,[a[4]||=o(`h4`,null,`📢 竞品营销策略分析`,-1),s(d,{type:`primary`,onClick:A,loading:w.value},{default:t(()=>[...a[3]||=[r(` 分析营销策略 `,-1)]]),_:1},8,[`loading`]),D.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:D.value},null,8,y)):n(``,!0)]),o(`div`,b,[a[6]||=o(`h4`,null,`💡 差异化建议`,-1),s(d,{type:`primary`,onClick:j,loading:T.value},{default:t(()=>[...a[5]||=[r(` 生成差异化策略 `,-1)]]),_:1},8,[`loading`]),O.value?(l(),i(`div`,{key:0,class:`result-content`,innerHTML:O.value},null,8,x)):n(``,!0)])])])}}},[[`__scopeId`,`data-v-d605ce38`]]);export{S as default};