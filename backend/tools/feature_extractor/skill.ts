import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { FEATURE_EXTRACTOR_PROMPT } from "./prompts.js";

interface FeatureExtractorParams {
  target: string;
  dimension: string;
  rawContent: string;
  items: { traceId: string; sourceUrl: string }[];
}

interface StructuredRecord {
  target: string;
  dimension: string;
  attribute: string;
  value: string;
  rawValue?: string;
  confidence: number;
  sourceTraceIds: string[];
  status: "clean" | "conflicting" | "inferred";
}

export function createFeatureExtractor(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "feature_extractor",
    description: "从产品功能描述文本中提取结构化功能点",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "竞品名称" },
        dimension: { type: "string", description: "对比维度" },
        rawContent: { type: "string", description: "原始文本内容" },
        items: { type: "array", items: { type: "object" }, description: "来源条目 [{ traceId, sourceUrl }]" },
      },
      required: ["target", "dimension", "rawContent", "items"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<{ records: StructuredRecord[] }> {
      const { target, dimension, rawContent, items } = params as unknown as FeatureExtractorParams;

      const traceIds = items.map(i => i.traceId);

      const prompt = FEATURE_EXTRACTOR_PROMPT
        .replace("{target}", target)
        .replace("{dimension}", dimension)
        .replace("{rawContent}", rawContent.slice(0, 8000));

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const extracted = JSON.parse((jsonMatch[1] ?? raw).trim());

      const records: StructuredRecord[] = (extracted.records ?? []).map((rec: any) => ({
        target,
        dimension,
        attribute: rec.attribute,
        value: rec.value,
        rawValue: rec.rawValue ?? rec.value,
        confidence: rec.confidence ?? 0.8,
        sourceTraceIds: traceIds,
        status: "clean" as const,
      }));

      return { records };
    },
  };
}
