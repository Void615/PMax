export const SEARCH_PLAN_PROMPT = `你是一个竞品信息采集调度器。基于以下需求生成搜索计划。

竞品列表：{targets}
对比维度：{dimensions}

对每个（竞品，维度）组合生成 1-2 个搜索 query。
识别哪些 query 可以并行执行（彼此无数据依赖的放在同一个 batch）。

输出 JSON:
{
  "batches": [
    { "queries": [{ "target": "竞品A", "dimension": "功能", "query": "竞品A 功能特性 会员权益" }] }
  ]
}

规则：
- 搜索 query 要具体，包含竞品名称和维度关键词
- 优先搜索官方来源（官网、应用商店页面）
- 每个 batch 内的 queries 可并行，batch 之间串行

只输出 JSON。`;

export const SUFFICIENCY_PROMPT = `评估以下采集结果的充分性。

需求：{requirement}
已采集数据：{summary}
未覆盖的维度：{uncovered}

评分 1-5（5=完全充分），如果 < 3 分，建议补充哪些方向。

输出 JSON: { "score": 3, "verdict": "sufficient|insufficient", "suggestion": "..." }`;
