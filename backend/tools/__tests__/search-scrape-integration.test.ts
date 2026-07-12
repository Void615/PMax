import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "../web_search/skill.js";
import { webScrape } from "../web_scrape/skill.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

/**
 * 真实的产品页风格 HTML：包含导航、侧栏、广告、页脚等噪音。
 * Readability 的任务是从中提取核心正文。
 */
const NOISY_PRODUCT_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <title>微博会员 - 官方权益页 - 微博</title>
  <meta name="description" content="微博会员权益详情">
</head>
<body>
  <nav class="global-nav">
    <a href="/">首页</a>
    <a href="/explore">发现</a>
    <a href="/vip">会员</a>
  </nav>

  <aside class="sidebar-ad">
    <img src="https://example.com/ad.jpg" alt="广告推广" />
    <span>限时优惠！开通年费立减30元</span>
  </aside>

  <div class="breadcrumb">首页 > 会员中心 > 权益详情</div>

  <main class="content">
    <article class="vip-detail">
      <h1>微博会员权益说明</h1>
      <section>
        <h2>基础权益</h2>
        <ul>
          <li>去广告：浏览微博时完全去除信息流广告</li>
          <li>专属标识：昵称后显示皇冠图标，彰显身份</li>
          <li>优先推荐：评论和转发优先展示在热门流</li>
        </ul>
      </section>
      <section>
        <h2>增值权益</h2>
        <p>专属客服：VIP 专属客服通道，问题优先处理，平均响应时间 30 分钟。</p>
        <p>个性装扮：每月可领取限定皮肤、卡片背景等装扮道具。</p>
      </section>
      <section class="pricing">
        <h2>定价方案</h2>
        <table>
          <tr><th>方案</th><th>价格</th><th>说明</th></tr>
          <tr><td>月度会员</td><td>15元/月</td><td>按月自动续费，可随时取消</td></tr>
          <tr><td>年度会员</td><td>118元/年</td><td>相当于 9.8元/月，节省 62元</td></tr>
        </table>
      </section>
    </article>
  </main>

  <aside class="related-products">
    <h3>你可能还感兴趣</h3>
    <a href="https://example.com/zhihu-vip">知乎盐选会员</a>
    <a href="https://example.com/bilibili-vip">B站大会员</a>
  </aside>

  <footer class="site-footer">
    <p>© 2024 微博公司. 京ICP备XXXXXXXX号</p>
    <a href="/privacy">隐私政策</a>
    <a href="/terms">服务条款</a>
  </footer>
</body>
</html>`;

/**
 * Readability 应该过滤掉导航、侧栏广告、面包屑、页脚等噪音，
 * 只保留 <main>/<article> 中的核心内容。
 * 我们不做逐字精确匹配（Readability 有轻微差异），
 * 但核心关键词必须出现，噪音必须被过滤。
 */
function assertCoreContentExtracted(content: string) {
  // 核心内容关键词必须存在
  expect(content).toContain("去广告");
  expect(content).toContain("专属标识");
  expect(content).toContain("优先推荐");
  expect(content).toContain("专属客服");
  expect(content).toContain("15元");
  expect(content).toContain("118元");
  // 噪音应该被过滤
  expect(content).not.toContain("广告推广");
  expect(content).not.toContain("京ICP备");
  expect(content).not.toContain("你可能还感兴趣");
}

describe("web_search → web_scrape 集成链路", () => {
  it("DDG 搜索结果 → Readability 清洗嘈杂产品页", async () => {
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("api.duckduckgo.com")) {
        // DDG API 返回搜索结果
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            AbstractText: "微博会员权益介绍，包含去广告、专属标识等功能",
            AbstractURL: "https://vip.weibo.com/rights",
            Heading: "微博会员",
            RelatedTopics: [
              {
                Text: "微博会员权益详解 - 官方帮助中心",
                FirstURL: "https://help.weibo.com/vip/rights",
              },
              {
                Text: "知乎盐选会员对比 - 会员权益哪家强",
                FirstURL: "https://example.com/compare/weibo-zhihu-vip",
              },
            ],
          }),
        } as Response);
      }

      // 产品页面返回嘈杂 HTML
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => NOISY_PRODUCT_PAGE,
      } as Response);
    }) as unknown as typeof fetch;

    // Step 1: 搜索
    const searchResult = await webSearch.execute(
      { query: "微博会员权益" },
      {} as any
    );

    expect(searchResult.items.length).toBeGreaterThanOrEqual(2);
    const firstUrl = searchResult.items[0].url;
    expect(firstUrl).toBe("https://vip.weibo.com/rights");

    // Step 2: 抓取 + Readability 清洗
    const scrapeResult = await webScrape.execute(
      { url: firstUrl },
      {} as any
    );

    expect(scrapeResult.title).toBe("微博会员 - 官方权益页 - 微博");
    assertCoreContentExtracted(scrapeResult.content);
    expect(scrapeResult.charCount).toBeGreaterThan(0);
  });

  it("抓取失败降级：搜索结果有效但目标页面不可达", async () => {
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("api.duckduckgo.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            RelatedTopics: [
              { Text: "已下架产品详情页", FirstURL: "https://dead.example.com/old-product" },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 404,
      } as Response);
    }) as unknown as typeof fetch;

    const searchResult = await webSearch.execute({ query: "已下架产品" }, {} as any);
    expect(searchResult.items.length).toBeGreaterThan(0);

    const scrapeResult = await webScrape.execute(
      { url: searchResult.items[0].url },
      {} as any
    );

    expect(scrapeResult.error).toBeDefined();
    expect(scrapeResult.content).toBe("");
  });
});
