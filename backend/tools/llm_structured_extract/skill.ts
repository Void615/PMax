import type { Tool, ToolContext } from "../../runtime/capability/types.js";

export function createLlmStructuredExtract(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "llm_structured_extract",
    description: "调用 LLM 从文本中提取结构化 JSON 数据",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "待提取的原始文本" },
        schema: { type: "object", description: "期望输出的 JSON Schema" },
        instruction: { type: "string", description: "提取指令" },
      },
      required: ["text", "instruction"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<Record<string, any>> {
      const prompt = `${params.instruction}

输入文本：
${params.text}

${params.schema ? `请按以下 JSON Schema 输出：${JSON.stringify(params.schema)}` : "请输出 JSON。"}

只输出 JSON，不要包含其他内容。`;

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      return JSON.parse((jsonMatch[1] ?? raw).trim());
    },
  };
}
