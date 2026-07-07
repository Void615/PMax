import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface ScrapeParams {
  url: string;
  maxChars?: number;
}

export const webScrape: Tool = {
  name: "web_scrape",
  description: "抓取并清洗指定 URL 的网页内容",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "目标网页 URL" },
      maxChars: { type: "number", description: "最大返回字符数，默认 5000" },
    },
    required: ["url"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<any> {
    const { url, maxChars = 5000 } = params as unknown as ScrapeParams;
    return {
      url,
      title: `网页: ${url}`,
      content: `[占位] ${url} 的内容。接入真实抓取 API 后替换。`.slice(0, maxChars),
    };
  },
};
