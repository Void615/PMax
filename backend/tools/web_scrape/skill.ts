import type { Tool, ToolContext } from "../../runtime/capability/types.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

interface ScrapeParams {
  url: string;
  maxChars?: number;
}

interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  charCount: number;
  error?: string;
}

const DEFAULT_MAX_CHARS = 8000;

async function scrapeHTML(url: string): Promise<ScrapeResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "PMax/0.2 (product-analysis-bot)" },
  });

  if (!response.ok) {
    return { url, title: "", content: "", charCount: 0, error: `HTTP ${response.status}` };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return {
      url,
      title: "",
      content: "",
      charCount: 0,
      error: `非 HTML 内容 (${contentType})`,
    };
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent) {
    return {
      url,
      title: dom.window.document.title || "",
      content: dom.window.document.body?.textContent?.replace(/\s+/g, " ").trim() || "",
      charCount: 0,
    };
  }

  const fullText = article.textContent.replace(/\s+/g, " ").trim();
  return {
    url,
    title: article.title || "",
    content: fullText,
    charCount: fullText.length,
  };
}

export const webScrape: Tool = {
  name: "web_scrape",
  description: "抓取并清洗指定 URL 的网页内容",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "目标网页 URL" },
      maxChars: { type: "number", description: "最大返回字符数，默认 8000" },
    },
    required: ["url"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<ScrapeResult> {
    const { url, maxChars = DEFAULT_MAX_CHARS } = params as unknown as ScrapeParams;

    try {
      const result = await scrapeHTML(url);
      if (result.error) {
        return result;
      }
      return {
        ...result,
        content: result.content.slice(0, maxChars),
      };
    } catch (err) {
      return {
        url,
        title: "",
        content: "",
        charCount: 0,
        error: err instanceof Error ? err.message : "抓取失败",
      };
    }
  },
};
