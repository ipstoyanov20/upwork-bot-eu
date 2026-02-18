"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { getMissingFirebaseEnvVars, rtdb } from "@/lib/firebase";

type Opportunity = {
  title?: string;
  topicCode?: string;
  href?: string;
  openingDate?: string;
  deadlineDate?: string;
  [k: string]: unknown;
};

type EuDiscoveryRun = {
  createdAt?: string;
  data?: unknown;
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

type LinkRow = {
  proposalUrl: string;
  kind: "annex" | "download";
  title: string;
  url: string;
  type?: string;
  proposalRunId?: string;
  proposalRunCreatedAt?: string;
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

type LocalReport = {
  proposals: ProposalSummary[];
  budgets: { rows: BudgetRow[] };
  annexes: { rows: LinkRow[] };
  downloads: { rows: LinkRow[] };
};

function formatCreatedAt(createdAt?: string) {
  if (!createdAt) return "Unknown time";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return createdAt;
  return d.toLocaleString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function formatEUR(n: number | undefined) {
  if (!n) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseDateMaybe(v?: string): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function topicIdFromUrl(u?: string): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "topic-details");
    const next = idx >= 0 ? parts[idx + 1] : undefined;
    return next || null;
  } catch {
    return null;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return String(e);
}

function SafeExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50 text-black">
      {children}
    </a>
  );
}

type OpportunityExportInfo = {
  budgetRows: number;
  annexRows: number;
  downloadRows: number;
  totalBudgetEUR: number;
};

