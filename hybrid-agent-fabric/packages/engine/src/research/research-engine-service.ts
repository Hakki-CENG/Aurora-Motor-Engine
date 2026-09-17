/**
 * Research Engine Service
 * Multi-source search, source trust scoring, citation verification,
 * contradiction analysis, report generation.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonState } from "../util/aurora-state.js";

// ─── Types ───

export interface ResearchQuery {
  id: string;
  tenantId: string;
  query: string;
  scope: "academic" | "web" | "internal" | "hybrid";
  filters?: ResearchFilters;
  createdAt: string;
}

export interface ResearchFilters {
  dateRange?: { from: string; to: string };
  languages?: string[];
  sourceTypes?: string[];
  minTrustScore?: number;
  maxResults?: number;
}

export interface ResearchResult {
  id: string;
  queryId: string;
  tenantId: string;
  sources: ResearchSource[];
  contradictions: Contradiction[];
  report?: ResearchReport;
  metadata: ResearchMetadata;
  createdAt: string;
}

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  author?: string;
  publishedAt?: string;
  sourceType: "academic" | "news" | "blog" | "documentation" | "government" | "internal" | "unknown";
  trustScore: number; // 0-1
  relevanceScore: number; // 0-1
  citations: Citation[];
  verified: boolean;
  verificationDetails?: VerificationResult;
}

export interface Citation {
  id: string;
  text: string;
  sourceId: string;
  location?: { page?: number; paragraph?: number; line?: number };
  context: string;
  verified: boolean;
}

export interface VerificationResult {
  status: "verified" | "unverified" | "disputed" | "retracted";
  confidence: number;
  evidence: string[];
  checkedAt: string;
}

export interface Contradiction {
  id: string;
  sourceA: string;
  sourceB: string;
  claimA: string;
  claimB: string;
  severity: "major" | "minor" | "contextual";
  resolution?: string;
}

export interface ResearchReport {
  id: string;
  title: string;
  summary: string;
  sections: ReportSection[];
  citations: Citation[];
  metadata: ReportMetadata;
  generatedAt: string;
}

export interface ReportSection {
  title: string;
  content: string;
  citations: string[]; // citation IDs
  subsections?: ReportSection[];
}

export interface ReportMetadata {
  totalSources: number;
  avgTrustScore: number;
  contradictionsFound: number;
  contradictionsResolved: number;
  wordCount: number;
}

export interface ResearchMetadata {
  searchDurationMs: number;
  sourcesScanned: number;
  sourcesSelected: number;
  trustScoreDistribution: Record<string, number>;
}

// ─── Trust Score ───

export interface TrustScoreFactors {
  domainAge?: number;
  httpsEnabled: boolean;
  hasAuthor: boolean;
  hasCitations: boolean;
  sourceReputation: number; // 0-1
  factCheckScore?: number; // 0-1
  peerReviewed?: boolean;
}

// ─── State ───

interface ResearchState {
  schemaVersion: number;
  queries: ResearchQuery[];
  results: ResearchResult[];
  reports: ResearchReport[];
  trustCache: Record<string, { score: number; factors: TrustScoreFactors; updatedAt: string }>;
}

export class ResearchEngineService {
  private store: DurableJsonState<ResearchState>;

  constructor(private baseDir: string) {
    this.store = new DurableJsonState<ResearchState>(
      join(baseDir, "research-engine.json"),
      () => ({ schemaVersion: 1, queries: [], results: [], reports: [], trustCache: {} }),
      (v) => { const s = v as ResearchState; return !!s && s.schemaVersion === 1; },
      "Research engine service",
    );
  }

  async init(): Promise<void> { await this.store.read(); }

  // ─── Research Execution ───

  async research(tenantId: string, query: string, scope: ResearchQuery["scope"] = "hybrid", filters: ResearchFilters = {}): Promise<ResearchResult> {
    const start = Date.now();

    const queryRecord: ResearchQuery = {
      id: randomUUID(),
      tenantId,
      query,
      scope,
      filters,
      createdAt: new Date().toISOString(),
    };

    // Collect sources from multiple origins
    const sources = await this.collectSources(query, scope, filters);

    // Score trust for each source
    for (const source of sources) {
      source.trustScore = await this.computeTrustScore(source);
      source.verified = source.trustScore >= 0.7;
    }

    // Filter by trust score
    const filteredSources = filters?.minTrustScore
      ? sources.filter(s => s.trustScore >= filters.minTrustScore!)
      : sources;

    // Detect contradictions
    const contradictions = await this.detectContradictions(filteredSources);

    // Verify citations
    for (const source of filteredSources) {
      for (const citation of source.citations) {
        citation.verified = await this.verifyCitation(citation, source);
      }
    }

    const result: ResearchResult = {
      id: randomUUID(),
      queryId: queryRecord.id,
      tenantId,
      sources: filteredSources,
      contradictions,
      metadata: {
        searchDurationMs: Date.now() - start,
        sourcesScanned: sources.length,
        sourcesSelected: filteredSources.length,
        trustScoreDistribution: this.computeTrustDistribution(filteredSources),
      },
      createdAt: new Date().toISOString(),
    };

    await this.store.mutate(s => {
      s.queries.push(queryRecord);
      s.results.push(result);
    });

    return result;
  }

  // ─── Trust Scoring ───

  async computeTrustScore(source: ResearchSource): Promise<number> {
    const domain = this.extractDomain(source.url);

    // Check cache
    const cached = (await this.store.read()).trustCache[domain];
    if (cached && Date.now() - new Date(cached.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000) {
      return cached.score;
    }

    const factors: TrustScoreFactors = {
      httpsEnabled: source.url.startsWith("https://"),
      hasAuthor: !!source.author,
      hasCitations: source.citations.length > 0,
      sourceReputation: this.getSourceReputation(source.sourceType),
      peerReviewed: source.sourceType === "academic",
    };

    let score = 0;
    score += factors.httpsEnabled ? 0.1 : 0;
    score += factors.hasAuthor ? 0.15 : 0;
    score += factors.hasCitations ? 0.15 : 0;
    score += factors.sourceReputation * 0.4;
    score += factors.peerReviewed ? 0.2 : 0;

    score = Math.min(1, Math.max(0, score));

    // Cache the result
    await this.store.mutate(s => {
      s.trustCache[domain] = { score, factors, updatedAt: new Date().toISOString() };
    });

    return score;
  }

  // ─── Citation Verification ───

  async verifyCitation(citation: Citation, source: ResearchSource): Promise<boolean> {
    // Check if citation text exists in source
    const normalizedCitation = citation.text.toLowerCase().trim();
    const normalizedSnippet = source.snippet.toLowerCase();

    if (normalizedSnippet.includes(normalizedCitation)) return true;

    // In production, fetch full source and verify
    return false;
  }

  async verifySource(url: string): Promise<VerificationResult> {
    // In production, verify source against fact-checking APIs
    return {
      status: "unverified",
      confidence: 0.5,
      evidence: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // ─── Contradiction Detection ───

  async detectContradictions(sources: ResearchSource[]): Promise<Contradiction[]> {
    const contradictions: Contradiction[] = [];

    // Simple heuristic: compare snippets for opposing keywords
    const opposingPairs = [
      ["increase", "decrease"],
      ["positive", "negative"],
      ["beneficial", "harmful"],
      ["confirmed", "denied"],
      ["true", "false"],
    ];

    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const a = sources[i]!;
        const b = sources[j]!;

        for (const [word1, word2] of opposingPairs) {
          if (
            a.snippet.toLowerCase().includes(word1!) &&
            b.snippet.toLowerCase().includes(word2!)
          ) {
            contradictions.push({
              id: randomUUID(),
              sourceA: a.id,
              sourceB: b.id,
              claimA: a.snippet.slice(0, 200),
              claimB: b.snippet.slice(0, 200),
              severity: "minor",
            });
          }
        }
      }
    }

    return contradictions;
  }

  // ─── Report Generation ───

  async generateReport(resultId: string, title?: string): Promise<ResearchReport> {
    const s = await this.store.read();
    const result = s.results.find(r => r.id === resultId);
    if (!result) throw new Error(`Research result not found: ${resultId}`);

    const sections: ReportSection[] = [];

    // Summary section
    sections.push({
      title: "Summary",
      content: `Research found ${result.sources.length} sources with ${result.contradictions.length} contradictions.`,
      citations: [],
    });

    // Key findings
    const keyFindings = result.sources
      .filter(s => s.trustScore >= 0.7)
      .slice(0, 5)
      .map(s => s.snippet)
      .join("\n\n");

    sections.push({
      title: "Key Findings",
      content: keyFindings || "No high-trust sources found.",
      citations: result.sources.filter(s => s.trustScore >= 0.7).map(s => s.citations.map(c => c.id)).flat(),
    });

    // Contradictions
    if (result.contradictions.length > 0) {
      sections.push({
        title: "Contradictions",
        content: result.contradictions.map(c => `- ${c.claimA} vs ${c.claimB}`).join("\n"),
        citations: [],
      });
    }

    const report: ResearchReport = {
      id: randomUUID(),
      title: title ?? `Research: ${result.metadata.sourcesSelected} sources analyzed`,
      summary: `Analysis of ${result.metadata.sourcesSelected} sources with average trust score ${result.sources.reduce((s, src) => s + src.trustScore, 0) / result.sources.length || 0}`,
      sections,
      citations: result.sources.flatMap(s => s.citations),
      metadata: {
        totalSources: result.sources.length,
        avgTrustScore: result.sources.reduce((s, src) => s + src.trustScore, 0) / result.sources.length || 0,
        contradictionsFound: result.contradictions.length,
        contradictionsResolved: result.contradictions.filter(c => c.resolution).length,
        wordCount: sections.reduce((s, sec) => s + sec.content.split(/\s+/).length, 0),
      },
      generatedAt: new Date().toISOString(),
    };

    await this.store.mutate(s => { s.reports.push(report); });
    return report;
  }

  // ─── Query ───

  async getQueries(tenantId: string): Promise<ResearchQuery[]> {
    const s = await this.store.read();
    return s.queries.filter(q => q.tenantId === tenantId);
  }

  async getResults(tenantId: string): Promise<ResearchResult[]> {
    const s = await this.store.read();
    return s.results.filter(r => r.tenantId === tenantId);
  }

  async getReports(tenantId: string): Promise<ResearchReport[]> {
    const s = await this.store.read();
    return s.reports;
  }

  async getStats(tenantId: string) {
    const s = await this.store.read();
    const results = s.results.filter(r => r.tenantId === tenantId);
    const allSources = results.flatMap(r => r.sources);
    return {
      totalQueries: s.queries.filter(q => q.tenantId === tenantId).length,
      totalResults: results.length,
      totalReports: s.reports.length,
      totalSources: allSources.length,
      avgTrustScore: allSources.length > 0 ? allSources.reduce((s, src) => s + src.trustScore, 0) / allSources.length : 0,
      totalContradictions: results.reduce((s, r) => s + r.contradictions.length, 0),
    };
  }

  // ─── Private Helpers ───

  private async collectSources(query: string, scope: string, filters?: ResearchFilters): Promise<ResearchSource[]> {
    // In production, search multiple sources
    return [];
  }

  private extractDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  private getSourceReputation(sourceType: ResearchSource["sourceType"]): number {
    const reputation: Record<string, number> = {
      academic: 0.9,
      government: 0.85,
      documentation: 0.8,
      news: 0.6,
      blog: 0.4,
      internal: 0.7,
      unknown: 0.3,
    };
    return reputation[sourceType] ?? 0.3;
  }

  private computeTrustDistribution(sources: ResearchSource[]): Record<string, number> {
    const dist: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const s of sources) {
      if (s.trustScore >= 0.7) dist["high"]!++;
      else if (s.trustScore >= 0.4) dist["medium"]!++;
      else dist["low"]!++;
    }
    return dist;
  }
}
