"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TotalsByYearRow = { year: number; totalEUR: number; rows: number };

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

type RunSummary = {
  id: string;
  createdAt?: string;
  dataCount: number;
  sourceFile?: string;
};

type Report = {
  meta: { generatedAt: string; sourcePath: string; runId: string | null };
  discoveryRuns: RunSummary[];
  proposalRuns: RunSummary[];
  summary: {
    discoveryRuns: number;
    discoveryOpportunities: number;
    proposalRuns: number;
    proposals: number;
    proposalsWithTopics: number;
    budgetRows: number;
    proposalsWithAnnexes: number;
    proposalsWithDownloads: number;
    annexRows: number;
    downloadRows: number;
    uniqueAnnexUrls: number;
    uniqueDownloadUrls: number;
  };
  budgets: { totalsByYear: TotalsByYearRow[]; rows: BudgetRow[] };
  annexes: { rows: LinkRow[]; unique: UniqueLinkRow[] };
  downloads: { rows: LinkRow[]; unique: UniqueLinkRow[] };
};

function formatCreatedAt(createdAt?: string) {
  if (!createdAt) return "Unknown time";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return createdAt;
  return d.toLocaleString();
}

function formatEUR(n: number | null) {
  if (n === null) return "N/A";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(
  rows: Array<Record<string, unknown>>,
  columns: { key: string; label: string }[]
) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((r) =>
    columns.map((c) => csvEscape(r[c.key])).join(",")
  );
  return [header, ...lines].join("\n");
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded-2xl border border-black/10 bg-white/70 p-6 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-black">{title}</h2>
        {right ? <div className="flex flex-wrap gap-2">{right}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Table({
  columns,
  rows,
  rowKey,
}: {
  columns: { key: string; label: string; render?: (row: Record<string, unknown>) => React.ReactNode }[];
  rows: Array<Record<string, unknown>>;
  rowKey: (row: Record<string, unknown>, idx: number) => string;
}) {
  return (
    <div className="overflow-auto rounded-xl border border-black/10 bg-white/60">
      <table className="min-w-full text-left text-sm text-black">
        <thead className="sticky top-0 bg-[#fbf7f0]">
          <tr className="border-b border-black/10">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-xs font-semibold tracking-tight">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={rowKey(r, idx)} className="border-b border-black/10 last:border-b-0">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 align-top">
                  {c.render ? c.render(r) : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-sm text-black/60" colSpan={columns.length}>
                No rows.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function LocalExportReportPage() {
  const [runId, setRunId] = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [budgetQ, setBudgetQ] = useState("");
  const [annexQ, setAnnexQ] = useState("");
  const [downloadQ, setDownloadQ] = useState("");

  useEffect(() => {
    let cancelled = false;

    const qs = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    fetch(`/api/local-report${qs}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
        return json as Report;
      })
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const filteredBudgets = useMemo(() => {
    const rows = report?.budgets.rows ?? [];
    const q = budgetQ.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.topic,
        r.topicCode,
        r.topicTitle,
        r.deadline,
        r.openingDate,
        r.proposalUrl,
        r.proposalRunId,
        r.budgetAmountRaw,
        r.budgetCurrency,
        String(r.budgetYear),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report, budgetQ]);

  const filteredAnnexes = useMemo(() => {
    const rows = report?.annexes.rows ?? [];
    const q = annexQ.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.title, r.url, r.proposalUrl, r.proposalRunId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report, annexQ]);

  const filteredDownloads = useMemo(() => {
    const rows = report?.downloads.unique ?? [];
    const q = downloadQ.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.title, r.url, r.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report, downloadQ]);

  const filteredDownloadRowsAll = useMemo(() => {
    const rows = report?.downloads.rows ?? [];
    const q = downloadQ.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.title, r.url, r.type, r.proposalUrl, r.proposalRunId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report, downloadQ]);

  const bg =
    "min-h-screen bg-[radial-gradient(1200px_700px_at_20%_10%,rgba(33,97,140,0.18),transparent_60%),radial-gradient(900px_600px_at_80%_0%,rgba(219,98,74,0.20),transparent_55%),linear-gradient(180deg,#fbf7f0,rgba(251,247,240,0.7))]";

  return (
    <div className={bg}>
      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-black">
              Local Export Report
            </h1>
            <p className="mt-1 text-sm text-black">
              Builds summary, budget tables, annexes, and downloads from{" "}
              <code className="font-mono">upworkbot-790d5-default-rtdb-export (1).json</code>.
            </p>
            <div className="mt-2 text-xs text-black">
              <Link
                href="/"
                className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
              >
                Back to runs
              </Link>
            </div>
          </div>

          <div className="w-full sm:w-[28rem] rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm backdrop-blur">
            <div className="text-xs font-semibold tracking-tight text-black">Proposal run</div>
            <div className="mt-2 flex items-center gap-3">
              <select
                value={runId}
                onChange={(e) => {
                  setLoading(true);
                  setError(null);
                  setRunId(e.target.value);
                }}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm text-black outline-none focus:border-black/30"
              >
                <option value="">All runs</option>
                {(report?.proposalRuns ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatCreatedAt(r.createdAt)} — {r.dataCount} proposals — {r.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 text-xs text-black/70">
              Generated:{" "}
              <span className="font-mono">
                {report?.meta?.generatedAt ? formatCreatedAt(report.meta.generatedAt) : "—"}
              </span>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-black/10 bg-white/50"
              />
            ))}
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold tracking-tight text-black">Error</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-black">{error}</p>
            <p className="mt-3 text-sm text-black">
              If this says “Export file not found”, ensure the file exists at the project root.
            </p>
          </div>
        ) : !report ? (
          <div className="mt-8 rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
            No report.
          </div>
        ) : (
          <>
            <Section title="Summary">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { k: "Proposals", v: report.summary.proposals },
                  { k: "Budget rows", v: report.summary.budgetRows },
                  { k: "Annex rows", v: report.summary.annexRows },
                  { k: "Unique downloads", v: report.summary.uniqueDownloadUrls },
                ].map((x) => (
                  <div
                    key={x.k}
                    className="rounded-2xl border border-black/10 bg-white/60 p-4"
                  >
                    <div className="text-xs font-semibold tracking-tight text-black">
                      {x.k}
                    </div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-black">
                      {x.v.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 text-xs text-black/80">
                <div>
                  Export path: <code className="font-mono">{report.meta.sourcePath}</code>
                </div>
                <div className="mt-1">
                  Discovery runs:{" "}
                  <span className="font-mono">{report.summary.discoveryRuns}</span> (total opportunities{" "}
                  <span className="font-mono">{report.summary.discoveryOpportunities}</span>)
                </div>
                <div className="mt-1">
                  Proposal runs: <span className="font-mono">{report.summary.proposalRuns}</span>
                </div>
              </div>
            </Section>

            <Section
              title="Budget totals (EUR) by year"
              right={
                <button
                  onClick={() =>
                    downloadText(
                      `budget-totals${runId ? `-${runId}` : ""}.csv`,
                      toCsv(report.budgets.totalsByYear as unknown as Array<Record<string, unknown>>, [
                        { key: "year", label: "Year" },
                        { key: "totalEUR", label: "Total EUR" },
                        { key: "rows", label: "Rows" },
                      ])
                    )
                  }
                  className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                >
                  Download CSV
                </button>
              }
            >
              <Table
                columns={[
                  { key: "year", label: "Year" },
                  {
                    key: "totalEUR",
                    label: "Total (EUR)",
                    render: (r) => formatEUR((r.totalEUR as number) ?? 0),
                  },
                  { key: "rows", label: "Rows" },
                ]}
                rows={report.budgets.totalsByYear as unknown as Array<Record<string, unknown>>}
                rowKey={(r) => String(r.year ?? "")}
              />
            </Section>

            <Section
              title="Budget rows"
              right={
                <>
                  <input
                    value={budgetQ}
                    onChange={(e) => setBudgetQ(e.target.value)}
                    placeholder="Filter budgets..."
                    className="w-64 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-xs text-black outline-none focus:border-black/30"
                  />
                  <button
                    onClick={() =>
                      downloadText(
                        `budgets${runId ? `-${runId}` : ""}.json`,
                        JSON.stringify(filteredBudgets, null, 2),
                        "application/json"
                      )
                    }
                    className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                  >
                    Download JSON
                  </button>
                  <button
                    onClick={() =>
                      downloadText(
                        `budgets${runId ? `-${runId}` : ""}.csv`,
                        toCsv(filteredBudgets as unknown as Array<Record<string, unknown>>, [
                          { key: "proposalRunId", label: "Run ID" },
                          { key: "proposalRunCreatedAt", label: "Run Created At" },
                          { key: "proposalUrl", label: "Proposal URL" },
                          { key: "topicCode", label: "Topic Code" },
                          { key: "topicTitle", label: "Topic Title" },
                          { key: "budgetYear", label: "Budget Year" },
                          { key: "budgetCurrency", label: "Currency" },
                          { key: "budgetAmountEUR", label: "Budget Amount (parsed)" },
                          { key: "budgetAmountRaw", label: "Budget Amount (raw)" },
                          { key: "openingDate", label: "Opening Date" },
                          { key: "deadline", label: "Deadline" },
                          { key: "stages", label: "Stages" },
                          { key: "indicativeGrants", label: "Indicative grants" },
                        ])
                      )
                    }
                    className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                  >
                    Download CSV
                  </button>
                </>
              }
            >
              <div className="mb-3 text-xs text-black/70">
                Showing {filteredBudgets.length.toLocaleString()} of{" "}
                {report.budgets.rows.length.toLocaleString()} budget rows
              </div>
              <Table
                columns={[
                  {
                    key: "topicCode",
                    label: "Topic",
                    render: (r) => (
                      <div className="min-w-[18rem]">
                        <div className="font-mono text-xs">{(r.topicCode as string) || "—"}</div>
                        <div className="text-xs text-black/70">
                          {(r.topicTitle as string) || (r.topic as string) || ""}
                        </div>
                      </div>
                    ),
                  },
                  { key: "budgetYear", label: "Year" },
                  {
                    key: "budgetAmountEUR",
                    label: "Budget (EUR)",
                    render: (r) => (
                      <span className="font-mono">{formatEUR((r.budgetAmountEUR as number | null) ?? null)}</span>
                    ),
                  },
                  { key: "openingDate", label: "Opening" },
                  { key: "deadline", label: "Deadline" },
                  { key: "stages", label: "Stages" },
                  {
                    key: "proposalUrl",
                    label: "Proposal",
                    render: (r) =>
                      (r.proposalUrl as string) ? (
                        <a
                          className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                          href={r.proposalUrl as string}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Open →
                        </a>
                      ) : (
                        "—"
                      ),
                  },
                ]}
                rows={filteredBudgets as unknown as Array<Record<string, unknown>>}
                rowKey={(r, idx) => `${String(r.proposalUrl ?? "")}-${String(r.budgetYear ?? "")}-${idx}`}
              />
            </Section>

            <Section
              title="Annexes"
              right={
                <>
                  <input
                    value={annexQ}
                    onChange={(e) => setAnnexQ(e.target.value)}
                    placeholder="Filter annexes..."
                    className="w-64 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-xs text-black outline-none focus:border-black/30"
                  />
                  <button
                    onClick={() =>
                      downloadText(
                        `annexes${runId ? `-${runId}` : ""}.csv`,
                        toCsv(filteredAnnexes as unknown as Array<Record<string, unknown>>, [
                          { key: "proposalRunId", label: "Run ID" },
                          { key: "proposalRunCreatedAt", label: "Run Created At" },
                          { key: "proposalUrl", label: "Proposal URL" },
                          { key: "title", label: "Title" },
                          { key: "url", label: "URL" },
                        ])
                      )
                    }
                    className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                  >
                    Download CSV
                  </button>
                </>
              }
            >
              <div className="mb-3 text-xs text-black/70">
                Showing {filteredAnnexes.length.toLocaleString()} of{" "}
                {report.annexes.rows.length.toLocaleString()} annex rows
              </div>
              <Table
                columns={[
                  { key: "title", label: "Title" },
                  {
                    key: "url",
                    label: "Link",
                    render: (r) => (
                      <a
                        className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                        href={r.url as string}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {r.url as string}
                      </a>
                    ),
                  },
                  {
                    key: "proposalUrl",
                    label: "Proposal",
                    render: (r) =>
                      (r.proposalUrl as string) ? (
                        <a
                          className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                          href={r.proposalUrl as string}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Open →
                        </a>
                      ) : (
                        "—"
                      ),
                  },
                ]}
                rows={filteredAnnexes as unknown as Array<Record<string, unknown>>}
                rowKey={(r, idx) => `${String(r.url ?? "")}-${idx}`}
              />
            </Section>

            <Section
              title="Downloads (unique URLs)"
              right={
                <>
                  <input
                    value={downloadQ}
                    onChange={(e) => setDownloadQ(e.target.value)}
                    placeholder="Filter downloads..."
                    className="w-64 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-xs text-black outline-none focus:border-black/30"
                  />
                  <button
                    onClick={() =>
                      downloadText(
                        `downloads-unique${runId ? `-${runId}` : ""}.json`,
                        JSON.stringify(filteredDownloads, null, 2),
                        "application/json"
                      )
                    }
                    className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                  >
                    Download JSON
                  </button>
                  <button
                    onClick={() =>
                      downloadText(
                        `downloads-unique${runId ? `-${runId}` : ""}.csv`,
                        toCsv(filteredDownloads as unknown as Array<Record<string, unknown>>, [
                          { key: "title", label: "Title" },
                          { key: "type", label: "Type" },
                          { key: "url", label: "URL" },
                          { key: "occurrences", label: "Occurrences" },
                          { key: "proposalCount", label: "Proposal Count" },
                        ])
                      )
                    }
                    className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                  >
                    Download unique CSV
                  </button>
                  <button
                    onClick={() =>
                      downloadText(
                        `downloads-all-rows${runId ? `-${runId}` : ""}.csv`,
                        toCsv(filteredDownloadRowsAll as unknown as Array<Record<string, unknown>>, [
                          { key: "proposalRunId", label: "Run ID" },
                          { key: "proposalRunCreatedAt", label: "Run Created At" },
                          { key: "proposalUrl", label: "Proposal URL" },
                          { key: "title", label: "Title" },
                          { key: "type", label: "Type" },
                          { key: "url", label: "URL" },
                        ])
                      )
                    }
                    className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold text-black hover:bg-black/10"
                  >
                    Download all rows CSV
                  </button>
                </>
              }
            >
              <div className="mb-3 text-xs text-black/70">
                Showing {filteredDownloads.length.toLocaleString()} of{" "}
                {report.downloads.unique.length.toLocaleString()} unique download URLs
              </div>
              <Table
                columns={[
                  { key: "title", label: "Title" },
                  { key: "type", label: "Type" },
                  {
                    key: "url",
                    label: "Link",
                    render: (r) => (
                      <a
                        className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                        href={r.url as string}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {r.url as string}
                      </a>
                    ),
                  },
                  { key: "occurrences", label: "Occurrences" },
                  { key: "proposalCount", label: "Proposals" },
                ]}
                rows={filteredDownloads as unknown as Array<Record<string, unknown>>}
                rowKey={(r) => String(r.url ?? "")}
              />

              <details className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold tracking-tight text-black">
                  All download rows (including duplicates)
                </summary>
                <div className="mt-3 text-xs text-black/70">
                  Showing {filteredDownloadRowsAll.length.toLocaleString()} of{" "}
                  {report.downloads.rows.length.toLocaleString()} download rows
                </div>
                <div className="mt-3">
                  <Table
                    columns={[
                      { key: "title", label: "Title" },
                      { key: "type", label: "Type" },
                      {
                        key: "url",
                        label: "Link",
                        render: (r) => (
                          <a
                            className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                            href={r.url as string}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {r.url as string}
                          </a>
                        ),
                      },
                      {
                        key: "proposalUrl",
                        label: "Proposal",
                        render: (r) =>
                          (r.proposalUrl as string) ? (
                            <a
                              className="underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                              href={r.proposalUrl as string}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Open →
                            </a>
                          ) : (
                            "—"
                          ),
                      },
                    ]}
                    rows={filteredDownloadRowsAll as unknown as Array<Record<string, unknown>>}
                    rowKey={(r, idx) => `${String(r.url ?? "")}-${idx}`}
                  />
                </div>
              </details>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

