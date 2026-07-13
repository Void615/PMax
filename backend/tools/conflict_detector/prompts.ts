export const CONFLICT_DETECTOR_PROMPT = `你是一个冲突检测工具。检测同属性多来源之间的矛盾声明。

待检测记录：
{records}

规则化预检结果（已自动标记明显冲突）：
{ruleResults}

对每条记录：
- 如果属性值完全相同 → status: "clean"
- 如果是明确的语义相反（如 "免费" vs "付费"）→ status: "conflicting"，记录冲突
- 如果是同义表达（如 "¥99/月" vs "¥1188/年"） → status: "clean"（不冲突，仅表达方式不同）
- 如果是低置信度（confidence < 0.5）且无其他来源 → status: "inferred"

对每个冲突生成 ConflictReport：
- recordA, recordB: 冲突的两条记录
- nature: "value_contradiction"（值矛盾）或 "credibility_mismatch"（可信度不匹配）
- severity: "high"（严重矛盾，如免费 vs 收费）/ "medium"（中等差异）/ "low"（轻微差异）

输出 JSON: { "records": [...], "conflicts": [...] }

其中 records 是标记了 status 的完整记录列表。

只输出 JSON。`;
