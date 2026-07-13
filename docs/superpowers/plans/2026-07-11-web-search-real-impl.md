# web_search 真实实现（DDG API） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 web_search Tool 从硬编码占位桩替换为 DuckDuckGo Instant Answer API 真实搜索实现。

**Architecture:** 零外部依赖，使用 Node 18+ 内置 `fetch` 调用 `api.duckduckgo.com`，解析 DDG JSON 响应的 AbstractText / RelatedTopics / Results 字段组装搜索结果。网络超时/异常时降级返回空结果而不抛错，让上游 Capability 自行处理。

**Tech Stack:** TypeScript, Node 18+ fetch, vitest, DuckDuckGo Instant Answer API

## Global Constraints

- 使用 Node 18+ 内置 `fetch`，**不新增**任何 npm 依赖
- 输入/输出契约保持不变：输入 `{ query: string; maxResults?: number }`，输出 `{ items: SearchItem[]; totalResults: number }`
- 网络异常不抛错，降级返回 `{ items: [], totalResults: 0 }`
- 超时 8000ms（AbortSignal.timeout）
- manifest.json 不需要修改

---

### Task 1: 更新 vitest 配置 + 编写 web_search 单元测试（TDD）

**Files:**
- Modify: `backend/vitest.config.ts`
- Create: `backend/tools/web_search/__tests__/skill.test.ts`

**Interfaces:**
- Consumes: `webSearch` from `../../skill.js`（当前为 stub 版本）
- Produces: 5 个测试用例覆盖 DDG 响应解析的全部路径

- [ ] **Step 1: 更新 vitest 配置以包含 tools 目录**

在 `backend/vitest.config.ts` 的 `include` 数组中添加 `"tools/**/__tests__/**/*.test.ts"`：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts", "entry/**/__tests__/**/*.test.ts", "tools/**/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: 运行当前测试确认基线通过**

Run: `cd backend && npx vitest run`
Expected: 当前所有测试通过（66/66），新增 include 不影响现有测试。

- [ ] **Step 3: 创建测试目录**

```bash
mkdir -p backend/tools/web_search/__tests__
```

- [ ] **Step 4: 编写测试文件**

创建 `backend/tools/web_search/__tests__/skill.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearch } from "../skill.js";

// 保存原始 fetch 以便恢复
const originalFetch = global.fetch;

function mockFetch(response: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  });
}

describe("web_search - DDG API", () => {
  afterEach(() => {
    global.fetch = originalFetch;
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

    expect(result.totalResults).toBeGreaterThanOrEqual(3);
    expect(result.items[0]).toEqual({
      title: "微博",
      url: "https://weibo.com",
      snippet: "微博是一个社交媒体平台",
    });
    // RelatedTopics
    expect(result.items[1]).toEqual({
      title: "微博会员",
      url: "https://weibo.com/vip",
      snippet: "微博会员 - 微博会员权益介绍",
    });
    // Results
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

    expect(result.items).toHaveLength(3);
    expect(result.totalResults).toBe(3);
  });

  it("should return empty items when DDG returns no results", async () => {
    mockFetch({});

    const result = await webSearch.execute({ query: "xyznonexistent12345" }, {} as any);

    expect(result.items).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it("should return empty items on network error (graceful degradation)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await webSearch.execute({ query: "test" }, {} as any);

    expect(result.items).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it("should return empty items on non-ok response", async () => {
    mockFetch({}, false, 500);

    const result = await webSearch.execute({ query: "test" }, {} as any);

    expect(result.items).toEqual([]);
    expect(result.totalResults).toBe(0);
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

Run: `cd backend && npx vitest run tools/web_search/__tests__/skill.test.ts`
Expected: 5 个测试中大部分 FAIL，因为当前 stub 不调用 fetch，不会触发 DDG 解析逻辑。stub 总是返回 `totalResults: 1`，所以 `maxResults` 和空响应测试会失败。

- [ ] **Step 6: Commit**

```bash
git add backend/vitest.config.ts backend/tools/web_search/__tests__/skill.test.ts
git commit -m "$(cat <<'EOF'
test: add web_search DDG API unit tests (TDD)

