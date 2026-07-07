export const COMPARISON_PROMPT = `你是一个竞品分析师。基于以下结构化对比数据，生成对比分析报告。

竞品：{targets}
维度：{dimensions}
数据：{data}

对每个可对比的属性，输出：
- dimension: 所属维度
- attribute: 属性名
- values: 各竞品的取值列表 [{target, value, sourceTraceId}]
- winner: 该属性表现最佳的竞品名（无明显优胜者则为 null）
- analysis: 一句差异分析

输出 JSON: { "comparisonMatrix": [...] }

规则：
- 每个属性必须在所有竞品中都有对应的值
- 如果某个竞品在该属性上无数据，value 设为 "无数据"
- analysis 要指出差异原因或值得关注的点
- 不要虚构数据

只输出 JSON。`;

export const SWOT_PROMPT = `基于以下对比数据，为竞品 {target} 生成 SWOT 分析。

对比数据：{data}

输出 JSON: {
  "swot": [
    { "category": "strengths"|"weaknesses"|"opportunities"|"threats",
      "point": "具体分析点（一句话）",
      "evidence": "数据支撑或推理依据",
      "sourceTraceIds": [] }
  ]
}

规则：
- 每类 2-5 条
- S/W 基于产品自身对比数据（功能、定价、体验等）
- O/T 基于外部环境推断（市场趋势、差异化机会、威胁）
- evidence 必须引用对比数据中的具体发现

只输出 JSON。`;

export const SUMMARY_PROMPT = `基于以下对比分析和 SWOT 结果，生成一段 200 字以内的综合分析摘要。

竞品：{targets}
对比矩阵摘要：{matrixSummary}
SWOT 摘要：{swotSummary}

摘要应涵盖：
1. 整体竞争格局概述
2. 各竞品的核心差异化优势
3. 关键发现或值得关注的趋势

直接输出摘要文本，不要 JSON。`;
