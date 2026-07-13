export const SWOT_GENERATOR_PROMPT = `基于以下对比数据，为竞品 {target} 生成 SWOT 分析。

对比数据：{data}
对比上下文：{comparisonContext}
置信度惩罚：{confidencePenalty}

输出 JSON: {
  "swot": [
    { "category": "strengths"|"weaknesses"|"opportunities"|"threats",
      "target": "{target}",
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
- 如果存在对比上下文，SWOT 应体现竞品间的相对定位
- 如果置信度惩罚不为 0，减少分析条目数量或标注不确定性

只输出 JSON。`;
