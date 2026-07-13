import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { SWOT_GENERATOR_PROMPT } from "./prompts.js";

export function createSwotGenerator(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "swot_generator",
    description: "为指定竞品生成 SWOT 分析",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "竞品名称" },
        data: { type: "string", description: "该竞品的对比数据 JSON 字符串" },
        comparisonContext: { type: "string", description: "跨竞品对比上下文（可选）" },
        confidencePenalty: { type: "number", description: "全局置信度惩罚系数 0-1（可选）" },
      },
      required: ["target", "data"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const { target, data, comparisonContext, confidencePenalty } = params;
      const prompt = SWOT_GENERATOR_PROMPT
        .replace("{target}", target)
        .replace("{data}", data)
        .replace("{comparisonContext}", comparisonContext ?? "无")
        .replace("{confidencePenalty}", String(confidencePenalty ?? 0));

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
