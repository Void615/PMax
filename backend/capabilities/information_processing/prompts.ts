export const EXTRACT_PROMPT = `你是一个数据提取器。从以下原始竞品信息中提取结构化的对比数据。

对比维度：{dimension}
竞品：{target}
原始信息：
{rawContent}

对每个可识别的属性，提取：
- attribute: 属性名（如 "月费价格"、"免费版功能限制"）
- value: 归一化值（标准化表达，如统一货币和计费周期）
- confidence: 0-1 置信度

输出 JSON: { "records": [{ "attribute": "...", "value": "...", "confidence": 0.9 }] }

规则：
- 只提取原文明确提到的信息，不要推测
- 价格信息要统一货币和计费周期
- 功能描述分解为原子功能点
- confidence < 0.5 的记录不要输出

只输出 JSON。`;
