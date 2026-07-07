import type { Tool, ToolContext } from "../../runtime/capability/types.js";

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
      },
      required: ["target", "data"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const { target, data } = params;
      const prompt = `基于以下对比数据，为竞品 ${target} 生成 SWOT 分析。

对比数据：${data}

输出 JSON: {
  "swot": [
    { "category": "strengths"|"weaknesses"|"opportunities"|"threats",
      "point": "具体分析点",
      "evidence": "数据中的支撑证据" }
  ]
}

规则：每类 2-5 条。S/W 基于产品自身，O/T 基于外部环境。`;

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
