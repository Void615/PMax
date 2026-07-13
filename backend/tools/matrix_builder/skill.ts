import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { MATRIX_BUILDER_PROMPT } from "./prompts.js";

export function createMatrixBuilder(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "matrix_builder",
    description: "基于结构化数据生成对比矩阵（每个属性一行，每个竞品一列）",
    parameters: {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" } },
        data: { type: "string", description: "结构化对比数据的 JSON 字符串" },
        dimensions: { type: "array", items: { type: "string" }, description: "对比维度列表（可选）" },
        coverageContext: { type: "string", description: "覆盖率上下文描述（可选）" },
        imbalanceWarnings: { type: "array", items: { type: "string" }, description: "数据不平衡警告（可选）" },
        confidencePenalty: { type: "number", description: "全局置信度惩罚系数 0-1（可选）" },
      },
      required: ["targets", "data"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const { targets, data, dimensions, coverageContext, imbalanceWarnings, confidencePenalty } = params;
      const prompt = MATRIX_BUILDER_PROMPT
        .replace("{targets}", JSON.stringify(targets))
        .replace("{data}", data)
        .replace("{dimensions}", JSON.stringify(dimensions ?? []))
        .replace("{coverageContext}", coverageContext ?? "无")
        .replace("{imbalanceWarnings}", JSON.stringify(imbalanceWarnings ?? []))
        .replace("{confidencePenalty}", String(confidencePenalty ?? 0));

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
