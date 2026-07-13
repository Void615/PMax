import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { SEARCH_PLANNER_PROMPT } from "./prompts.js";

interface SearchPlannerParams {
  targets: { name: string; url?: string; category?: string }[];
  dimensions: string[];
  constraints?: Record<string, any>;
}

interface SearchQuery {
  target: string;
  dimension: string;
  query: string;
  searchType: "broad" | "targeted";
}

interface SearchBatch {
  queries: SearchQuery[];
}

interface SearchPlan {
  batches: SearchBatch[];
}

export function createSearchPlanner(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "search_planner",
    description: "将竞品×维度网格分解为分批搜索计划",
    parameters: {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "object" } },
        dimensions: { type: "array", items: { type: "string" } },
        constraints: { type: "object" },
      },
      required: ["targets", "dimensions"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<SearchPlan> {
      const { targets, dimensions, constraints } = params as unknown as SearchPlannerParams;

      const targetNames = targets.map((t) => t.name);
      const extraContext = constraints
        ? `\n分析约束：${JSON.stringify(constraints)}`
        : "";

      const prompt = SEARCH_PLANNER_PROMPT
        .replace("{targets}", JSON.stringify(targetNames))
        .replace("{dimensions}", JSON.stringify(dimensions))
        .replace("{extraContext}", extraContext);

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const plan: SearchPlan = JSON.parse((jsonMatch[1] ?? raw).trim());

      // Sanitize: ensure each query has required fields with defaults
      for (const batch of plan.batches ?? []) {
        for (const q of batch.queries ?? []) {
          if (!q.searchType) {
            q.searchType = q.dimension === "pricing" ? "targeted" : "broad";
          }
        }
      }

      return plan;
    },
  };
}
