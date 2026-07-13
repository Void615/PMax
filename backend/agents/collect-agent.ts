import { webSearch } from "../tools/web_search/skill.js";
import { webScrape } from "../tools/web_scrape/skill.js";
import type { ToolContext } from "../runtime/capability/types.js";

/** Agent 单次搜索+抓取的结果 */
export interface CollectedPage {
  searchRank: number;
  searchSnippet: string;
  url: string;
  scrapeResult: Awaited<ReturnType<typeof webScrape.execute>>;
}

/** Agent 完整执行报告 */
export interface SearchReport {
  query: string;
  searchedAt: string;
  totalFound: number;
  scrapedCount: number;
  pages: CollectedPage[];
}

/**
 * 竞品信息采集 Agent。
 *
 * 模拟 information_collection Capability 中 LLM 规划 → 工具调用的简化版：
 * 1. 用给定查询调用 web_search
 * 2. 对搜索结果中所有 URL 依次调用 web_scrape
 * 3. 汇总为结构化报告
 *
 * 在生产环境中，这里会由 LLM 决定调哪个 tool、传什么参数。
 * Agent 本身不拥有 fetch/HTML 解析能力——这些全部由 tool 提供。
 */
export async function CollectAgent(
  query: string,
  options: { maxPages?: number },
  ctx: ToolContext,
): Promise<SearchReport> {
  const maxPages = options.maxPages ?? 3;

  // Step 1: 搜索
  const { items } = await webSearch.execute({ query, maxResults: maxPages }, ctx);

  // Step 2: 对每条搜索结果抓取详情
  const pages: CollectedPage[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const scrapeResult = await webScrape.execute({ url: item.url }, ctx);
    pages.push({
      searchRank: i + 1,
      searchSnippet: item.snippet,
      url: item.url,
      scrapeResult,
    });
  }

  return {
    query,
    searchedAt: new Date().toISOString(),
    totalFound: items.length,
    scrapedCount: pages.length,
    pages,
  };
}
