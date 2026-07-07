import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
  Tool,
} from "../../runtime/index.js";
import type { RequirementConfig, RawDataItem } from "../shared/types.js";
import { webSearch } from "../../tools/web_search/skill.js";
import { webScrape } from "../../tools/web_scrape/skill.js";
import { SEARCH_PLAN_PROMPT } from "./prompts.js";

export function createInformationCollectionCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const tools: Tool[] = [webSearch, webScrape];

  return {
    id: "information_collection",
    description: "按竞品×维度网格采集原始信息，支持多轮分竞品采集",
    inputHints: ["config"],
    outputHints: ["rawData"],
    requires: ["requirement_parsing"],
    tools,

    async execute(state: RuntimeState, ctx: RuntimeContext): Promise<CapabilityResult> {
      const config = state.data.config as RequirementConfig;
      if (!config) {
        return { patch: {}, artifacts: [] };
      }

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "planning", message: `准备采集 ${config.targets.length} 个竞品 × ${config.dimensions.length} 个维度的信息` },
      });

      // 1. LLM 生成搜索计划
      const searchTool = tools.find(t => t.name === "web_search")!;

      const planPrompt = SEARCH_PLAN_PROMPT
        .replace("{targets}", JSON.stringify(config.targets.map(t => t.name)))
        .replace("{dimensions}", JSON.stringify(config.dimensions));

      const planRaw = await llm.complete(planPrompt);
      const jsonMatch = planRaw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, planRaw];
      const plan = JSON.parse((jsonMatch[1] ?? planRaw).trim());

      const allItems: RawDataItem[] = [];

      // 2. 按 batch 执行搜索
      for (const batch of (plan.batches ?? [{ queries: [] }])) {
        const queries: { target: string; dimension: string; query: string }[] = batch.queries ?? [];

        const results = await Promise.allSettled(
          queries.map(async (q) => {
            await ctx.emit({
              uiHint: "tool_call",
              eventType: "TOOL_CALL",
              payload: { toolName: "web_search", params: { query: q.query } },
            });

            const start = Date.now();
            const res = await searchTool.execute({ query: q.query, maxResults: 3 }, { traceId: ctx.traceId, runId: ctx.runId });

            const item: RawDataItem = {
              target: q.target,
              dimension: q.dimension,
              content: res.items?.[0]?.snippet ?? JSON.stringify(res),
              sourceUrl: res.items?.[0]?.url ?? "",
              sourceTitle: res.items?.[0]?.title,
              retrievedAt: new Date().toISOString(),
              credibility: "medium",
            };

            await ctx.emit({
              uiHint: "tool_result",
              eventType: "TOOL_RESULT",
              payload: { toolName: "web_search", durationMs: Date.now() - start, result: { title: item.sourceTitle } },
            });

            return item;
          })
        );

        for (const r of results) {
          if (r.status === "fulfilled") allItems.push(r.value);
        }
      }

      // 3. 完成
      const summary = `${allItems.length} 条原始信息，覆盖 ${new Set(allItems.map(i => i.dimension)).size} 个维度`;
      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { summary, itemCount: allItems.length },
      });

      // 按 dimension 分组存储
      const rawData: Record<string, RawDataItem[]> = {};
      for (const item of allItems) {
        const key = item.dimension;
        if (!rawData[key]) rawData[key] = [];
        rawData[key].push(item);
      }

      return { patch: { rawData }, artifacts: [] };
    },
  };
}
