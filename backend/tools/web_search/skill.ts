import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface SearchParams {
  query: string;
  maxResults?: number;
}

interface SearchItem {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResult {
  items: SearchItem[];
  totalResults: number;
}

const DDG_API_BASE = "https://api.duckduckgo.com/";

async function searchDDG(query: string): Promise<SearchItem[]> {
  const url = `${DDG_API_BASE}?q=${encodeURIComponent(query)}&format=json&no_html=1`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as Record<string, any>;
  const items: SearchItem[] = [];

  // 1. AbstractText — DDG 的主题摘要，作为第一条结果
  if (data.AbstractText && typeof data.AbstractText === "string") {
    items.push({
      title: typeof data.Heading === "string" ? data.Heading : "摘要",
      url: typeof data.AbstractURL === "string" ? data.AbstractURL : "",
      snippet: data.AbstractText,
    });
  }

  // 2. RelatedTopics — 相关主题列表，每个含 Text + FirstURL
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (topic.Text && topic.FirstURL) {
        items.push({
          title: topic.Text.includes(" - ")
            ? topic.Text.split(" - ")[0]!.trim()
            : topic.Text.slice(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }
  }

  // 3. Results — 外部链接，作为补充
  if (Array.isArray(data.Results)) {
    for (const result of data.Results) {
      if (result.Text && result.FirstURL) {
        items.push({
          title: result.Text.slice(0, 80),
          url: result.FirstURL,
          snippet: result.Text,
        });
      }
    }
  }

  return items;
}

export const webSearch: Tool = {
  name: "web_search",
  description: "通用网页搜索，返回搜索结果列表",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      maxResults: { type: "number", description: "最大结果数，默认 5" },
    },
    required: ["query"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<SearchResult> {
    const { query, maxResults = 5 } = params as unknown as SearchParams;

    try {
      const items = await searchDDG(query);
      const limited = items.slice(0, maxResults);
      return {
        items: limited,
        totalResults: limited.length,
      };
    } catch {
      // 网络异常时降级返回空结果，不抛错
      return { items: [], totalResults: 0 };
    }
  },
};
