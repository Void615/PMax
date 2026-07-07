import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createMatrixBuilder(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "matrix_builder",
    description: "基于结构化数据生成对比矩阵",
    parameters: {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" } },
        data: { type: "string", description: "结构化对比数据的 JSON 字符串" },
      },
      required: ["targets", "data"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
      const { targets, data } = params;
      const prompt = `你是一个竞品分析师。基于以下数据生成对比矩阵。

竞品：${JSON.stringify(targets)}
数据：${data}

对每个可对比的属性，输出一行：
- dimension: 所属维度
- attribute: 属性名
- values: 各竞品的取值列表
- winner: 该属性表现最佳的竞品名（无明显优胜者则为 null）
- analysis: 一句话差异分析

输出 JSON: { "comparisonMatrix": [...] }`;

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
