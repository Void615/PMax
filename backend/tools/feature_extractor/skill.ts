import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createFeatureExtractor(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "feature_extractor",
    description: "从产品功能描述文本中提取结构化功能点",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "功能描述文本" },
      },
      required: ["text"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const prompt = `从以下产品功能描述中提取原子功能点列表，每个功能点一句话概括。
输出 JSON: { "features": ["功能点1", "功能点2", ...] }
文本：${params.text}`;
      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
