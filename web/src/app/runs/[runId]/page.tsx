"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { getMissingFirebaseEnvVars, rtdb } from "@/lib/firebase";

type NewBudget = {
  identifier: string;
  totalBudget: number;
  budgetByYear: Record<string, string>;
  actionDescription: string;
};

type NewAnnex = {
  title: string;
  url: string;
  type?: string;
};

type Opportunity = {
  url?: string;
  Identifier?: string;
  Title?: string;
  Description?: string;
  OpeningDate?: string;
  DeadlineDate?: string;
  Budgets?: NewBudget[];
  filesAndAnnexes?: {
    usefulFiles?: NewAnnex[];
    annexes?: NewAnnex[];
    relatedDocuments?: NewAnnex[];
    documents?: NewAnnex[];
  };
  keyInformation?: Record<string, string>;
};

type EuProposalsRun = {
  createdAt?: string;
  data?: Record<string, Opportunity>;
  annex_batches?: string[][];
  annexes?: { title: string; url: string }[];
  filesAndAnnexes?: {
    annexes?: { title: string; url: string }[];
    documents?: { title: string; url: string }[];
  };
};

function formatCreatedAt(createdAt?: string) {
  if (!createdAt) return "Unknown time";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return createdAt;
  return d.toLocaleString();
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function formatEUR(n: number | string | undefined) {
  if (!n) return "0";
  const num = typeof n === "string" ? parseFloat(n) : n;
  return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function SafeExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50 text-black">
      {children}
    </a>
  );
}

