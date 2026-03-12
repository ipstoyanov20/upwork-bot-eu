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
  kind: "annex" | "document";
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
  documents: { rows: LinkRow[] };
};

function formatCreatedAt(createdAt?: string)
{
  if (!createdAt) return "Unknown time";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return createdAt;
  return d.toLocaleString();
}

function isRecord(v: unknown): v is Record<string, unknown>
{
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string | undefined
{
  return typeof v === "string" ? v : undefined;
}

function formatEUR(n: number | undefined)
{
  if (!n) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseDateMaybe(v?: string): number | null
{
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function topicIdFromUrl(u?: string): string | null
{
  if (!u) return null;
  try
  {
    const url = new URL(u);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "topic-details");
    const next = idx >= 0 ? parts[idx + 1] : undefined;
    return next || null;
  } catch
  {
    return null;
  }
}

function errorMessage(e: unknown): string
{
  if (e instanceof Error) return e.message;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return String(e);
}

function SafeExternalLink({ href, children }: { href: string; children: React.ReactNode })
{
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
  documents,
  runId,
  isLocalLoading,
}: {
  opportunity: Opportunity;
  index: number;
  exportInfo?: OpportunityExportInfo;
  budgetRows?: BudgetRow[];
  annexes?: LinkRow[];
  documents?: LinkRow[];
  runId?: string;
  isLocalLoading?: boolean;
})
{
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

      {isLocalLoading ? (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="h-20 animate-pulse rounded-xl border border-black/5 bg-black/5" />
          <div className="h-20 animate-pulse rounded-xl border border-black/5 bg-black/5" />
        </div>
      ) : exportInfo ? (
        <div className="mt-4 grid grid-cols-2 gap-4 text-xs text-black">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 shadow-inner">
            <div className="font-semibold tracking-tight text-black flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              Budget Overview
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-black/60">Total Budget:</span>
              <span className="font-bold underline decoration-emerald-500/30 underline-offset-2 decoration-2">{formatEUR(exportInfo.totalBudgetEUR)} EUR</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-black/60">Annual Breakdowns:</span>
              <span className="font-mono">{exportInfo.budgetRows}</span>
            </div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-inner">
            <div className="font-semibold tracking-tight text-black flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
              Files & Resources
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-black/60">Total Links:</span>
              <span className="font-mono font-bold">{exportInfo.annexRows + exportInfo.downloadRows}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-black/60">Topic Annexes:</span>
              <span className="font-mono text-blue-700">{exportInfo.annexRows}</span>
            </div>
          </div>
        </div>
      ) : null}

      {isLocalLoading ? (
        <div className="mt-4 h-32 animate-pulse rounded-xl border border-black/5 bg-black/5" />
      ) : budgetRows && budgetRows.length > 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 text-xs text-black shadow-sm">
          <div className="font-semibold tracking-tight flex items-center gap-2 border-b border-black/5 pb-2 mb-3">
            <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Financial Breakdown & Grants
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-left text-[11px] border-separate border-spacing-y-1">
              <thead>
                <tr className="text-black/50">
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-l-md">Year</th>
                  <th className="px-2 py-1 font-medium bg-black/5">Topic / Sub-call</th>
                  <th className="px-2 py-1 font-medium bg-black/5 text-right">Budget (EUR)</th>
                  <th className="px-2 py-1 font-medium bg-black/5 text-right">Est. Grants</th>
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-r-md">Status</th>
                </tr>
              </thead>
              <tbody>
                {budgetRows.map((b, idx) => (
                  <tr key={`${b.topicCode ?? "topic"}-${b.budgetYear}-${idx}`} className="group hover:bg-emerald-50/50 transition-colors">
                    <td className="px-2 py-2 align-top border-b border-black/5 group-last:border-0">
                      <span className="font-bold text-black/80">{b.budgetYear}</span>
                    </td>
                    <td className="px-2 py-2 align-top border-b border-black/5 group-last:border-0">
                      <div className="font-bold text-emerald-900">{b.topicCode ?? "Main"}</div>
                      <div className="text-[10px] text-black/60 leading-relaxed max-w-[250px]">
                        {b.topicTitle ?? b.topic ?? ""}
                      </div>
                    </td>
                    <td
                      className={[
                        "px-2 py-2 align-top text-right border-b border-black/5 group-last:border-0 font-bold",
                        b.budgetAmountEUR === null ? "text-rose-500" : "text-emerald-700",
                      ].join(" ")}
                    >
                      {b.budgetAmountEUR !== null
                        ? `€${formatEUR(b.budgetAmountEUR || 0)}`
                        : "Pending"}
                    </td>
                    <td className="px-2 py-2 align-top text-right border-b border-black/5 group-last:border-0">
                      {b.indicativeGrants ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                          {b.indicativeGrants}
                        </span>
                      ) : (
                        <span className="text-black/30">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top border-b border-black/5 group-last:border-0 text-[10px] italic text-black/40">
                      {b.budgetAmountRaw === "0" ? "TBD" : b.budgetAmountRaw}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {isLocalLoading ? (
        <div className="mt-4 h-32 animate-pulse rounded-xl border border-black/5 bg-black/5" />
      ) : ((annexes && annexes.length > 0) || (documents && documents.length > 0)) ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 text-xs text-black shadow-sm overflow-hidden">
          <div className="font-semibold tracking-tight flex items-center gap-2 border-b border-black/5 pb-2 mb-3">
            <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Relevant Documents & Links
          </div>
          <div className="overflow-auto max-h-[400px]">
            <table className="min-w-full text-left text-[11px] border-separate border-spacing-y-1">
              <thead>
                <tr className="text-black/50">
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-l-md">Type</th>
                  <th className="px-2 py-1 font-medium bg-black/5">Title</th>
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-r-md">Link</th>
                </tr>
              </thead>
              <tbody>
                {[...(annexes || []), ...(documents || [])].map((item, idx) => (
                  <tr key={`${item.url}-${idx}`} className="group hover:bg-blue-50/50 transition-colors">
                    <td className="px-2 py-2 align-top">
                      <span className={[
                        "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider whitespace-nowrap",
                        item.kind === 'annex' ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                      ].join(" ")}>
                        {item.kind === 'annex' ? 'Annex' : (item.type || 'Doc')}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top font-medium max-w-[200px] truncate" title={item.title}>
                      {item.title}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1 break-all text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        <span className="truncate max-w-[300px] underline decoration-blue-500/30 underline-offset-2">
                          {item.url}
                        </span>
                        <svg className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}


      <div className="mt-6 flex flex-wrap items-center gap-3">
        {topicCode || topicIdFromUrl(href) ? (
          <Link
            href={`/apply/${encodeURIComponent(topicCode || topicIdFromUrl(href) || "")}?runId=${runId || ""}`}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white transition hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-black/10"
          >
            Apply Now
          </Link>
        ) : null}
        {href ? (
          <SafeExternalLink href={href}>
            <span className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white/50 px-4 py-2 text-sm font-medium text-black backdrop-blur transition hover:bg-white hover:shadow-sm">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              View on EU Portal
            </span>
          </SafeExternalLink>
        ) : null}
      </div>

    </article>
  );
}

export default function RunDetailPage()
{
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
  const [localReportLoading, setLocalReportLoading] = useState(true);
  const [localReportError, setLocalReportError] = useState<string | null>(null);

  useEffect(() =>
  {
    if (!firebaseReady || !rtdb || !runId) return;

    const runRef = ref(rtdb, `eu_discovery_results/${runId}`);
    const unsub = onValue(
      runRef,
      (snap) =>
      {
        if (!snap.exists())
        {
          setRun(null);
          setLoading(false);
          return;
        }
        const v = snap.val() as EuDiscoveryRun;
        setRun(v);
        setLoading(false);
      },
      (e) =>
      {
        setError(errorMessage(e));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [firebaseReady, runId]);

  useEffect(() =>
  {
    let cancelled = false;
    setLocalReportLoading(true);

    fetch("/api/local-report")
      .then(async (r) =>
      {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
        return json as LocalReport;
      })
      .then((data) =>
      {
        if (cancelled) return;
        setLocalReport(data);
        setLocalReportLoading(false);
      })
      .catch((e) =>
      {
        if (cancelled) return;
        setLocalReportError(e instanceof Error ? e.message : String(e));
        setLocalReportLoading(false);
      });

    return () =>
    {
      cancelled = true;
    };
  }, []);

  const annexesByTopicId = useMemo(() =>
  {
    const map = new Map<string, LinkRow[]>();
    const rows = localReport?.annexes?.rows ?? [];
    for (const row of rows)
    {
      const topicId = topicIdFromUrl(row.proposalUrl);
      if (!topicId) continue;
      const arr = map.get(topicId) ?? [];
      arr.push(row);
      map.set(topicId, arr);
    }
    return map;
  }, [localReport]);

  const budgetsByTopicCode = useMemo(() =>
  {
    const map = new Map<string, BudgetRow[]>();
    const rows = localReport?.budgets?.rows ?? [];
    for (const row of rows)
    {
      const topicKey = row.topicCode || topicIdFromUrl(row.proposalUrl);
      if (!topicKey) continue;
      const arr = map.get(topicKey) ?? [];
      arr.push(row);
      map.set(topicKey, arr);
    }
    return map;
  }, [localReport]);

  const documentsByTopicId = useMemo(() =>
  {
    const map = new Map<string, LinkRow[]>();
    const rows = localReport?.documents?.rows ?? [];
    for (const row of rows)
    {
      const topicId = topicIdFromUrl(row.proposalUrl);
      if (!topicId) continue;
      const arr = map.get(topicId) ?? [];
      arr.push(row);
      map.set(topicId, arr);
    }
    return map;
  }, [localReport]);

  const opportunities: Opportunity[] = useMemo(() =>
  {
    const data = run?.data;
    if (Array.isArray(data)) return data as Opportunity[];
    return [];
  }, [run]);

  const filtered = useMemo(() =>
  {
    const term = q.trim().toLowerCase();
    if (!term) return opportunities;
    return opportunities.filter((o) =>
    {
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
              <div className="mt-2 flex items-center gap-3 text-xs text-black">
                <Link href="/" className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50">
                  Back to runs
                </Link>
                <span>•</span>
                <Link href="/applications" className="font-bold underline decoration-emerald-500/30 underline-offset-2 hover:decoration-emerald-500/60">
                  AI Applications
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
                (() =>
                {
                  const topicKey =
                    asString(o?.topicCode) || topicIdFromUrl(asString(o?.href)) || "";
                  const rawBudgetRows = topicKey ? budgetsByTopicCode.get(topicKey) ?? [] : [];

                  // Deduplicate budget rows
                  const budgetRowsMap = new Map();
                  rawBudgetRows.forEach(b =>
                  {
                    const key = `${b.topicCode}-${b.budgetYear}-${b.budgetAmountRaw}`;
                    if (!budgetRowsMap.has(key))
                    {
                      budgetRowsMap.set(key, b);
                    }
                  });
                  const budgetRows = Array.from(budgetRowsMap.values());

                  const allAnnexes = topicKey ? annexesByTopicId.get(topicKey) ?? [] : [];
                  const allDocs = topicKey ? documentsByTopicId.get(topicKey) ?? [] : [];
                  const hasData = budgetRows.length > 0 || allAnnexes.length > 0 || allDocs.length > 0;

                  // Unified deduplication for all links
                  const allLinks = [...allAnnexes, ...allDocs];
                  const uniqueLinksMap = new Map();
                  allLinks.forEach(l =>
                  {
                    if (!uniqueLinksMap.has(l.url))
                    {
                      uniqueLinksMap.set(l.url, l);
                    }
                  });
                  const uniqueLinks = Array.from(uniqueLinksMap.values());
                  const annexes = uniqueLinks.filter(l => l.kind === 'annex');
                  const documents = uniqueLinks.filter(l => l.kind === 'document');

                  const totalBudget = budgetRows.reduce((sum, r) => sum + (r.budgetAmountEUR ?? 0), 0);

                  const exportInfo: OpportunityExportInfo | undefined = hasData
                    ? {
                      budgetRows: budgetRows.length,
                      annexRows: annexes.length,
                      downloadRows: documents.length,
                      totalBudgetEUR: totalBudget,
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
                      documents={documents}
                      runId={runId}
                      isLocalLoading={localReportLoading}
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
