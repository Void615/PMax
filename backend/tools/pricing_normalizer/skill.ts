import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createPricingNormalizer(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "pricing_normalizer",
    description: "统一货币和计费周期，提取标准化价格层级",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "价格描述文本" },
      },
      required: ["text"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const prompt = `从以下价格信息中提取标准化定价层级。统一为 CNY/月。如果无法确定，标注 confidence 降低。
文本：${params.text}
输出 JSON: { "tiers": [{ "name": "套餐名", "price": 数字, "currency": "CNY", "billingCycle": "monthly", "confidence": 0.9 }] }`;
      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