function OpportunityCard({
  opportunity,
  index,
  runId,
}: {
  opportunity: Opportunity;
  index: number;
  runId?: string;
}) {
  const title = opportunity.Title;
  const identifier = opportunity.Identifier;
  const href = opportunity.url;
  
  // Extract potential dates from root or keyInformation
  const openingDate = opportunity.OpeningDate || opportunity.keyInformation?.['Opening_date'] || opportunity.keyInformation?.['Planned_opening_date'];
  const deadlineDate = opportunity.DeadlineDate || opportunity.keyInformation?.['Deadline_date'] || opportunity.keyInformation?.['Deadline_dates'];

  const [isDescOpen, setIsDescOpen] = useState(false);

  const budgets = opportunity.Budgets || [];
  
  const filesAndAnnexes = opportunity.filesAndAnnexes || {};
  const allFiles: { title: string; url: string; category: string; type?: string }[] = [];
  
  if (Array.isArray(filesAndAnnexes.annexes)) {
    filesAndAnnexes.annexes.forEach((a: any) => {
      allFiles.push({ title: a.title, url: a.url, category: "Annex", type: a.type });
    });
  }
  if (Array.isArray(filesAndAnnexes.usefulFiles)) {
    filesAndAnnexes.usefulFiles.forEach((a: any) => {
      allFiles.push({ title: a.title, url: a.url, category: "Useful File", type: a.type });
    });
  }
  if (Array.isArray(filesAndAnnexes.relatedDocuments)) {
    filesAndAnnexes.relatedDocuments.forEach((a: any) => {
      allFiles.push({ title: a.title, url: a.url, category: "Related Document", type: a.type });
    });
  }
  if (Array.isArray(filesAndAnnexes.documents)) {
    filesAndAnnexes.documents.forEach((a: any) => {
      allFiles.push({ title: a.title, url: a.url, category: "Document", type: a.type });
    });
  }

  const uniqueFilesMap = new Map<string, typeof allFiles[0]>();
  allFiles.forEach(f => {
    if (!f.url) return;
    let fullUrl = f.url.trim();
    if (fullUrl.startsWith('/')) {
      fullUrl = "https://ec.europa.eu" + fullUrl;
    }
    if (!uniqueFilesMap.has(fullUrl)) {
      uniqueFilesMap.set(fullUrl, { ...f, url: fullUrl });
    } else {
      const existing = uniqueFilesMap.get(fullUrl)!;
      if (f.category === "Annex" || f.category === "Useful File") {
        existing.category = f.category;
      }
      if (f.title && f.title.length > existing.title.length) {
        existing.title = f.title;
      }
    }
  });
  const filesList = Array.from(uniqueFilesMap.values());

  return (
    <article className="rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-mono text-black">#{index + 1}</div>
          <div className="mt-2 text-base font-semibold tracking-tight text-black">
            {title || "Untitled Opportunity"}
          </div>
          {identifier ? <div className="mt-1 text-xs font-mono text-black">{identifier}</div> : null}
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
          {identifier ? (
            <Link href={`/apply/${encodeURIComponent(identifier)}?runId=${runId || ""}`}>
              <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 hover:scale-105 active:scale-95 shadow-md cursor-pointer">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                Apply
              </span>
            </Link>
          ) : null}
          {href ? (
            <SafeExternalLink href={href}>
              <span className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white/50 px-4 py-2 text-xs font-medium text-black backdrop-blur transition hover:bg-white hover:shadow-sm">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Standard Portal
              </span>
            </SafeExternalLink>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="text-xs font-semibold tracking-tight text-black">Opening Date</div>
          <div className="mt-1 text-sm text-black">{openingDate || "N/A"}</div>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
          <div className="text-xs font-semibold tracking-tight text-black">Deadline Date</div>
          <div className="mt-1 text-sm text-black">{deadlineDate || "N/A"}</div>
        </div>
      </div>

      {/* Description Block */}
      {opportunity.Description && (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 text-xs text-black shadow-sm">
          <div className="font-semibold tracking-tight mb-2">Description</div>
          <div 
            className={`prose prose-sm max-w-none text-black/80 ${!isDescOpen ? 'line-clamp-3' : ''}`}
            dangerouslySetInnerHTML={{ __html: opportunity.Description }}
          />
          <button 
            onClick={() => setIsDescOpen(!isDescOpen)}
            className="mt-2 text-blue-600 font-medium hover:underline"
          >
            {isDescOpen ? "Show Less" : "Read More"}
          </button>
        </div>
      )}

      {/* Budgets Table */}
      {budgets.length > 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 text-xs text-black shadow-sm overflow-hidden">
          <div className="font-semibold tracking-tight flex items-center gap-2 border-b border-black/5 pb-2 mb-3">
            <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Financial Breakdown
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[11px] border-separate border-spacing-y-1">
              <thead>
                <tr className="text-black/50">
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-l-md w-1/4">Identifier</th>
                  <th className="px-2 py-1 font-medium bg-black/5 w-1/3">Action Description</th>
                  <th className="px-2 py-1 font-medium bg-black/5 text-right">Total Budget</th>
                  <th className="px-2 py-1 font-medium bg-black/5 text-right rounded-r-md">By Year</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b, idx) => (
                  <tr key={idx} className="group hover:bg-emerald-50/50 transition-colors">
                    <td className="px-2 py-2 align-top font-mono font-medium border-b border-black/5 group-last:border-0">{b.identifier}</td>
                    <td className="px-2 py-2 align-top border-b border-black/5 group-last:border-0 text-black/70">{b.actionDescription}</td>
                    <td className="px-2 py-2 align-top text-right font-bold text-emerald-700 border-b border-black/5 group-last:border-0">
                      €{formatEUR(b.totalBudget)}
                    </td>
                    <td className="px-2 py-2 align-top text-right border-b border-black/5 group-last:border-0">
                      <div className="flex flex-col gap-1 items-end">
                        {Object.entries(b.budgetByYear || {}).map(([year, amount]) => (
                          <span key={year} className="inline-flex items-center px-1.5 py-0.5 rounded bg-black/5 text-black/80 font-mono text-[9px]">
                            {year}: €{formatEUR(amount)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Annexes & Documents Table */}
      {filesList.length > 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 text-xs text-black shadow-sm overflow-hidden">
          <div className="font-semibold tracking-tight flex items-center gap-2 border-b border-black/5 pb-2 mb-3">
            <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Annexes & Documents ({filesList.length})
          </div>
          <div className="overflow-x-auto max-h-[300px]">
            <table className="min-w-full text-left text-[11px] border-separate border-spacing-y-1">
              <thead>
                <tr className="text-black/50">
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-l-md w-24">Category</th>
                  <th className="px-2 py-1 font-medium bg-black/5 w-1/2">Title</th>
                  <th className="px-2 py-1 font-medium bg-black/5 rounded-r-md">Link</th>
                </tr>
              </thead>
              <tbody>
                {filesList.map((item, idx) => {
                  const ext = item.type || item.url.split('.').pop()?.split(/[?#]/)[0]?.toUpperCase() || "FILE";
                  let badgeColor = "bg-gray-100 text-gray-700";
                  if (ext === "PDF") badgeColor = "bg-red-50 text-red-700 border-red-100";
                  else if (["ZIP", "RAR"].includes(ext)) badgeColor = "bg-amber-50 text-amber-700 border-amber-100";
                  else if (["XLS", "XLSX"].includes(ext)) badgeColor = "bg-green-50 text-green-700 border-green-100";
                  else if (["DOC", "DOCX"].includes(ext)) badgeColor = "bg-blue-50 text-blue-700 border-blue-100";
                  
                  let catColor = "bg-slate-100 text-slate-700";
                  if (item.category === "Annex") catColor = "bg-blue-100 text-blue-800 font-semibold";
                  else if (item.category === "Useful File") catColor = "bg-emerald-100 text-emerald-800";
                  else if (item.category === "Related Document") catColor = "bg-purple-100 text-purple-800";

                  return (
                    <tr key={idx} className="group hover:bg-blue-50/50 transition-colors">
                      <td className="px-2 py-2 align-middle">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] ${catColor}`}>
                          {item.category}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-middle font-medium text-black/80">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center px-1 py-0.5 rounded font-mono text-[8px] border ${badgeColor}`}>
                            {ext}
                          </span>
                          <span>{item.title}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 break-all text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          <span className="truncate max-w-[250px] underline decoration-blue-500/30 underline-offset-2">
                            {item.url}
                          </span>
                          <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function RunDetailPage() {
  const routeParams = useParams<{ runId: string | string[] }>();
  const runId = Array.isArray(routeParams?.runId)
    ? routeParams.runId[0]
    : routeParams?.runId;

  const missing = useMemo(() => getMissingFirebaseEnvVars(), []);
  const [run, setRun] = useState<EuProposalsRun | null>(null);
  const firebaseReady = missing.length === 0 && !!rtdb;
  const [loading, setLoading] = useState(() => firebaseReady);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [isRunAnnexesOpen, setIsRunAnnexesOpen] = useState(false);

  const runAnnexes = useMemo(() => {
    if (run?.annexes && Array.isArray(run.annexes)) {
      return run.annexes;
    }
    if (run?.filesAndAnnexes?.annexes && Array.isArray(run.filesAndAnnexes.annexes)) {
      return run.filesAndAnnexes.annexes;
    }
    if (run?.annex_batches && Array.isArray(run.annex_batches)) {
      const flat = run.annex_batches.flat();
      return flat.map(url => ({ title: url.split('/').pop() || url, url }));
    }
    return [];
  }, [run]);

  useEffect(() => {
    if (!firebaseReady || !rtdb || !runId) return;

    const runRef = ref(rtdb, `eu_proposals/${runId}`);
    const unsub = onValue(
      runRef,
      (snap) => {
        if (!snap.exists()) {
          setRun(null);
          setLoading(false);
          return;
        }
        const v = snap.val() as EuProposalsRun;
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

  const opportunities: Opportunity[] = useMemo(() => {
    const data = run?.data;
    if (!data) return [];
    const arr = Array.isArray(data) ? data : Object.values(data);
    return arr.filter(o => o && o.Title && o.Title.trim() !== "" && !o.Title.toLowerCase().includes("untitled"));
  }, [run]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return opportunities;
    return opportunities.filter((o) => {
      const title = o?.Title?.toLowerCase() ?? "";
      const identifier = o?.Identifier?.toLowerCase() ?? "";
      return title.includes(term) || identifier.includes(term);
    });
  }, [opportunities, q]);

  return (
    <div className="min-h-screen bg-[radial-gradient(1100px_650px_at_20%_10%,rgba(33,97,140,0.18),transparent_60%),radial-gradient(800px_500px_at_80%_0%,rgba(219,98,74,0.18),transparent_55%),linear-gradient(180deg,#fbf7f0,rgba(251,247,240,0.7))]">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <header className="sticky top-0 z-10 -mx-5 border-b border-black/10 bg-[#fbf7f0]/80 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-black">EU Proposal Extraction Run</h1>
              </div>
              <div className="mt-1 text-sm text-black">
                {run?.createdAt ? (
                  <span suppressHydrationWarning>{formatCreatedAt(run.createdAt)}</span>
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
                Search proposals
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by title or identifier..."
                className="mt-2 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm text-black outline-none ring-0 placeholder:text-black/40 focus:border-black/30"
              />
              <div className="mt-2 text-xs text-black">
                Showing {filtered.length} of {opportunities.length}
              </div>
            </div>
          </div>
        </header>

        <main className="mt-8 pb-20">
          {missing.length ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Setup required</h2>
            </div>
          ) : !rtdb ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Setup</h2>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Error</h2>
              <p className="mt-2 text-sm text-black whitespace-pre-wrap">{error}</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-2xl border border-black/10 bg-white/50" />
              ))}
            </div>
          ) : !run ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Run not found</h2>
              <p className="mt-2 text-sm text-black">This run ID does not exist or was deleted.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Run-level Annexes Explorer */}
              {runAnnexes.length > 0 && (
                <div className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
                  <button
                    onClick={() => setIsRunAnnexesOpen(!isRunAnnexesOpen)}
                    className="flex w-full items-center justify-between font-semibold text-black hover:opacity-80 transition"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20" />
                      </svg>
                      <span>Run-level Collected Annexes & Documents ({runAnnexes.length})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500 font-normal">
                        {isRunAnnexesOpen ? "Hide" : "Show"}
                      </span>
                      <svg
                        className={`h-4 w-4 transform transition-transform ${isRunAnnexesOpen ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isRunAnnexesOpen && (
                    <div className="mt-4 border-t border-black/5 pt-4">
                      <div className="overflow-x-auto max-h-[400px] scrollbar-thin">
                        <table className="min-w-full text-left text-xs border-separate border-spacing-y-1">
                          <thead>
                            <tr className="text-black/50">
                              <th className="px-2 py-1.5 font-medium bg-black/5 rounded-l-md w-1/3">Title</th>
                              <th className="px-2 py-1.5 font-medium bg-black/5 rounded-r-md">URL Link</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runAnnexes.map((item, idx) => {
                              const ext = item.url.split('.').pop()?.split(/[?#]/)[0]?.toUpperCase() || "FILE";
                              let badgeColor = "bg-gray-100 text-gray-700";
                              if (ext === "PDF") badgeColor = "bg-red-50 text-red-700 border-red-100";
                              else if (["ZIP", "RAR"].includes(ext)) badgeColor = "bg-amber-50 text-amber-700 border-amber-100";

                              return (
                                <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                                  <td className="px-2 py-2 align-middle font-medium text-black/80">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`inline-flex items-center px-1.5 py-0.2 rounded font-mono text-[8px] border ${badgeColor}`}>
                                        {ext}
                                      </span>
                                      <span className="truncate max-w-[300px]" title={item.title}>{item.title}</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 align-middle">
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="inline-flex items-center gap-1 break-all text-blue-600 hover:text-blue-800 transition"
                                    >
                                      <span className="truncate max-w-[400px] underline decoration-blue-500/20 underline-offset-2">
                                        {item.url}
                                      </span>
                                      <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                    </a>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {filtered.map((opp, i) => (
                <OpportunityCard
                  key={opp.Identifier || i}
                  opportunity={opp}
                  index={i}
                  runId={runId}
                />
              ))}
              
              {filtered.length === 0 && (
                <div className="rounded-2xl border border-black/10 bg-white/70 p-10 text-center backdrop-blur">
                  <p className="text-sm text-black/60">No proposals match your search.</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
