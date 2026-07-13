import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { COMPARISON_SUMMARIZER_PROMPT } from "./prompts.js";

export function createComparisonSummarizer(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "comparison_summarizer",
    description: "基于对比分析和洞察生成综合分析摘要（≤500字）",
    parameters: {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" }, description: "竞品名称列表" },
        matrixSummary: { type: "string", description: "对比矩阵摘要 JSON" },
        swotSummary: { type: "string", description: "SWOT 分析摘要 JSON" },
        insights: { type: "string", description: "差异化洞察 JSON" },
        imbalanceWarnings: { type: "array", items: { type: "string" }, description: "数据不平衡警告（可选）" },
      },
      required: ["targets", "matrixSummary", "swotSummary", "insights"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<{ summary: string }> {
      const { targets, matrixSummary, swotSummary, insights, imbalanceWarnings } = params;

      const prompt = COMPARISON_SUMMARIZER_PROMPT
        .replace("{targets}", JSON.stringify(targets))
        .replace("{matrixSummary}", matrixSummary)
        .replace("{swotSummary}", swotSummary)
        .replace("{insights}", insights)
        .replace("{imbalanceWarnings}", JSON.stringify(imbalanceWarnings ?? []));

      const raw = await llm.complete(prompt);
      return { summary: raw.trim().slice(0, 500) };
    },
  };
}
