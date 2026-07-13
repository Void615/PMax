import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { ENTITY_RESOLVER_PROMPT } from "./prompts.js";

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

interface EntityResolverParams {
  dimension: string;
  records: StructuredRecord[];
}

export function createEntityResolver(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "entity_resolver",
    description: "合并语义相同的属性名，解决同义异名问题",
    parameters: {
      type: "object",
      properties: {
        dimension: { type: "string" },
        records: { type: "array", items: { type: "object" } },
      },
      required: ["dimension", "records"],
    },
    async execute(params: Record<string, any>, _ctx: ToolContext): Promise<{ merged: StructuredRecord[] }> {
      const { dimension, records } = params as unknown as EntityResolverParams;

      if (records.length <= 1) {
        return { merged: [] };
      }

      // Build a simplified representation for the LLM
      const simplified = records.map((r) => ({
        target: r.target,
        attribute: r.attribute,
        value: r.value,
        confidence: r.confidence,
        sourceTraceIds: r.sourceTraceIds,
        status: r.status,
      }));

      const prompt = ENTITY_RESOLVER_PROMPT
        .replace("{dimension}", dimension)
        .replace("{records}", JSON.stringify(simplified, null, 2));

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const extracted = JSON.parse((jsonMatch[1] ?? raw).trim());

      const merged: StructuredRecord[] = (extracted.merged ?? []).map((rec: any) => ({
        target: rec.target ?? records[0]!.target,
        dimension,
        attribute: rec.attribute,
        value: rec.value,
        rawValue: rec.rawValue ?? rec.value,
        confidence: rec.confidence ?? 0.8,
        sourceTraceIds: rec.sourceTraceIds ?? [],
        status: rec.status ?? "clean",
      }));

      return { merged };
    },
  };
}
