import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface SearchParams {
  query: string;
  maxResults?: number;
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
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { query, maxResults = 5 } = params as unknown as SearchParams;
    return {
      items: [{
        title: `搜索结果: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `关于 "${query}" 的搜索结果占位（接入真实搜索 API 后替换）`,
      }],
      totalResults: 1,
    };
  },
};
