import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { webSearch } from "../web_search/skill.js";

interface UrlResolveParams {
  name: string;
  category?: string;
}

interface UrlResolveResult {
  url: string;
  sourceType: "official" | "appstore" | "database" | "inferred";
}

export function createCompetitorUrlResolver(
  llm: { complete(prompt: string): Promise<string> }
): Tool {
  return {
    name: "competitor_url_resolver",
    description: "根据产品名称和品类查找官方网站或应用商店URL",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "产品名称" },
        category: { type: "string", description: "产品品类（可选）" },
      },
      required: ["name"],
    },
    async execute(params: Record<string, any>, ctx: ToolContext): Promise<UrlResolveResult> {
      const { name, category } = params as unknown as UrlResolveParams;

      // Step 1: Search for the official URL
      const searchQuery = category
        ? `${name} ${category} 官网`
        : `${name} 官网`;
      const searchResult = await webSearch.execute(
        { query: searchQuery, maxResults: 5 },
        ctx
      );

      // Step 2: Use LLM to pick the most likely official URL from results
      const candidates = searchResult.items?.map(
        (item: { url: string; title: string; snippet: string }) =>
          `URL: ${item.url}\nTitle: ${item.title}\nSnippet: ${item.snippet}`
      ).join("\n\n") ?? "";

      // Also construct a likely URL pattern
      const inferredUrl = `https://${name.replace(/\s+/g, "").toLowerCase()}.com`;

      const prompt = `你是竞品分析助手。请根据以下信息判断产品 "{name}" 的官方网站或应用商店URL。

候选搜索结果：
${candidates || "（无搜索结果）"}

推断URL: ${inferredUrl}

请选择最可能的官方URL。判断标准：
- 优先选择包含产品名的官网域名（如 xxxx.com）
- 其次选择知名应用商店页面（如 app Store、Google Play）
- 再次选择知名数据库（如 Crunchbase、天眼查、企查查）
- 如果都不可用，使用推断的URL模式

输出 JSON:
{ "url": "https://...", "sourceType": "official|appstore|database|inferred" }

只输出 JSON。`;

      const raw = await llm.complete(prompt);
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const parsed = JSON.parse((jsonMatch[1] ?? raw).trim());

      return {
        url: parsed.url ?? inferredUrl,
        sourceType: parsed.sourceType ?? "inferred",
      };
    },
  };
}
