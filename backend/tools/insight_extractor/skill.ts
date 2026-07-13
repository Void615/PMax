import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import type { Insight } from "../../capabilities/shared/types.js";
import { INSIGHT_EXTRACTOR_PROMPT } from "./prompts.js";

export function createInsightExtractor(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "insight_extractor",
    description: "以自身产品为参照系提取差异化竞争洞察",
    parameters: {
      type: "object",
      properties: {
        comparisonMatrix: { type: "array", items: { type: "object" }, description: "对比矩阵数据" },
        swot: { type: "array", items: { type: "object" }, description: "SWOT 分析数据" },
        ownProduct: { type: "string", description: "自身产品名称" },
        imbalanceWarnings: { type: "array", items: { type: "string" }, description: "数据不平衡警告（可选）" },
        confidencePenalty: { type: "number", description: "全局置信度惩罚系数 0-1（可选）" },
      },
      required: ["comparisonMatrix", "swot", "ownProduct"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<{ insights: Insight[] }> {
      const { comparisonMatrix, swot, ownProduct, imbalanceWarnings, confidencePenalty } = params;

      const prompt = INSIGHT_EXTRACTOR_PROMPT
        .replace("{ownProduct}", ownProduct)
        .replace("{comparisonMatrixSummary}", JSON.stringify(comparisonMatrix ?? []))
        .replace("{swotSummary}", JSON.stringify(swot ?? []))
        .replace("{imbalanceWarnings}", JSON.stringify(imbalanceWarnings ?? []))
        .replace("{confidencePenalty}", String(confidencePenalty ?? 0));

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const extracted = JSON.parse((jsonMatch[1] ?? raw).trim());

      const insights: Insight[] = (extracted.insights ?? []).map((ins: any) => ({
        category: ins.category ?? "gap",
        statement: ins.statement ?? "",
        evidence: ins.evidence ?? "",
        relatedTargets: ins.relatedTargets ?? [],
        sourceTraceIds: ins.sourceTraceIds ?? [],
      }));

      return { insights };
    },
  };
}