Add 5 test cases for DDG Instant Answer API response parsing:
AbstractText/RelatedTopics/Results assembly, maxResults limiting,
empty response, network error fallback, non-ok response fallback.

Update vitest config to include tools/__tests__/.
EOF
)"
```

---

### Task 2: 将 web_search 从 stub 替换为真实 DDG API 实现

**Files:**
- Modify: `backend/tools/web_search/skill.ts`

**Interfaces:**
- Consumes: Node 18+ 内置 `fetch`, `AbortSignal.timeout`
- Produces: `webSearch.execute(params, ctx)` — 真实 DDG API 调用

- [ ] **Step 1: 用真实实现替换 skill.ts**

将 `backend/tools/web_search/skill.ts` 的内容替换为：

```typescript
import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface SearchParams {
  query: string;
  maxResults?: number;
}

interface SearchItem {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResult {
  items: SearchItem[];
  totalResults: number;
}

const DDG_API_BASE = "https://api.duckduckgo.com/";

async function searchDDG(query: string): Promise<SearchItem[]> {
  const url = `${DDG_API_BASE}?q=${encodeURIComponent(query)}&format=json&no_html=1`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as Record<string, any>;
  const items: SearchItem[] = [];

  // 1. AbstractText — DDG 的主题摘要，作为第一条结果
  if (data.AbstractText && typeof data.AbstractText === "string") {
    items.push({
      title: typeof data.Heading === "string" ? data.Heading : "摘要",
      url: typeof data.AbstractURL === "string" ? data.AbstractURL : "",
      snippet: data.AbstractText,
    });
  }

  // 2. RelatedTopics — 相关主题列表，每个含 Text + FirstURL
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (topic.Text && topic.FirstURL) {
        items.push({
          title: topic.Text.includes(" - ")
            ? topic.Text.split(" - ")[0]!.trim()
            : topic.Text.slice(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }
  }

  // 3. Results — 外部链接，作为补充
  if (Array.isArray(data.Results)) {
    for (const result of data.Results) {
      if (result.Text && result.FirstURL) {
        items.push({
          title: result.Text.slice(0, 80),
          url: result.FirstURL,
          snippet: result.Text,
        });
      }
    }
  }

  return items;
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
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<SearchResult> {
    const { query, maxResults = 5 } = params as unknown as SearchParams;

    try {
      const items = await searchDDG(query);
      const limited = items.slice(0, maxResults);
      return {
        items: limited,
        totalResults: limited.length,
      };
    } catch {
      // 网络异常时降级返回空结果，不抛错
      return { items: [], totalResults: 0 };
    }
  },
};
```

- [ ] **Step 2: 运行 web_search 单元测试确认通过**

Run: `cd backend && npx vitest run tools/web_search/__tests__/skill.test.ts`
Expected: 5/5 测试全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add backend/tools/web_search/skill.ts
git commit -m "$(cat <<'EOF'
feat: replace web_search stub with real DDG Instant Answer API

Use DuckDuckGo Instant Answer API (api.duckduckgo.com) with zero
external dependencies. Parse AbstractText, RelatedTopics, and
Results from DDG JSON response. 8s timeout via AbortSignal.
Graceful degradation: network errors return empty results.

EOF
)"
```

---

### Task 3: 运行全量测试回归验证

**Files:**
- （无文件修改，仅验证）

**Interfaces:**
- Consumes: 完整的测试套件（66 unit tests + 5 new web_search tests）
- Produces: 确认 web_search 实现变更未破坏现有工作流

- [ ] **Step 1: 运行全量单元测试**

Run: `cd backend && npx vitest run`
Expected: 所有测试通过（66 + 5 = ~71 个），含 workflow E2E 测试和 HITL 测试。

- [ ] **Step 2: 运行 E2E 测试**

Run: `cd backend && npx vitest run --config vitest.config.e2e.ts`
Expected: 5/5 E2E 测试通过。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 零类型错误。

