import { describe, it, expect, vi, afterEach } from "vitest";
import { webScrape } from "../skill.js";

const originalFetch = global.fetch;

function mockFetchResponse(
  body: string,
  options: { ok?: boolean; status?: number; contentType?: string } = {}
) {
  const { ok = true, status = 200, contentType = "text/html; charset=utf-8" } = options;
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  } as Response);
}

describe("web_scrape - Readability", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should extract title and content from HTML page", async () => {
    mockFetchResponse(`<!DOCTYPE html>
<html><head><title>竞品分析页面</title></head>
<body><article><h1>产品功能对比</h1><p>微博支持去广告，知乎盐选支持无广告阅读。</p></article></body>
</html>`);

    const result = await webScrape.execute({ url: "https://example.com/product" }, {} as any);

    expect(result.url).toBe("https://example.com/product");
    expect(result.title).toBe("竞品分析页面");
    expect(result.content).toContain("产品功能对比");
    expect(result.content).toContain("去广告");
    expect(result.charCount).toBeGreaterThan(0);
  });

  it("should truncate content to maxChars", async () => {
    mockFetchResponse(`<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><p>${"A".repeat(500)}</p></body>
</html>`);

    const result = await webScrape.execute(
      { url: "https://example.com", maxChars: 20 },
      {} as any
    );

    expect(result.content.length).toBeLessThanOrEqual(20);
    expect(result.charCount).toBeGreaterThan(20);
  });

  it("should return error for non-HTML response", async () => {
    mockFetchResponse(JSON.stringify({ data: "not html" }), {
      contentType: "application/json",
    });

    const result = await webScrape.execute({ url: "https://example.com/api" }, {} as any);

    expect(result.error).toBeDefined();
    expect(result.content).toBe("");
  });

  it("should return error for HTTP 404", async () => {
    mockFetchResponse("Not Found", { ok: false, status: 404 });

    const result = await webScrape.execute({ url: "https://example.com/404" }, {} as any);

    expect(result.error).toBeDefined();
    expect(result.content).toBe("");
  });

  it("should return error on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await webScrape.execute({ url: "https://example.com/timeout" }, {} as any);

    expect(result.error).toBeDefined();
    expect(result.content).toBe("");
  });
});
