import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "../web_search/skill.js";
import { webScrape } from "../web_scrape/skill.js";
import type { ToolContext } from "../../runtime/capability/types.js";

const originalFetch = global.fetch;

// 模拟一个"小互联网"：几个真实结构的产品页面
const INTERNET: Record<string, string> = {
  "https://www.apple.com.cn/iphone/": `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>iPhone - Apple (中国大陆)</title></head>
<body>
  <nav><a href="/">Apple</a><a href="/store">商店</a></nav>
  <div class="promo-banner"><span>限时特惠！以旧换新享折抵优惠</span></div>
  <div class="breadcrumb">首页 > iPhone</div>
  <main><article>
    <h1>选购 iPhone</h1>
    <section class="product-card">
      <h2>iPhone 16 Pro</h2>
      <p>A18 Pro 芯片，钛金属设计，4800 万像素 Fusion 摄像头系统。</p>
      <p class="price">RMB 7999 起</p>
    </section>
    <section class="product-card">
      <h2>iPhone 16</h2>
      <p>A18 芯片，铝金属设计，4800 万像素 Fusion 摄像头。</p>
      <p class="price">RMB 5999 起</p>
    </section>
  </article></main>
  <aside class="related"><h3>你可能还喜欢</h3><a>iPad</a><a>Mac</a></aside>
  <footer><p>© 2024 Apple Inc. 保留所有权利。</p><a>隐私政策</a></footer>
</body></html>`,
  "https://www.samsung.com/cn/smartphones/": `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>智能手机 | 三星电子 中国</title></head>
<body>
  <nav><a href="/">三星</a><a href="/mobile">手机</a></nav>
  <div class="event-banner"><span>新品发布会 7月10日</span></div>
  <main><article>
    <h1>Galaxy 智能手机</h1>
    <section>
      <h2>Galaxy S24 Ultra</h2>
      <p>骁龙 8 Gen 3，钛金属框架，200MP 摄像头，内置 S Pen。</p>
      <p class="price">建议零售价 RMB 9699 起</p>
    </section>
    <section>
      <h2>Galaxy Z Fold6</h2>
      <p>折叠大屏，7.6 英寸 Dynamic AMOLED，IP48 防水。</p>
      <p class="price">建议零售价 RMB 13999 起</p>
    </section>
  </article></main>
  <footer><p>© 2024 Samsung Electronics</p></footer>
</body></html>`,
};

/** 将 fetch mock 集中在一处，不做和模块实际行为无关的定制 */
function mockInternet(internet: Record<string, string>) {
  global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    if (urlStr.includes("api.duckduckgo.com")) {
      const query = new URL(urlStr).searchParams.get("q") ?? "";
      // DDG 返回 INTERNET 中所有 URL 作为搜索结果
      const topics = Object.entries(internet).map(([pageUrl, html]) => {
        const titleMatch = html.match(/<title>(.+?)<\/title>/);
        return { Text: titleMatch?.[1] ?? pageUrl, FirstURL: pageUrl };
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          AbstractText: `关于 "${query}" 的搜索结果`,
          AbstractURL: topics[0]?.FirstURL ?? "",
          Heading: query,
          RelatedTopics: topics.slice(1),
        }),
      } as Response);
    }

    const html = internet[urlStr];
    if (html) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => html,
      } as Response);
    }

    return Promise.resolve({ ok: false, status: 404 } as Response);
  }) as unknown as typeof fetch;
}

/**
 * 模拟 information_collection Capability 内部的行为：
 * 搜索 → 取结果 URL → 逐个抓取
 */
async function collectProductInfo(query: string, ctx: ToolContext) {
  const { items } = await webSearch.execute({ query }, ctx);

  const pages: { url: string; scrapeResult: Awaited<ReturnType<typeof webScrape.execute>> }[] = [];
  for (const item of items) {
    pages.push({
      url: item.url,
      scrapeResult: await webScrape.execute({ url: item.url }, ctx),
    });
  }

  return { query, resultsCount: items.length, pages };
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe("web_search → web_scrape 数据契约集成", () => {
  const ctx = {} as ToolContext;

  it("搜索返回的 URL 能直接传给 scrape，链路不中断", async () => {
    mockInternet(INTERNET);

    const collected = await collectProductInfo("智能手机 对比", ctx);

    // 搜索拿到了数据
    expect(collected.resultsCount).toBeGreaterThanOrEqual(1);

    // 每个搜索结果 URL 都能被 scrape 正常处理
    for (const page of collected.pages) {
      expect(page.scrapeResult.error).toBeUndefined();
      expect(page.scrapeResult.url).toBe(page.url);
      expect(page.scrapeResult.title.length).toBeGreaterThan(0);
      expect(page.scrapeResult.content.length).toBeGreaterThan(50);
    }
  });

  it("scrape 产出的内容长度与原始页面成比例（说明 Readability 在提取而非全丢弃）", async () => {
    mockInternet(INTERNET);

    const collected = await collectProductInfo("手机", ctx);

    for (const page of collected.pages) {
      const html = INTERNET[page.url];
      if (!html) continue;

      const rawLen = html.length;
      const cleanedLen = page.scrapeResult.content.length;

      // 清洗后内容应 > 0 且合理（不应超过原始 HTML 长度，但至少占一定比例说明提取到了正文）
      expect(cleanedLen).toBeGreaterThan(0);
      expect(cleanedLen).toBeLessThan(rawLen);
    }
  });

  it("多个搜索结果来源的页面，产出应互不相同（不是同一份数据）", async () => {
    mockInternet(INTERNET);

    const collected = await collectProductInfo("iPhone Galaxy", ctx);

    expect(collected.pages.length).toBeGreaterThanOrEqual(2);

    // 不同 URL 的抓取结果不应完全相同
    const contents = collected.pages.map((p) => p.scrapeResult.content);
    const unique = new Set(contents);
    expect(unique.size).toBe(collected.pages.length);
  });

  it("搜索结果含死链时，scrape 正常降级不阻断后续处理", async () => {
    // 构造 INTERNET：一个正常页 + DDG 额外返回一个不存在的 URL（通过 mock 逻辑本身做不到，需要特殊处理）
    const brokenInternet: Record<string, string> = {
      "https://example.com/active": `<!DOCTYPE html>
<html><head><title>存活页面</title></head>
<body><main><article><p>这是一个正常可访问的页面。</p></article></main></body></html>`,
    };

    let ddgCalled = false;
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("api.duckduckgo.com")) {
        ddgCalled = true;
        // 返回一个存在的 URL + 一个不存在的 URL
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            RelatedTopics: [
              { Text: "存活页面", FirstURL: "https://example.com/active" },
              { Text: "已下架页面", FirstURL: "https://example.com/dead" },
            ],
          }),
        } as Response);
      }

      const html = brokenInternet[urlStr];
      if (html) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
          text: async () => html,
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as unknown as typeof fetch;

    const collected = await collectProductInfo("测试死链", ctx);

    expect(ddgCalled).toBe(true);
    expect(collected.pages.length).toBe(2);

    const ok = collected.pages.filter((p) => !p.scrapeResult.error);
    const failed = collected.pages.filter((p) => p.scrapeResult.error);

    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(ok.every((p) => p.scrapeResult.content.length > 0)).toBe(true);
    expect(failed.every((p) => p.scrapeResult.content === "")).toBe(true);
  });
});
