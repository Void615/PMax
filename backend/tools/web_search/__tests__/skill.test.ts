import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "../skill.js";

const originalFetch = globalThis.fetch;

function mockFetch(response: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  });
}

describe("web_search - DDG API", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should parse DDG response with AbstractText, RelatedTopics, and Results", async () => {
    mockFetch({
      AbstractText: "微博是一个社交媒体平台",
      AbstractURL: "https://weibo.com",
      Heading: "微博",
      RelatedTopics: [
        {
          Text: "微博会员 - 微博会员权益介绍",
          FirstURL: "https://weibo.com/vip",
        },
        {
          Text: "微博功能 - 微博的主要功能",
          FirstURL: "https://weibo.com/features",
        },
      ],
      Results: [
        {
          Text: "微博开放平台 API 文档",
          FirstURL: "https://open.weibo.com/wiki/API",
        },
      ],
    });

    const result = await webSearch.execute({ query: "微博" }, {} as any);
    console.log(result);

    expect(result.totalResults).toBeGreaterThanOrEqual(3);
    expect(result.items[0]).toEqual({
      title: "微博",
      url: "https://weibo.com",
      snippet: "微博是一个社交媒体平台",
    });
    expect(result.items[1]).toEqual({
      title: "微博会员",
      url: "https://weibo.com/vip",
      snippet: "微博会员 - 微博会员权益介绍",
    });
    expect(result.items.some((item: { url: string }) => item.url === "https://open.weibo.com/wiki/API")).toBe(true);
  });

  it("should respect maxResults parameter", async () => {
    mockFetch({
      RelatedTopics: Array.from({ length: 10 }, (_, i) => ({
        Text: `Topic ${i} - Description ${i}`,
        FirstURL: `https://example.com/${i}`,
      })),
    });

    const result = await webSearch.execute({ query: "test", maxResults: 3 }, {} as any);
    console.log(result);

    expect(result.items).toHaveLength(3);
    expect(result.totalResults).toBe(3);
  });

  it("should return empty items when DDG returns no results", async () => {
    mockFetch({});

    const result = await webSearch.execute({ query: "xyznonexistent12345" }, {} as any);
    console.log(result);

    expect(result.items).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it("should return empty items on network error (graceful degradation)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await webSearch.execute({ query: "test" }, {} as any);
    console.log(result);

    expect(result.items).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it("should return empty items on non-ok response", async () => {
    mockFetch({}, false, 500);

    const result = await webSearch.execute({ query: "test" }, {} as any);
    console.log(result);

    expect(result.items).toEqual([]);
    expect(result.totalResults).toBe(0);
  });
});
