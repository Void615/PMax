import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface RawDataItem {
  target: string;
  dimension: string;
  content: string;
  sourceUrl: string;
  credibility: string;
}

interface SufficiencyParams {
  rawDataItems: RawDataItem[];
  dimensions: string[];
  targetCount: number;
}

interface PerDimensionInfo {
  itemCount: number;
  highCredCount: number;
  coverage: number; // 0-1
}

interface SufficiencyResult {
  score: number; // 1-5
  verdict: "sufficient" | "insufficient";
  perDimension: Record<string, PerDimensionInfo>;
  suggestions: string[];
}

function computePerDimension(
  items: RawDataItem[],
  dimensions: string[],
  targetCount: number
): Record<string, PerDimensionInfo> {
  const result: Record<string, PerDimensionInfo> = {};
  for (const dim of dimensions) {
    const dimItems = items.filter((i) => i.dimension === dim);
    const highCred = dimItems.filter((i) => i.credibility === "high").length;
    const uniqueTargets = new Set(dimItems.map((i) => i.target)).size;
    result[dim] = {
      itemCount: dimItems.length,
      highCredCount: highCred,
      coverage: targetCount > 0 ? uniqueTargets / targetCount : 0,
    };
  }
  return result;
}

function computeScore(
  perDim: Record<string, PerDimensionInfo>,
  dimensions: string[],
  items: RawDataItem[]
): number {
  let score = 5;

  for (const dim of dimensions) {
    const info = perDim[dim];
    if (!info) {
      score -= 1;
      continue;
    }
    // High credibility items < 3 per dimension
    if (info.highCredCount < 3) score -= 1;
    // Coverage < 80%
    if (info.coverage < 0.8) score -= 1;
    // Coverage < 50%
    if (info.coverage < 0.5) score -= 1;
    // Pricing dimension has zero official sources
    if (dim === "pricing") {
      const pricingItems = items.filter(
        (i) => i.dimension === "pricing" && i.credibility === "high"
      );
      if (pricingItems.length === 0) score -= 1;
    }
  }

  return Math.max(1, score);
}

export function createSufficiencyChecker(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "sufficiency_checker",
    description: "评估采集充分性，1-5评分并给出补充建议",
    parameters: {
      type: "object",
      properties: {
        rawDataItems: { type: "array", items: { type: "object" } },
        dimensions: { type: "array", items: { type: "string" } },
        targetCount: { type: "number" },
      },
      required: ["rawDataItems", "dimensions", "targetCount"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<SufficiencyResult> {
      const { rawDataItems, dimensions, targetCount } = params as unknown as SufficiencyParams;

      const perDimension = computePerDimension(rawDataItems, dimensions, targetCount);
      const score = computeScore(perDimension, dimensions, rawDataItems);

      // Use LLM to generate per-dimension suggestions
      const dimSummary = dimensions
        .map((d) => {
          const info = perDimension[d];
          return `${d}: ${info?.itemCount ?? 0} 条, 高可信 ${info?.highCredCount ?? 0} 条, 覆盖率 ${Math.round((info?.coverage ?? 0) * 100)}%`;
        })
        .join("\n");

      const prompt = `评估以下竞品信息采集的充分性。

对比维度统计：
${dimSummary}
竞品数量：${targetCount}
规则评分：${score}/5

对于每条维度，如果数据不足（覆盖率<80%或高可信条目<3），请给出具体的补充搜索建议。
建议专注于缺失的竞品或维度。

输出 JSON:
{ "suggestions": ["建议1", "建议2", ...] }

只输出 JSON。`;

      let suggestions: string[] = [];
      try {
        const raw = await llm.complete(prompt);
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
        const parsed = JSON.parse((jsonMatch[1] ?? raw).trim());
        suggestions = parsed.suggestions ?? [];
      } catch {
        // LLM failed — use rule-based fallback
        for (const dim of dimensions) {
          const info = perDimension[dim];
          if (info && info.coverage < 0.8) {
            suggestions.push(`补充${dim}维度的竞品数据，当前覆盖率仅${Math.round(info.coverage * 100)}%`);
          }
          if (info && info.highCredCount < 3) {
            suggestions.push(`${dim}维度高可信来源不足（当前${info.highCredCount}条），建议搜索官方来源`);
          }
        }
      }

      return {
        score,
        verdict: score >= 3 ? "sufficient" : "insufficient",
        perDimension,
        suggestions,
      };
    },
  };
}
