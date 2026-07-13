import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
  Tool,
} from "../../runtime/index.js";
import type { RequirementConfig, RawDataItem, StructuredRecord, ProcessingResult, ConflictReport } from "../shared/types.js";
import { createPricingNormalizer } from "../../tools/pricing_normalizer/skill.js";
import { createFeatureExtractor } from "../../tools/feature_extractor/skill.js";
import { createEntityResolver } from "../../tools/entity_resolver/skill.js";
import { createConflictDetector } from "../../tools/conflict_detector/skill.js";

function pickExtractor(dimension: string): "pricing" | "feature" {
  // Exact match or contains "pric" / "定价" / "价格" / "费用" / "付费"
  if (dimension === "pricing") return "pricing";
  const lower = dimension.toLowerCase();
  if (
    lower.includes("pric") ||
    lower.includes("定价") ||
    lower.includes("价格") ||
    lower.includes("费用") ||
    lower.includes("付费") ||
    lower.includes("cost") ||
    lower.includes("fee")
  ) {
    return "pricing";
  }
  return "feature";
}

export function createInformationProcessingCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const pricingNormalizer = createPricingNormalizer(llm);
  const featureExtractor = createFeatureExtractor(llm);
  const entityResolver = createEntityResolver(llm);
  const conflictDetector = createConflictDetector(llm);

  const tools: Tool[] = [
    pricingNormalizer,
    featureExtractor,
    entityResolver,
    conflictDetector,
  ];

  return {
    id: "information_processing",
    description: "清洗、去重、归一化原始采集数据，转化为结构化可对比格式",
    inputHints: ["rawData", "config"],
    outputHints: ["structuredData"],
    requires: ["information_collection"],
    tools,

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      const rawData = state.data.rawData as Record<string, RawDataItem[]> | undefined;

      if (!config || !rawData) return { patch: {}, artifacts: [] };

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "processing", dimensions: config.dimensions },
      });

      // ── Step 1 & 2: Dimension routing + extraction via Tools ──
      const allRecords: StructuredRecord[] = [];

      for (const target of config.targets) {
        for (const dimension of config.dimensions) {
          const items = rawData[dimension]?.filter(i => i.target === target.name) ?? [];
          if (items.length === 0) continue;

          const rawContent = items.map(i => i.content).join("\n---\n");
          const extractorType = pickExtractor(dimension);
          const tool = extractorType === "pricing" ? pricingNormalizer : featureExtractor;

          const inputItems = items.map((item, idx) => ({
            traceId: item.sourceUrl || `item-${idx}`,
            sourceUrl: item.sourceUrl,
          }));

          await ctx.emit({
            uiHint: "tool_call",
            eventType: "TOOL_CALL",
            payload: { toolName: tool.name, params: { target: target.name, dimension } },
          });

          const start = Date.now();
          const result = await tool.execute(
            {
              target: target.name,
              dimension,
              rawContent: rawContent.slice(0, 8000),
              items: inputItems,
            },
            { traceId: ctx.traceId, runId: ctx.runId }
          );

          await ctx.emit({
            uiHint: "tool_result",
            eventType: "TOOL_RESULT",
            payload: { toolName: tool.name, durationMs: Date.now() - start, result: { recordCount: (result as any).records?.length ?? 0 } },
          });

          const extractedRecords = (result as { records: StructuredRecord[] }).records ?? [];
          // Filter low-confidence
          for (const rec of extractedRecords) {
            if ((rec.confidence ?? 0) >= 0.5) {
              allRecords.push(rec);
            }
          }

          await ctx.emit({
            uiHint: "node_progress",
            eventType: "NODE_PROGRESS",
            payload: { stage: "processing", target: target.name, dimension, extracted: allRecords.length },
          });
        }
      }

      // ── Step 3: Entity resolution per dimension ──
      const resolvedRecords: StructuredRecord[] = [];
      const mergedByAttr = new Map<string, StructuredRecord>();

      for (const dimension of config.dimensions) {
        const dimRecords = allRecords.filter(r => r.dimension === dimension);
        if (dimRecords.length === 0) continue;

        await ctx.emit({
          uiHint: "tool_call",
          eventType: "TOOL_CALL",
          payload: { toolName: "entity_resolver", params: { dimension } },
        });

        const start = Date.now();
        const resolveResult = await entityResolver.execute(
          { dimension, records: dimRecords },
          { traceId: ctx.traceId, runId: ctx.runId }
        );

        await ctx.emit({
          uiHint: "tool_result",
          eventType: "TOOL_RESULT",
          payload: { toolName: "entity_resolver", durationMs: Date.now() - start, result: { merged: (resolveResult as any).merged?.length ?? 0 } },
        });

        const merged = (resolveResult as { merged: StructuredRecord[] }).merged ?? [];

        // Build a set of merged attribute names for this dimension
        const mergedAttrs = new Set(merged.map(m => m.attribute));

        // Keep original records for non-merged attributes (those with no synonym)
        const seenAttrs = new Set<string>();
        for (const rec of dimRecords) {
          // If this attribute was merged, skip the original
          if (mergedAttrs.has(rec.attribute)) {
            if (!seenAttrs.has(rec.attribute)) {
              // Add the merged version instead
              const mergedRec = merged.find(m => m.attribute === rec.attribute);
              if (mergedRec) {
                resolvedRecords.push(mergedRec);
              }
              seenAttrs.add(rec.attribute);
            }
          } else {
            // Keep original record (no synonym merge needed)
            resolvedRecords.push(rec);
          }
        }

        // Add any merged records whose attribute wasn't in original dimRecords
        for (const m of merged) {
          if (!seenAttrs.has(m.attribute)) {
            resolvedRecords.push(m);
          }
        }
      }

      // ── Step 4: Conflict detection ──
      let finalRecords = resolvedRecords;
      let conflicts: ConflictReport[] = [];

      if (resolvedRecords.length > 0) {
        await ctx.emit({
          uiHint: "tool_call",
          eventType: "TOOL_CALL",
          payload: { toolName: "conflict_detector", params: { recordCount: resolvedRecords.length } },
        });

        const start = Date.now();
        const conflictResult = await conflictDetector.execute(
          { records: resolvedRecords },
          { traceId: ctx.traceId, runId: ctx.runId }
        );

        await ctx.emit({
          uiHint: "tool_result",
          eventType: "TOOL_RESULT",
          payload: { toolName: "conflict_detector", durationMs: Date.now() - start, result: { conflictCount: (conflictResult as any).conflicts?.length ?? 0 } },
        });

        const cdResult = conflictResult as { records: StructuredRecord[]; conflicts: ConflictReport[] };
        if (cdResult.records?.length > 0) {
          finalRecords = cdResult.records;
        }
        conflicts = cdResult.conflicts ?? [];
      }

      // ── Step 5: Coverage matrix generation ──
      const coverageMatrix: Record<string, Record<string, "covered" | "inferred" | "missing">> = {};

      for (const target of config.targets) {
        coverageMatrix[target.name] = {};
        // Collect all unique attributes for this target
        const targetRecords = finalRecords.filter(r => r.target === target.name);
        const targetAttrs = new Set(targetRecords.map(r => r.attribute));

        // Also collect attributes from all targets for completeness
        const allAttrs = new Set(finalRecords.map(r => r.attribute));

        for (const attr of allAttrs) {
          const rec = targetRecords.find(r => r.attribute === attr);
          if (!rec) {
            coverageMatrix[target.name]![attr] = "missing";
          } else if (rec.status === "inferred") {
            coverageMatrix[target.name]![attr] = "inferred";
          } else {
            coverageMatrix[target.name]![attr] = "covered";
          }
        }
      }

      // ── Step 6: Result assembly ──
      const result: ProcessingResult = {
        records: finalRecords,
        uncoveredDimensions: config.dimensions.filter(
          d => !finalRecords.some(r => r.dimension === d)
        ),
        coverageMatrix,
        conflictCount: conflicts.length,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
      };

      // Group by dimension
      const structuredData: Record<string, StructuredRecord[]> = {};
      for (const rec of finalRecords) {
        if (!structuredData[rec.dimension]) structuredData[rec.dimension] = [];
        structuredData[rec.dimension].push(rec);
      }

      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { recordCount: finalRecords.length, dimensions: Object.keys(structuredData), conflictCount: conflicts.length },
      });

      return { patch: { structuredData }, artifacts: [] };
    },
  };
}
