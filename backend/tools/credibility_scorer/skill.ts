import type { Tool, ToolContext } from "../../runtime/capability/types.js";

interface CredibilityParams {
  url: string;
  content: string;
  retrievedAt: string;
}

interface CredibilityResult {
  score: number;
  level: "high" | "medium" | "low" | "unknown";
  factors: {
    domain: number;
    freshness: number;
    contentLength: number;
  };
}

// Domain classification constants
const OFFICIAL_DOMAINS = [
  ".gov.cn", ".gov", ".edu.cn", ".edu",
];

const MEDIA_DOMAINS = [
  "techcrunch.com", "36kr.com", "geekpark.net", "theverge.com",
  "wired.com", "arstechnica.com", "infoq.cn", "sspai.com",
  "ifanr.com", "pingwest.com", "techweb.com.cn", "donews.com",
  "ithome.com", "cnbeta.com", "huxiu.com", "tmtpost.com",
];

const UGC_DOMAINS = [
  "zhihu.com", "reddit.com", "v2ex.com", "tieba.baidu.com",
  "douban.com", "weibo.com", "jianshu.com", "csdn.net",
  "juejin.cn", "segmentfault.com", "oschina.net",
];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function classifyDomain(hostname: string, content: string): number {
  // Official: matches well-known official/edu/gov
  for (const d of OFFICIAL_DOMAINS) {
    if (hostname.endsWith(d)) return 3;
  }

  // Media: known tech media
  for (const d of MEDIA_DOMAINS) {
    if (hostname.includes(d)) return 2;
  }

  // UGC: community/forum
  for (const d of UGC_DOMAINS) {
    if (hostname.includes(d)) return 1;
  }

  // Heuristic: if content mentions "官网" frequently, might be official
  const officialKeywordCount = (content.match(/官网|官方网站|official site/gi) ?? []).length;
  if (officialKeywordCount >= 2) return 2;

  return 1; // default low
}

function extractYear(content: string): number | null {
  // Try to find a year in the content like "2024", "2025", "2026"
  const yearMatch = content.match(/\b(20\d{2})\b/);
  if (yearMatch) return parseInt(yearMatch[1], 10);
  return null;
}

function computeFreshnessPenalty(content: string, retrievedAt: string): number {
  const currentYear = new Date().getFullYear();
  const contentYear = extractYear(content);

  if (!contentYear) return 0; // can't determine, no penalty

  const age = currentYear - contentYear;
  if (age <= 0.5) return 0;   // ≤6 months — no penalty
  if (age <= 1) return -1;     // ≤12 months
  if (age <= 2) return -1;     // ≤2 years
  return -2;                    // >2 years
}

function computeContentPenalty(content: string): number {
  if (content.length < 200) return -1;
  return 0;
}

export const credibilityScorer: Tool = {
  name: "credibility_scorer",
  description: "根据来源域名、时效性和内容完整性评估信息可信度",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      content: { type: "string" },
      retrievedAt: { type: "string" },
    },
    required: ["url", "content", "retrievedAt"],
  },
  async execute(params: Record<string, any>, _ctx: ToolContext): Promise<CredibilityResult> {
    const { url, content, retrievedAt } = params as unknown as CredibilityParams;
    const hostname = extractDomain(url);

    const domainScore = classifyDomain(hostname, content);
    const freshnessPenalty = computeFreshnessPenalty(content, retrievedAt);
    const contentPenalty = computeContentPenalty(content);

    const score = Math.max(0, domainScore + freshnessPenalty + contentPenalty);

    let level: CredibilityResult["level"];
    if (score >= 3) level = "high";
    else if (score >= 2) level = "medium";
    else if (score >= 1) level = "low";
    else level = "unknown";

    return {
      score,
      level,
      factors: {
        domain: domainScore,
        freshness: freshnessPenalty,
        contentLength: contentPenalty,
      },
    };
  },
};
