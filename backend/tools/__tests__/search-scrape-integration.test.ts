import { describe, it, expect, vi, afterEach } from "vitest";
import { CollectAgent } from "../../agents/collect-agent.js";
import type { ToolContext } from "../../runtime/capability/types.js";

const originalFetch = globalThis.fetch;

// ---------- 模拟外部网络 ----------

/** 一个"小互联网"：几个真实结构的产品页面 */
const INTERNET: Record<string, string> = {
  "https://www.apple.com.cn/iphone/": `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>iPhone - Apple (中国大陆)</title></head>
<body>
  <nav><a href="/">Apple</a><a href="/store">商店</a></nav>
  <div class="promo-banner"><span>限时特惠！以旧换新享折抵优惠</span></div>
  <main><article>
    <h1>选购 iPhone</h1>
    <section><h2>iPhone 16 Pro</h2>
      <p>A18 Pro 芯片，钛金属设计，4800 万像素 Fusion 摄像头系统。</p>
      <p class="price">RMB 7999 起</p>
    </section>
    <section><h2>iPhone 16</h2>
      <p>A18 芯片，铝金属设计，4800 万像素 Fusion 摄像头。</p>
      <p class="price">RMB 5999 起</p>
    </section>
  </article></main>
  <aside><h3>你可能还喜欢</h3><a>iPad</a></aside>
  <footer>© 2024 Apple Inc.</footer>
</body></html>`,
  "https://www.samsung.com/cn/smartphones/": `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>智能手机 | 三星电子 中国</title></head>
<body>
  <nav><a href="/">三星</a><a href="/mobile">手机</a></nav>
  <div class="event-banner"><span>新品发布会 7月10日</span></div>
  <main><article>
    <h1>Galaxy 智能手机</h1>
    <section><h2>Galaxy S24 Ultra</h2>
      <p>骁龙 8 Gen 3，钛金属框架，200MP 摄像头，内置 S Pen。</p>
      <p class="price">建议零售价 RMB 9699 起</p>
    </section>
    <section><h2>Galaxy Z Fold6</h2>
      <p>折叠大屏，7.6 英寸 Dynamic AMOLED，IP48 防水。</p>
      <p class="price">建议零售价 RMB 13999 起</p>
    </section>
  </article></main>
  <footer>© 2024 Samsung Electronics</footer>
</body></html>`,
};

function mockInternet(internet: Record<string, string>) {
  globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    if (urlStr.includes("api.duckduckgo.com")) {
      const topics = Object.entries(internet).map(([pageUrl, html]) => {
        const titleMatch = html.match(/<title>(.+?)<\/title>/);
        return { Text: titleMatch?.[1] ?? pageUrl, FirstURL: pageUrl };
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          AbstractURL: topics[0]?.FirstURL ?? "",
          AbstractText: "搜索结果摘要",
          Heading: "搜索",
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

// ---------- 测试 ----------

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CollectAgent 集成：web_search → web_scrape", () => {
  const ctx = {} as ToolContext;

  it("搜索两个产品，Agent 逐一抓取，链路完整不中断", async () => {
    mockInternet(INTERNET);

    const report = await CollectAgent("智能手机 横向对比", { maxPages: 2 }, ctx);
    console.log("searched:\n", report)

    expect(report.totalFound).toBe(2);
    expect(report.scrapedCount).toBe(2);

    for (const page of report.pages) {
      expect(page.searchRank).toBeGreaterThan(0);
      expect(page.url.length).toBeGreaterThan(0);
      expect(page.scrapeResult.error).toBeUndefined();
      expect(page.scrapeResult.content.length).toBeGreaterThan(50);
    }
  });

  it("Agent 抓取后各页内容互不相同（来自不同站点）", async () => {
    mockInternet(INTERNET);

    const report = await CollectAgent("iPhone Galaxy S24", { maxPages: 2 }, ctx);

    expect(report.pages.length).toBeGreaterThanOrEqual(2);

    const contents = report.pages.map((p) => p.scrapeResult.content);
    expect(new Set(contents).size).toBe(report.pages.length);
  });

  it("Agent 数量限制：只抓取 maxPages 条，不超出搜索结果数", async () => {
    // 用一个更大的"互联网"
    const bigInternet: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      bigInternet[`https://example.com/product-${i}`] =
        `<html><head><title>产品 ${i}</title></head><body><article><p>内容${i}</p></article></body></html>`;
    }
    mockInternet(bigInternet);

    const report = await CollectAgent("产品对比", { maxPages: 2 }, ctx);

    expect(report.totalFound).toBe(2); // maxResults = maxPages = 2
    expect(report.scrapedCount).toBe(2);
    expect(report.pages.every((p) => !p.scrapeResult.error)).toBe(true);
  });

  it("结果包含死链时，Agent 正常处理两者（幸存 + 报错），不阻断", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("api.duckduckgo.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            RelatedTopics: [
              { Text: "正常页面", FirstURL: "https://example.com/ok" },
              { Text: "已失效", FirstURL: "https://example.com/dead" },
            ],
          }),
        } as Response);
      }

      if (urlStr === "https://example.com/ok") {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          text: async () => "<html><head><title>存活页</title></head><body><article><p>数据</p></article></body></html>",
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as unknown as typeof fetch;

    const report = await CollectAgent("死链测试", { maxPages: 3 }, ctx);

    expect(report.pages.length).toBe(2);

    const ok = report.pages.filter((p) => !p.scrapeResult.error);
    const failed = report.pages.filter((p) => p.scrapeResult.error);

    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(ok[0].scrapeResult.content.length).toBeGreaterThan(0);
    expect(failed[0].scrapeResult.content).toBe("");
  });
});
