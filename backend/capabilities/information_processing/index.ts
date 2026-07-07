import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
} from "../../runtime/index.js";
import type { RequirementConfig, RawDataItem, StructuredRecord, ProcessingResult } from "../shared/types.js";
import { EXTRACT_PROMPT } from "./prompts.js";

export function createInformationProcessingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  return {
    id: "information_processing",
    description: "清洗、去重、归一化原始采集数据，转化为结构化可对比格式",
    inputHints: ["rawData", "config"],
    outputHints: ["structuredData"],
    requires: ["information_collection"],
    tools: [],

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;

      if (!config || !rawData) return { patch: {}, artifacts: [] };

      const allRecords: StructuredRecord[] = [];

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "processing", dimensions: config.dimensions },
      });

      // 按 (target, dimension) 分组处理
      for (const target of config.targets) {
        for (const dimension of config.dimensions) {
          const items = rawData[dimension]?.filter(i => i.target === target.name) ?? [];
          if (items.length === 0) continue;

          const rawContent = items.map(i => i.content).join("\n---\n");
          const prompt = EXTRACT_PROMPT
            .replace("{dimension}", dimension)
            .replace("{target}", target.name)
            .replace("{rawContent}", rawContent.slice(0, 8000));

          const raw = await llm.complete(prompt);
          const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
          try {
            const extracted = JSON.parse((jsonMatch[1] ?? raw).trim());
            for (const rec of (extracted.records ?? [])) {
              if ((rec.confidence ?? 0) >= 0.5) {
                allRecords.push({
                  target: target.name,
                  dimension,
                  attribute: rec.attribute,
                  value: rec.value,
                  rawValue: rec.rawValue,
                  confidence: rec.confidence,
                  sourceTraceIds: items.map(_i => ""),
                });
              }
            }
          } catch {
            // LLM 输出解析失败，跳过该组
          }

          await ctx.emit({
            uiHint: "node_progress",
            eventType: "NODE_PROGRESS",
            payload: { stage: "processing", target: target.name, dimension, extracted: allRecords.length },
          });
        }
      }

      const result: ProcessingResult = {
        records: allRecords,
        uncoveredDimensions: config.dimensions.filter(
          d => !allRecords.some(r => r.dimension === d)
        ),
      };

      // 按 dimension 分组
      const structuredData: Record<string, StructuredRecord[]> = {};
      for (const rec of allRecords) {
        if (!structuredData[rec.dimension]) structuredData[rec.dimension] = [];
        structuredData[rec.dimension].push(rec);
      }

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { recordCount: allRecords.length, dimensions: Object.keys(structuredData) },
      });

      return { patch: { structuredData }, artifacts: [] };
    },
  };
}
