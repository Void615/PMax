export const ENTITY_RESOLVER_PROMPT = `你是一个实体解析工具。将语义相同的属性名合并，解决同义异名问题。

维度：{dimension}
待合并记录：
{records}

任务：
对记录按语义相似度分组。同义属性（如 "免广告"/"无广告"/"ad-free" / "去广告"）应合并为一个属性。
- 合并后的 attribute 取最常见的表达（中文优先）
- value 保留置信度最高的记录的值
- 合并所有记录的 sourceTraceIds

输出 JSON: { "merged": [{ "attribute": "...", "value": "...", "rawValue": "...", "confidence": 0.9, "sourceTraceIds": ["..."], "status": "clean" }] }

规则：
- 只合并确实语义相同的属性，不同含义的属性保持独立
- status 保持原始记录中的值（clean/inferred），合并后仍为 clean（除非所有源都是 inferred）
- 不要输出未被合并的记录（即没有同义词的记录）

只输出 JSON。`;
