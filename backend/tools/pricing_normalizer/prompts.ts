export const PRICING_NORMALIZER_PROMPT = `你是一个价格归一化工具。从以下价格信息中提取标准化的定价层级。

竞品：{target}
对比维度：{dimension}
原始信息：
{rawContent}

对每个可识别的价格属性，提取：
- attribute: 属性名（如 "月费价格"、"年费价格"、"免费版功能限制"）
- value: 归一化值（统一为 CNY/月，标注货币和计费周期）
- rawValue: 原始文本值
- confidence: 0-1 置信度

输出 JSON: { "records": [{ "attribute": "...", "value": "...", "rawValue": "...", "confidence": 0.9 }] }

规则：
- 只提取原文明确提到的价格信息，不要推测
- 统一货币为 CNY，计费周期统一折算为月
- 如果是免费套餐，明确标注 "免费"
- confidence < 0.5 的记录不要输出

只输出 JSON。`;
