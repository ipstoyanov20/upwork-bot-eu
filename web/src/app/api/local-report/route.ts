import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseIntSafe(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== "string") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseMoneyLike(raw: string): number | null {
  // Examples: "3 500 000", "1,234,567", "3500000"
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/[^\d.,\s-]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitTopic(topic?: string): { topicCode?: string; topicTitle?: string } {
  if (!topic) return {};
  const parts = topic.split(" - ");
  if (parts.length <= 1) return { topicTitle: topic };
  const [code, ...rest] = parts;
  const title = rest.join(" - ").trim();
  return { topicCode: code.trim() || undefined, topicTitle: title || undefined };
}

function budgetKeyToInfo(key: string): { currency?: string; year?: number } | null {
  // Example: "Budget (EUR) - Year : 2025"
  if (!/budget/i.test(key)) return null;
  const yearMatch = key.match(/year\s*:\s*(\d{4})/i);
  const year = yearMatch ? Number.parseInt(yearMatch[1]!, 10) : null;
  const currencyMatch = key.match(/\(\s*([A-Z]{3})\s*\)/);
  const currency = currencyMatch?.[1];
  if (!year || !Number.isFinite(year)) return null;
  return { year, currency };
}

type ReportRunSummary = {
  id: string;
  createdAt?: string;
  dataCount: number;
  sourceFile?: string;
};

type BudgetRow = {
  proposalUrl: string;
  topic?: string;
  topicCode?: string;
  topicTitle?: string;
  budgetCurrency?: string;
  budgetYear: number;
  budgetAmountEUR: number | null;
  budgetAmountRaw: string;
  openingDate?: string;
  deadline?: string;
  stages?: string;
  indicativeGrants?: number | null;
  proposalRunId?: string;
  proposalRunCreatedAt?: string;
};

type LinkRow = {
  proposalUrl: string;
  kind: "annex" | "download";
  title: string;
  url: string;
  type?: string;
  proposalRunId?: string;
  proposalRunCreatedAt?: string;
};

type UniqueLinkRow = {
  kind: "annex" | "download";
  title: string;
  url: string;
  type?: string;
  occurrences: number;
  proposalCount: number;
};

type ProposalSummary = {
  proposalUrl: string;
  proposalRunId?: string;
  proposalRunCreatedAt?: string;
  topicsCount: number;
  budgetRows: number;
  annexRows: number;
  downloadRows: number;
  totalBudgetEUR: number;
};

const EXPORT_FILENAME = "upworkbot-790d5-default-rtdb-export (1).json";
const EXPORT_PATH = path.resolve(process.cwd(), "..", EXPORT_FILENAME);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId") || "";

  try {
    const raw = await fs.readFile(EXPORT_PATH, "utf8");
    const data = JSON.parse(raw) as unknown;

    if (!isRecord(data)) {
      return Response.json(
        { error: "Unexpected export format (expected object at root)." },
        { status: 400 }
      );
    }

    const euDiscovery = isRecord(data.eu_discovery_results)
      ? (data.eu_discovery_results as UnknownRecord)
      : {};
    const euProposals = isRecord(data.eu_proposals)
      ? (data.eu_proposals as UnknownRecord)
      : {};

    const discoveryRuns: ReportRunSummary[] = Object.entries(euDiscovery).map(
      ([id, v]) => {
        const createdAt = isRecord(v) ? asString(v.createdAt) : undefined;
        const arr = isRecord(v) && Array.isArray(v.data) ? (v.data as unknown[]) : [];
        return { id, createdAt, dataCount: arr.length };
      }
    );

    const proposalRunsAll: ReportRunSummary[] = Object.entries(euProposals).map(
      ([id, v]) => {
        const createdAt = isRecord(v) ? asString(v.createdAt) : undefined;
        const sourceFile = isRecord(v) ? asString(v.sourceFile) : undefined;
        const arr = isRecord(v) && Array.isArray(v.data) ? (v.data as unknown[]) : [];
        return { id, createdAt, dataCount: arr.length, sourceFile };
      }
    );

    const proposalRuns = proposalRunsAll
      .slice()
      .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));

    const selectedRunIds = runId ? new Set([runId]) : null;

    const budgets: BudgetRow[] = [];
    const links: LinkRow[] = [];
    const proposalsByKey = new Map<string, ProposalSummary>();

    let proposalsTotal = 0;
    let proposalsWithTopics = 0;
    let proposalsWithAnnexes = 0;
    let proposalsWithDownloads = 0;

    for (const [proposalRunId, runVal] of Object.entries(euProposals)) {
      if (selectedRunIds && !selectedRunIds.has(proposalRunId)) continue;

      if (!isRecord(runVal) || !Array.isArray(runVal.data)) continue;
      const proposalRunCreatedAt = asString(runVal.createdAt);

      let proposalIndex = 0;

      for (const proposal of runVal.data as unknown[]) {
        if (!isRecord(proposal)) continue;
        proposalsTotal++;

        const proposalUrl = asString(proposal.url) ?? "";
        const topicsArr = Array.isArray(proposal.topics) ? (proposal.topics as unknown[]) : [];
        const filesAndAnnexes = isRecord(proposal.filesAndAnnexes)
          ? (proposal.filesAndAnnexes as UnknownRecord)
          : null;

        const proposalKey = `${proposalRunId}::${proposalUrl || `#${proposalIndex}`}`;
        proposalIndex += 1;

        let proposalSummary = proposalsByKey.get(proposalKey);
        if (!proposalSummary) {
          proposalSummary = {
            proposalUrl,
            proposalRunId,
            proposalRunCreatedAt,
            topicsCount: topicsArr.length,
            budgetRows: 0,
            annexRows: 0,
            downloadRows: 0,
            totalBudgetEUR: 0,
          };
          proposalsByKey.set(proposalKey, proposalSummary);
        } else {
          proposalSummary.topicsCount = topicsArr.length;
        }

        if (topicsArr.length) proposalsWithTopics++;

        // Budget rows from topics table (Budget (EUR) - Year : 2025)
        for (const row of topicsArr) {
          if (!isRecord(row)) continue;
          const topic = asString(row.Topic);
          const { topicCode, topicTitle } = splitTopic(topic);
          const openingDate = asString(row["Opening date"]);
          const deadline = asString(row.Deadline);
          const stages = asString(row.Stages);
          const indicative = row["Indicative number of grants"];
          const indicativeGrants = typeof indicative === "string" ? parseIntSafe(indicative) : parseIntSafe(indicative);

          for (const [k, v] of Object.entries(row)) {
            const info = budgetKeyToInfo(k);
            if (!info?.year) continue;
            const budgetAmountRaw = typeof v === "string" ? v : String(v ?? "");
            const budgetAmountEUR = budgetAmountRaw ? parseMoneyLike(budgetAmountRaw) : null;

            budgets.push({
              proposalUrl,
              topic,
              topicCode,
              topicTitle,
              budgetCurrency: info.currency,
              budgetYear: info.year,
              budgetAmountEUR,
              budgetAmountRaw,
              openingDate,
              deadline,
              stages,
              indicativeGrants,
              proposalRunId,
              proposalRunCreatedAt,
            });

            proposalSummary.budgetRows += 1;
            proposalSummary.totalBudgetEUR += budgetAmountEUR ?? 0;
          }
        }

        // Annexes & downloads
        const annexesArr = filesAndAnnexes && Array.isArray(filesAndAnnexes.annexes)
          ? (filesAndAnnexes.annexes as unknown[])
          : [];
        const downloadsArr = filesAndAnnexes && Array.isArray(filesAndAnnexes.allDownloads)
          ? (filesAndAnnexes.allDownloads as unknown[])
          : [];

        if (annexesArr.length) proposalsWithAnnexes++;
        if (downloadsArr.length) proposalsWithDownloads++;

        for (const a of annexesArr) {
          if (!isRecord(a)) continue;
          const title = asString(a.title)?.trim();
          const link = asString(a.url)?.trim();
          if (!title || !link) continue;
          links.push({
            proposalUrl,
            kind: "annex",
            title,
            url: link,
            proposalRunId,
            proposalRunCreatedAt,
          });
          proposalSummary.annexRows += 1;
        }

        for (const d of downloadsArr) {
          if (!isRecord(d)) continue;
          const title = (asString(d.title) ?? "").trim();
          const link = (asString(d.url) ?? "").trim();
          const type = (asString(d.type) ?? "").trim() || undefined;
          if (!link) continue;
          links.push({
            proposalUrl,
            kind: "download",
            title: title || "(untitled)",
            url: link,
            type,
            proposalRunId,
            proposalRunCreatedAt,
          });
          proposalSummary.downloadRows += 1;
        }
      }
    }

    const totalsByYear = Object.entries(
      budgets.reduce<Record<string, { total: number; count: number }>>((acc, r) => {
        const key = String(r.budgetYear);
        const amt = r.budgetAmountEUR ?? 0;
        acc[key] = acc[key] ?? { total: 0, count: 0 };
        acc[key]!.total += amt;
        acc[key]!.count += 1;
        return acc;
      }, {})
    )
      .map(([year, v]) => ({ year: Number(year), totalEUR: v.total, rows: v.count }))
      .sort((a, b) => a.year - b.year);

    const uniqueLinks = (kind: "annex" | "download"): UniqueLinkRow[] => {
      const map = new Map<string, { row: UniqueLinkRow; proposalUrls: Set<string> }>();
      for (const r of links) {
        if (r.kind !== kind) continue;
        const key = `${r.url}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            row: {
              kind,
              title: r.title,
              url: r.url,
              type: r.type,
              occurrences: 1,
              proposalCount: r.proposalUrl ? 1 : 0,
            },
            proposalUrls: new Set(r.proposalUrl ? [r.proposalUrl] : []),
          });
        } else {
          existing.row.occurrences += 1;
          if (r.proposalUrl && !existing.proposalUrls.has(r.proposalUrl)) {
            existing.proposalUrls.add(r.proposalUrl);
            existing.row.proposalCount += 1;
          }
        }
      }
      return Array.from(map.values())
        .map((v) => v.row)
        .sort((a, b) => b.occurrences - a.occurrences);
    };

    const annexesUnique = uniqueLinks("annex");
    const downloadsUnique = uniqueLinks("download");

    const proposals = Array.from(proposalsByKey.values()).sort((a, b) => {
      const at = a.proposalRunCreatedAt ? Date.parse(a.proposalRunCreatedAt) : 0;
      const bt = b.proposalRunCreatedAt ? Date.parse(b.proposalRunCreatedAt) : 0;
      return bt - at;
    });

    return Response.json({
      meta: {
        generatedAt: new Date().toISOString(),
        sourcePath: EXPORT_PATH,
        runId: runId || null,
      },
      discoveryRuns: discoveryRuns
        .slice()
        .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0)),
      proposalRuns,
      proposals,
      summary: {
        discoveryRuns: discoveryRuns.length,
        discoveryOpportunities: discoveryRuns.reduce((sum, r) => sum + r.dataCount, 0),
        proposalRuns: proposalRunsAll.length,
        proposals: proposalsTotal,
        proposalsWithTopics,
        budgetRows: budgets.length,
        proposalsWithAnnexes,
        proposalsWithDownloads,
        annexRows: links.filter((l) => l.kind === "annex").length,
        downloadRows: links.filter((l) => l.kind === "download").length,
        uniqueAnnexUrls: annexesUnique.length,
        uniqueDownloadUrls: downloadsUnique.length,
      },
      budgets: {
        totalsByYear,
        rows: budgets,
      },
      annexes: {
        rows: links.filter((l) => l.kind === "annex"),
        unique: annexesUnique,
      },
      downloads: {
        rows: links.filter((l) => l.kind === "download"),
        unique: downloadsUnique,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ENOENT")) {
      return Response.json(
        {
          error: "Export file not found.",
          expectedPath: EXPORT_PATH,
          expectedFilename: EXPORT_FILENAME,
        },
        { status: 404 }
      );
    }
    return Response.json(
      { error: "Failed to build report.", details: msg },
      { status: 500 }
    );
  }
}