function OpportunityCard({
  opportunity,
  index,
  exportInfo,
  budgetRows,
  annexes,
  downloads,
}: {
  opportunity: Opportunity;
  index: number;
  exportInfo?: OpportunityExportInfo;
  budgetRows?: BudgetRow[];
  annexes?: LinkRow[];
  downloads?: LinkRow[];
}) {
  const title = asString(opportunity.title);
  const topicCode = asString(opportunity.topicCode);
  const href = asString(opportunity.href);
  const openingDate = asString(opportunity.openingDate);
  const deadlineDate = asString(opportunity.deadlineDate);
  const [rawOpen, setRawOpen] = useState(false);

  const openingTs = parseDateMaybe(openingDate);
  const deadlineTs = parseDateMaybe(deadlineDate);
  const now = Date.now();
  const isDeadlineSoon =
    deadlineTs !== null && deadlineTs >= now && deadlineTs - now <= 1000 * 60 * 60 * 24 * 30;
  const isDeadlinePast = deadlineTs !== null && deadlineTs < now;

  return (
    <article className="rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-mono text-black">#{index + 1}</div>
          <div className="mt-2 text-base font-semibold tracking-tight text-black">
            {title || "Untitled Opportunity"}
          </div>
          {topicCode ? <div className="mt-1 text-xs font-mono text-black">{topicCode}</div> : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="text-xs font-semibold tracking-tight text-black">Opening Date</div>
          <div className="mt-1 text-sm text-black">{openingDate || "N/A"}</div>
        </div>
        <div
          className={[
            "rounded-xl p-3",
            isDeadlinePast
              ? "border border-rose-200 bg-rose-50/70"
              : isDeadlineSoon
                ? "border border-rose-200 bg-rose-50/60"
                : "border border-rose-200 bg-rose-50/40",
          ].join(" ")}
        >
          <div className="text-xs font-semibold tracking-tight text-black">Deadline</div>
          <div className="mt-1 text-sm text-black">
            {deadlineDate || "N/A"}
            {deadlineTs !== null ? (
              <span className="ml-2 text-xs text-black/60">
                {isDeadlinePast ? "(passed)" : isDeadlineSoon ? "(soon)" : null}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {exportInfo ? (
        <div className="mt-4 grid grid-cols-2 gap-4 text-xs text-black">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="font-semibold tracking-tight">Budget from proposals</div>
            <div className="mt-1">
              Rows: <span className="font-mono">{exportInfo.budgetRows}</span>
            </div>
            <div className="mt-1">
              Total (EUR): <span className="font-mono">{formatEUR(exportInfo.totalBudgetEUR)}</span>
            </div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white/60 p-3">
            <div className="font-semibold tracking-tight">Annexes & downloads</div>
            <div className="mt-1">
              Annex rows: <span className="font-mono">{exportInfo.annexRows}</span>
            </div>
            <div className="mt-1">
              Download rows: <span className="font-mono">{exportInfo.downloadRows}</span>
            </div>
          </div>
        </div>
      ) : null}

      {budgetRows && budgetRows.length > 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-3 text-xs text-black">
          <div className="font-semibold tracking-tight">Budget rows</div>
          <div className="mt-2 overflow-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-black/10">
                  <th className="px-2 py-1 font-semibold">Year</th>
                  <th className="px-2 py-1 font-semibold">Topic</th>
                  <th className="px-2 py-1 font-semibold">Budget (EUR)</th>
                  <th className="px-2 py-1 font-semibold">Budget (raw)</th>
                </tr>
              </thead>
              <tbody>
                {budgetRows.map((b, idx) => (
                  <tr key={`${b.topicCode ?? "topic"}-${b.budgetYear}-${idx}`} className="border-b border-black/5 last:border-b-0">
                    <td className="px-2 py-1 align-top">{b.budgetYear}</td>
                    <td className="px-2 py-1 align-top">
                      <div className="font-mono">{b.topicCode ?? "—"}</div>
                      <div className="text-[11px] text-black/70">
                        {b.topicTitle ?? b.topic ?? ""}
                      </div>
                    </td>
                    <td
                      className={[
                        "px-2 py-1 align-top font-mono",
                        b.budgetAmountEUR === null ? "text-rose-700" : "text-emerald-700",
                      ].join(" ")}
                    >
                      {b.budgetAmountEUR !== null
                        ? formatEUR(b.budgetAmountEUR || 0)
                        : "N/A"}
                    </td>
                    <td className="px-2 py-1 align-top">{b.budgetAmountRaw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {annexes && annexes.length > 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-3 text-xs text-black">
          <div className="font-semibold tracking-tight">Annexes</div>
          <div className="mt-2 overflow-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-black/10">
                  <th className="px-2 py-1 font-semibold">Title</th>
                  <th className="px-2 py-1 font-semibold">Link</th>
                </tr>
              </thead>
              <tbody>
                {annexes.map((a, idx) => (
                  <tr key={`${a.url}-${idx}`} className="border-b border-black/5 last:border-b-0">
                    <td className="px-2 py-1 align-top">{a.title}</td>
                    <td className="px-2 py-1 align-top">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-all underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                      >
                        {a.url}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {downloads && downloads.length > 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-3 text-xs text-black">
          <div className="font-semibold tracking-tight">Downloads</div>
          <div className="mt-2 overflow-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-black/10">
                  <th className="px-2 py-1 font-semibold">Title</th>
                  <th className="px-2 py-1 font-semibold">Type</th>
                  <th className="px-2 py-1 font-semibold">Link</th>
                </tr>
              </thead>
              <tbody>
                {downloads.map((d, idx) => (
                  <tr key={`${d.url}-${d.title}-${idx}`} className="border-b border-black/5 last:border-b-0">
                    <td className="px-2 py-1 align-top">{d.title}</td>
                    <td className="px-2 py-1 align-top">{d.type || "—"}</td>
                    <td className="px-2 py-1 align-top">
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-all underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                      >
                        {d.url}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {href ? (
        <div className="mt-4">
          <SafeExternalLink href={href}>
            <span className="inline-flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm text-black hover:bg-black/10">
              View on EU Portal →
            </span>
          </SafeExternalLink>
        </div>
      ) : null}

      <details
        className="mt-4 rounded-xl border border-black/10 bg-white/60 p-3"
        onToggle={(e) => setRawOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-semibold tracking-tight text-black">
          Raw JSON
        </summary>
        {rawOpen ? (
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-black/90 p-3 text-xs text-white/90">
{JSON.stringify(opportunity, null, 2)}
          </pre>
        ) : (
          <div className="mt-2 text-xs text-black">
            Open to render JSON.
          </div>
        )}
      </details>
    </article>
  );
}

export default function RunDetailPage() {
  const routeParams = useParams<{ runId: string | string[] }>();
  const runId = Array.isArray(routeParams?.runId)
    ? routeParams.runId[0]
    : routeParams?.runId;

  const missing = useMemo(() => getMissingFirebaseEnvVars(), []);
  const [run, setRun] = useState<EuDiscoveryRun | null>(null);
  const firebaseReady = missing.length === 0 && !!rtdb;
  const [loading, setLoading] = useState(() => firebaseReady);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [localReport, setLocalReport] = useState<LocalReport | null>(null);
  const [localReportError, setLocalReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseReady || !rtdb || !runId) return;

    const runRef = ref(rtdb, `eu_discovery_results/${runId}`);
    const unsub = onValue(
      runRef,
      (snap) => {
        if (!snap.exists()) {
          setRun(null);
          setLoading(false);
          return;
        }
        const v = snap.val() as EuDiscoveryRun;
        setRun(v);
        setLoading(false);
      },
      (e) => {
        setError(errorMessage(e));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [firebaseReady, runId]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/local-report")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
        return json as LocalReport;
      })
      .then((data) => {
        if (cancelled) return;
        setLocalReport(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setLocalReportError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const annexesByTopicId = useMemo(() => {
    const map = new Map<string, LinkRow[]>();
    const rows = localReport?.annexes?.rows ?? [];
    for (const row of rows) {
      const topicId = topicIdFromUrl(row.proposalUrl);
      if (!topicId) continue;
      const arr = map.get(topicId) ?? [];
      arr.push(row);
      map.set(topicId, arr);
    }
    return map;
  }, [localReport]);

  const budgetsByTopicCode = useMemo(() => {
    const map = new Map<string, BudgetRow[]>();
    const rows = localReport?.budgets?.rows ?? [];
    for (const row of rows) {
      const topicKey = row.topicCode || topicIdFromUrl(row.proposalUrl);
      if (!topicKey) continue;
      const arr = map.get(topicKey) ?? [];
      arr.push(row);
      map.set(topicKey, arr);
    }
    return map;
  }, [localReport]);

  const downloadsByTopicId = useMemo(() => {
    const map = new Map<string, LinkRow[]>();
    const rows = localReport?.downloads?.rows ?? [];
    for (const row of rows) {
      const topicId = topicIdFromUrl(row.proposalUrl);
      if (!topicId) continue;
      const arr = map.get(topicId) ?? [];
      arr.push(row);
      map.set(topicId, arr);
    }
    return map;
  }, [localReport]);

  const opportunities: Opportunity[] = useMemo(() => {
    const data = run?.data;
    if (Array.isArray(data)) return data as Opportunity[];
    return [];
  }, [run]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return opportunities;
    return opportunities.filter((o) => {
      const title = asString(o?.title)?.toLowerCase() ?? "";
      const topicCode = asString(o?.topicCode)?.toLowerCase() ?? "";
      return title.includes(term) || topicCode.includes(term);
    });
  }, [opportunities, q]);

  return (
    <div className="min-h-screen bg-[radial-gradient(1100px_650px_at_20%_10%,rgba(33,97,140,0.18),transparent_60%),radial-gradient(800px_500px_at_80%_0%,rgba(219,98,74,0.18),transparent_55%),linear-gradient(180deg,#fbf7f0,rgba(251,247,240,0.7))]">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <header className="sticky top-0 z-10 -mx-5 border-b border-black/10 bg-[#fbf7f0]/80 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-black">Run</h1>
              </div>
              <div className="mt-1 text-sm text-black">
                {run?.createdAt ? (
                  <span>{formatCreatedAt(run.createdAt)}</span>
                ) : (
                  <span className="text-black">Unknown time</span>
                )}
              </div>
              <div className="mt-2 text-xs text-black">
                <Link href="/" className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50">
                  Back to runs
                </Link>
              </div>
            </div>

            <div className="w-full sm:w-96">
              <label className="block text-xs font-semibold tracking-tight text-black">
                Search opportunities
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by title or topic code..."
                className="mt-2 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm text-black outline-none ring-0 placeholder:text-black/40 focus:border-black/30"
              />
              <div className="mt-2 text-xs text-black">
                Showing {filtered.length} of {opportunities.length}
              </div>
            </div>
          </div>
        </header>

        <main className="mt-6">
          {missing.length ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">
                Setup required
              </h2>
              <p className="mt-2 text-sm text-black">
                Missing Firebase client env vars:
              </p>
              <ul className="mt-3 list-disc pl-5 text-sm font-mono text-black">
                {missing.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Error</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-black">
                {error}
              </p>
              <p className="mt-3 text-sm text-black">
                If this says permission denied, RTDB rules must allow read on{" "}
                <code className="font-mono">/eu_discovery_results</code>.
              </p>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-56 animate-pulse rounded-2xl border border-black/10 bg-white/50"
                />
              ))}
            </div>
          ) : run === null ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">
                Run not found
              </h2>
              <p className="mt-2 text-sm text-black">
                No data exists at{" "}
                <code className="font-mono">
                  /eu_discovery_results/{runId ?? ""}
                </code>
                .
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">
                No opportunities match
              </h2>
              <p className="mt-2 text-sm text-black">
                Try clearing the search box.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filtered.map((o, idx) => (
                (() => {
                  const topicKey =
                    asString(o?.topicCode) || topicIdFromUrl(asString(o?.href)) || "";
                  const budgetRows = topicKey ? budgetsByTopicCode.get(topicKey) ?? [] : [];
                  const annexes = topicKey ? annexesByTopicId.get(topicKey) ?? [] : [];
                  const downloads = topicKey ? downloadsByTopicId.get(topicKey) ?? [] : [];
                  const exportInfo: OpportunityExportInfo | undefined =
                    budgetRows.length || annexes.length || downloads.length
                      ? {
                          budgetRows: budgetRows.length,
                          annexRows: annexes.length,
                          downloadRows: downloads.length,
                          totalBudgetEUR: budgetRows.reduce(
                            (sum, r) => sum + (r.budgetAmountEUR ?? 0),
                            0
                          ),
                        }
                      : undefined;

                  return (
                    <OpportunityCard
                      key={`${topicKey || "opportunity"}-${idx}`}
                      opportunity={o}
                      index={idx}
                      exportInfo={exportInfo}
                      budgetRows={budgetRows}
                      annexes={annexes}
                      downloads={downloads}
                    />
                  );
                })()
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
