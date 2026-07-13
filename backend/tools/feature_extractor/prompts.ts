export const FEATURE_EXTRACTOR_PROMPT = `你是一个功能点提取工具。从以下产品信息中提取结构化的功能属性。

竞品：{target}
对比维度：{dimension}
原始信息：
{rawContent}

对每个可识别的功能属性，提取：
- attribute: 属性名（如 "去广告"、"高清视频"、"多设备支持"）
- value: 归一化值（标准化表达，如 "支持"/"不支持" 或具体数值）
- rawValue: 原始文本值
- confidence: 0-1 置信度

输出 JSON: { "records": [{ "attribute": "...", "value": "...", "rawValue": "...", "confidence": 0.9 }] }

规则：
- 只提取原文明确提到的功能信息，不要推测
- 功能描述分解为原子功能点，每个功能点一句话概括
- 布尔型功能用 "支持"/"不支持" 表达
- confidence < 0.5 的记录不要输出

只输出 JSON。`;
