import type {
  Capability,
  CapabilityResult,
  RuntimeState,
  RuntimeContext,
  Tool,
} from "../../runtime/index.js";
import type { RequirementConfig, RawDataItem, CollectionReport } from "../shared/types.js";
import { webSearch } from "../../tools/web_search/skill.js";
import { webScrape } from "../../tools/web_scrape/skill.js";
import { createCompetitorUrlResolver } from "../../tools/competitor_url_resolver/skill.js";
import { createSearchPlanner } from "../../tools/search_planner/skill.js";
import { credibilityScorer } from "../../tools/credibility_scorer/skill.js";
import { createSufficiencyChecker } from "../../tools/sufficiency_checker/skill.js";

const MAX_COLLECTION_ROUNDS = 2;

export function createInformationCollectionCap(
  llm: { complete(prompt: string): Promise<string> }
): Capability {
  const competitorUrlResolverTool = createCompetitorUrlResolver(llm);
  const searchPlannerTool = createSearchPlanner(llm);
  const sufficiencyCheckerTool = createSufficiencyChecker(llm);

  const tools: Tool[] = [
    webSearch,
    webScrape,
    competitorUrlResolverTool,
    searchPlannerTool,
    credibilityScorer,
    sufficiencyCheckerTool,
  ];

  return {
    id: "information_collection",
    description: "按竞品×维度网格采集原始信息，支持URL发现、多维采集、可信度评分和充分性重采",
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

      // ── Step 1: URL discovery for targets without URLs ──
      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: { stage: "url_discovery", message: "正在解析竞品URL..." },
      });

      const targetsWithUrls = await Promise.all(
        config.targets.map(async (target) => {
          if (target.url) return target; // already has URL

          const result = await competitorUrlResolverTool.execute(
            { name: target.name, category: target.category },
            { traceId: ctx.traceId, runId: ctx.runId }
          );
          return { ...target, url: result.url };
        })
      );

      await ctx.emit({
        uiHint: "node_progress",
        eventType: "NODE_PROGRESS",
        payload: {
          stage: "url_discovery_complete",
          message: `URL解析完成: ${targetsWithUrls.map((t) => `${t.name} → ${t.url}`).join(", ")}`,
        },
      });

      // ── Main collection loop ──
      const allItems: RawDataItem[] = [];
      let collectionRounds = 0;
      let lastSufficiencyResult: { score: number; verdict: string; perDimension: Record<string, any>; suggestions: string[] } | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        collectionRounds++;

        // ── Step 2: Search planning (via tool, NOT bare llm.complete) ──
        await ctx.emit({
          uiHint: "node_progress",
          eventType: "NODE_PROGRESS",
          payload: { stage: "search_planning", message: `第 ${collectionRounds} 轮: 生成搜索计划...` },
        });

        const planResult = await searchPlannerTool.execute(
          {
            targets: targetsWithUrls.map((t) => ({ name: t.name, url: t.url, category: t.category })),
            dimensions: config.dimensions,
            constraints: config.constraints,
          },
          { traceId: ctx.traceId, runId: ctx.runId }
        );

        const plan = planResult as { batches: { queries: { target: string; dimension: string; query: string; searchType: string }[] }[] };

        // ── Step 3: Batch execution ──
        for (const batch of plan.batches ?? []) {
          const queries = batch.queries ?? [];

          const batchResults = await Promise.allSettled(
            queries.map(async (q) => {
              await ctx.emit({
                uiHint: "tool_call",
                eventType: "TOOL_CALL",
                payload: { toolName: "web_search", params: { query: q.query } },
              });

              const start = Date.now();
              const searchRes = await webSearch.execute(
                { query: q.query, maxResults: 3 },
                { traceId: ctx.traceId, runId: ctx.runId }
              );

              await ctx.emit({
                uiHint: "tool_result",
                eventType: "TOOL_RESULT",
                payload: { toolName: "web_search", durationMs: Date.now() - start, result: { query: q.query } },
              });

              // Pick top-2 URLs from search results
              const searchItems = searchRes.items ?? [];
              const topUrls = searchItems.slice(0, 2).filter(
                (item: any) => item.url && item.url.startsWith("http")
              );

              // Scrape each URL
              const scrapedItems = await Promise.allSettled(
                topUrls.map(async (searchItem: any) => {
                  await ctx.emit({
                    uiHint: "tool_call",
                    eventType: "TOOL_CALL",
                    payload: { toolName: "web_scrape", params: { url: searchItem.url } },
                  });

                  const scrapeStart = Date.now();
                  const scrapeRes = await webScrape.execute(
                    { url: searchItem.url, maxChars: 8000 },
                    { traceId: ctx.traceId, runId: ctx.runId }
                  );

                  await ctx.emit({
                    uiHint: "tool_result",
                    eventType: "TOOL_RESULT",
                    payload: { toolName: "web_scrape", durationMs: Date.now() - scrapeStart, result: { url: searchItem.url } },
                  });

                  const now = new Date().toISOString();

                  if (scrapeRes.error) {
                    // Fallback: use search snippet
                    return {
                      target: q.target,
                      dimension: q.dimension,
                      content: searchItem.snippet ?? "",
                      sourceUrl: searchItem.url,
                      sourceTitle: searchItem.title,
                      retrievedAt: now,
                      credibility: "low" as const,
                    };
                  }

                  return {
                    target: q.target,
                    dimension: q.dimension,
                    content: scrapeRes.content ?? "",
                    sourceUrl: searchItem.url,
                    sourceTitle: searchItem.title ?? scrapeRes.title ?? "",
                    retrievedAt: now,
                    credibility: "unknown" as const, // will be scored in step 4
                  };
                })
              );

              return scrapedItems;
            })
          );

          // Flatten and collect
          for (const result of batchResults) {
            if (result.status === "fulfilled") {
              for (const scrapedResult of result.value) {
                if (scrapedResult.status === "fulfilled") {
                  allItems.push(scrapedResult.value);
                }
              }
            }
          }
        }

        // ── Step 4: Credibility scoring (parallel) ──
        await ctx.emit({
          uiHint: "node_progress",
          eventType: "NODE_PROGRESS",
          payload: { stage: "credibility_scoring", message: `正在评估 ${allItems.length} 条数据的可信度...` },
        });

        const scoreResults = await Promise.allSettled(
          allItems.map(async (item) => {
            const scoreRes = await credibilityScorer.execute(
              { url: item.sourceUrl, content: item.content, retrievedAt: item.retrievedAt },
              { traceId: ctx.traceId, runId: ctx.runId }
            );
            return { item, score: scoreRes as { level: string } };
          })
        );

        for (const result of scoreResults) {
          if (result.status === "fulfilled") {
            result.value.item.credibility = (result.value.score.level as RawDataItem["credibility"]) ?? "unknown";
          }
        }

        // ── Step 5: Sufficiency check ──
        await ctx.emit({
          uiHint: "node_progress",
          eventType: "NODE_PROGRESS",
          payload: { stage: "sufficiency_check", message: "正在检查采集充分性..." },
        });

        const sufficiencyResult = await sufficiencyCheckerTool.execute(
          {
            rawDataItems: allItems,
            dimensions: config.dimensions,
            targetCount: targetsWithUrls.length,
          },
          { traceId: ctx.traceId, runId: ctx.runId }
        );

        const sufficiency = sufficiencyResult as { score: number; verdict: string; perDimension: Record<string, any>; suggestions: string[] };

        lastSufficiencyResult = sufficiency;

        await ctx.emit({
          uiHint: "node_progress",
          eventType: "NODE_PROGRESS",
          payload: {
            stage: "sufficiency_result",
            message: `采集充分性: ${sufficiency.score}/5 (${sufficiency.verdict})`,
            details: { perDimension: sufficiency.perDimension, suggestions: sufficiency.suggestions },
          },
        });

        // If sufficient or max rounds reached, stop
        if (sufficiency.score >= 3 || collectionRounds >= MAX_COLLECTION_ROUNDS) {
          break;
        }

        await ctx.emit({
          uiHint: "node_progress",
          eventType: "NODE_PROGRESS",
          payload: {
            stage: "recollection",
            message: `数据不充分 (${sufficiency.score}/5)，开始第 ${collectionRounds + 1} 轮补充采集...`,
          },
        });
      }

      // ── Step 6: Build report and group by dimension ──
      const perDimension: Record<string, { count: number; credibilityBreakdown: Record<string, number> }> = {};
      for (const dim of config.dimensions) {
        perDimension[dim] = { count: 0, credibilityBreakdown: { high: 0, medium: 0, low: 0, unknown: 0 } };
      }

      const rawData: Record<string, RawDataItem[]> = {};
      for (const item of allItems) {
        const key = item.dimension;
        if (!rawData[key]) rawData[key] = [];
        rawData[key].push(item);

        if (perDimension[key]) {
          perDimension[key]!.count++;
          perDimension[key]!.credibilityBreakdown[item.credibility]++;
        }
      }

      const totalItems = allItems.length;

      const report: CollectionReport = {
        totalItems,
        perDimension,
        sufficiencyScore: lastSufficiencyResult?.score ?? 1,
        sufficiencyVerdict: (lastSufficiencyResult?.verdict ?? "insufficient") as "sufficient" | "insufficient",
        collectionRounds,
      };

      const summary = `${totalItems} 条原始信息，覆盖 ${Object.keys(rawData).length} 个维度，充分性 ${report.sufficiencyScore}/5 (${report.collectionRounds} 轮采集)`;
      await ctx.emit({
        uiHint: "node_completed",
        eventType: "NODE_COMPLETED",
        payload: { summary, itemCount: totalItems, report },
      });

      return { patch: { rawData }, artifacts: [] };
    },
  };
}
