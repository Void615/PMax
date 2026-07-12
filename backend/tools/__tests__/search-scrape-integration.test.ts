import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "../web_search/skill.js";
import { webScrape } from "../web_scrape/skill.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function createFetchMock(responses: ((url: string) => Partial<Response> | Promise<Partial<Response>>)[]) {
  let callIndex = 0;
  global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const factory = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => "",
      ...factory(urlStr),
    });
  }) as unknown as typeof fetch;
}

describe("web_search → web_scrape 集成链路", () => {
  it("should search and scrape a product page end to end", async () => {
    createFetchMock([
      // 1st call: webSearch → DDG API
      () => ({
        json: async () => ({
          AbstractText: "微博会员权益介绍",
          AbstractURL: "https://vip.weibo.com",
          Heading: "微博会员",
        }),
      }),
      // 2nd call: webScrape → 产品页面
      () => ({
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => `<!DOCTYPE html>
<html><head><title>微博会员 - 官方权益页</title></head>
<body><article><h1>微博会员权益</h1><p>去广告，专属标识，优先推荐，专属客服。</p><p>月费15元，年费118元。</p></article></body>
</html>`,
      }),
    ]);

    // Step 1: 搜索
    const searchResult = await webSearch.execute({ query: "微博 会员" }, {} as any);
    expect(searchResult.items.length).toBeGreaterThan(0);
    expect(searchResult.items[0].url).toBe("https://vip.weibo.com");

    // Step 2: 抓取搜索结果页
    const scrapeResult = await webScrape.execute(
      { url: searchResult.items[0].url },
      {} as any
    );

    expect(scrapeResult.url).toBe("https://vip.weibo.com");
    expect(scrapeResult.title).toBe("微博会员 - 官方权益页");
    expect(scrapeResult.content).toContain("去广告");
    expect(scrapeResult.content).toContain("月费15元");
    expect(scrapeResult.content).toContain("年费118元");
    expect(scrapeResult.charCount).toBeGreaterThan(0);
  });

  it("should handle scrape failure gracefully after successful search", async () => {
    createFetchMock([
      // 1st call: webSearch → DDG API 正常
      () => ({
        json: async () => ({
          RelatedTopics: [
            { Text: "已下架产品 - 不可访问", FirstURL: "https://dead.example.com" },
          ],
        }),
      }),
      // 2nd call: webScrape → 产品页 404
      () => ({
        ok: false,
        status: 404,
      }),
    ]);

    // Step 1: 搜索成功
    const searchResult = await webSearch.execute({ query: "已下架产品" }, {} as any);
    expect(searchResult.items.length).toBeGreaterThan(0);

    // Step 2: 抓取失败但不抛错
    const scrapeResult = await webScrape.execute(
      { url: searchResult.items[0].url },
      {} as any
    );

    expect(scrapeResult.error).toBeDefined();
    expect(scrapeResult.content).toBe("");
  });
});
