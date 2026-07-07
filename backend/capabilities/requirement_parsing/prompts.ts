export const PARSE_PROMPT = `你是一个需求解析器。从用户的自然语言输入中提取竞品分析的结构化参数。

用户输入：{userInput}

请提取以下信息：
1. 竞品列表（至少 2 个）
2. 对比维度（从以下选择：functionality 功能, pricing 定价, user_experience 用户体验, market_position 市场地位, technology 技术能力）
3. 输出产物格式（从以下选择：comparison_matrix 对比矩阵, swot SWOT分析, feature_list 功能列表, report 综合报告）
4. 约束条件（如有时间范围、地域等）

输出 JSON 格式：
{
  "analysisType": "product_comparison",
  "targets": [{ "name": "竞品名", "url": "可选URL", "category": "可选品类" }],
  "dimensions": ["functionality", "pricing"],
  "outputFormat": ["comparison_matrix", "swot"],
  "constraints": {}
}

规则：
- analysisType 目前固定为 "product_comparison"
- 如果用户未明确指出的维度，根据行业常识合理推断并补全
- targets 至少需要 2 个

只输出 JSON。`;
