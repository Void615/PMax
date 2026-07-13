# Task 1 Diff: vitest config + web_search tests

Commits: d8fdeac..2f14ee4

## Stats
- backend/tools/web_search/__tests__/skill.test.ts | 98 ++++++++++++++++++++++++
- backend/vitest.config.ts                         |  2 +-
- 2 files changed, 99 insertions(+), 1 deletion(-)

## Diff

```diff
diff --git a/backend/vitest.config.ts b/backend/vitest.config.ts
index a9e4524..a484935 100644
--- a/backend/vitest.config.ts
+++ b/backend/vitest.config.ts
@@ -1,7 +1,7 @@
 import { defineConfig } from "vitest/config";

 export default defineConfig({
   test: {
-    include: ["src/**/__tests__/**/*.test.ts", "entry/**/__tests__/**/*.test.ts"],
+    include: ["src/**/__tests__/**/*.test.ts", "entry/**/__tests__/**/*.test.ts", "tools/**/__tests__/**/*.test.ts"],
   },
 });
```

```diff
--- /dev/null
+++ b/backend/tools/web_search/__tests__/skill.test.ts
@@ -0,0 +1,98 @@
+import { describe, it, expect, vi, afterEach } from "vitest";
+import { webSearch } from "../skill.js";
+
+const originalFetch = global.fetch;
+
+function mockFetch(response: unknown, ok = true, status = 200) {
+  global.fetch = vi.fn().mockResolvedValue({
+    ok,
+    status,
+    json: async () => response,
+  });
+}
+
+describe("web_search - DDG API", () => {
+  afterEach(() => {
+    global.fetch = originalFetch;
+  });
+
+  it("should parse DDG response with AbstractText, RelatedTopics, and Results", async () => {
+    mockFetch({
+      AbstractText: "微博是一个社交媒体平台",
+      AbstractURL: "https://weibo.com",
+      Heading: "微博",
+      RelatedTopics: [
+        { Text: "微博会员 - 微博会员权益介绍", FirstURL: "https://weibo.com/vip" },
+        { Text: "微博功能 - 微博的主要功能", FirstURL: "https://weibo.com/features" },
+      ],
+      Results: [
+        { Text: "微博开放平台 API 文档", FirstURL: "https://open.weibo.com/wiki/API" },
+      ],
+    });
+
+    const result = await webSearch.execute({ query: "微博" }, {} as any);
+
+    expect(result.totalResults).toBeGreaterThanOrEqual(3);
+    expect(result.items[0]).toEqual({
+      title: "微博", url: "https://weibo.com", snippet: "微博是一个社交媒体平台",
+    });
+    expect(result.items[1]).toEqual({
+      title: "微博会员", url: "https://weibo.com/vip", snippet: "微博会员 - 微博会员权益介绍",
+    });
+    expect(result.items.some((item: { url: string }) => item.url === "https://open.weibo.com/wiki/API")).toBe(true);
+  });

+  it("should respect maxResults parameter", async () => {
+    mockFetch({
+      RelatedTopics: Array.from({ length: 10 }, (_, i) => ({
+        Text: `Topic ${i} - Description ${i}`, FirstURL: `https://example.com/${i}`,
+      })),
+    });
+    const result = await webSearch.execute({ query: "test", maxResults: 3 }, {} as any);
+    expect(result.items).toHaveLength(3);
+    expect(result.totalResults).toBe(3);
+  });

+  it("should return empty items when DDG returns no results", async () => {
+    mockFetch({});
+    const result = await webSearch.execute({ query: "xyznonexistent12345" }, {} as any);
+    expect(result.items).toEqual([]);
+    expect(result.totalResults).toBe(0);
+  });

+  it("should return empty items on network error", async () => {
+    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
+    const result = await webSearch.execute({ query: "test" }, {} as any);
+    expect(result.items).toEqual([]);
+    expect(result.totalResults).toBe(0);
+  });

+  it("should return empty items on non-ok response", async () => {
+    mockFetch({}, false, 500);
+    const result = await webSearch.execute({ query: "test" }, {} as any);
+    expect(result.items).toEqual([]);
+    expect(result.totalResults).toBe(0);
+  });
+});
```
