"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import {
  get,
  limitToLast,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  orderByChild,
  query,
  ref,
  remove,
} from "firebase/database";
import { getMissingFirebaseEnvVars, rtdb } from "@/lib/firebase";

type RunSummary = {
  id: string;
  createdAt?: string;
  dataCount?: number;
};

function formatCreatedAt(createdAt?: string) {
  if (!createdAt) return "Unknown time";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return createdAt;
  return d.toLocaleString();
}

function sortRunsDesc(runs: RunSummary[]) {
  return [...runs].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pickString(v: unknown, key: string): string | undefined {
  if (!isRecord(v)) return undefined;
  const val = v[key];
  return typeof val === "string" ? val : undefined;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return String(e);
}

function SetupMessage({ missing }: { missing: string[] }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
      <h2 className="text-lg font-semibold tracking-tight text-black">Setup required</h2>
      <p className="mt-2 text-sm text-black">
        Create <code className="font-mono">web/.env.local</code> and set the
        Firebase client env vars. Missing:
      </p>
      <ul className="mt-3 list-disc pl-5 text-sm font-mono text-black">
        {missing.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-black">
        Tip: copy{" "}
        <code className="font-mono">web/.env.local.example</code> to{" "}
        <code className="font-mono">web/.env.local</code>.
      </p>
    </div>
  );
}

export default function Home() {
  const missing = getMissingFirebaseEnvVars();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const firebaseReady = missing.length === 0 && !!rtdb;
  const [loading, setLoading] = useState(() => firebaseReady);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scraperKeyword, setScraperKeyword] = useState("hydrogen energy");
  const [scraperLogs, setScraperLogs] = useState<string>("");
  const [isScraperRunning, setIsScraperRunning] = useState(false);
  const [scraperStatus, setScraperStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");

  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [scraperLogs]);

  const handleRunScraper = async () => {
    if (!scraperKeyword.trim()) {
      alert("Please enter a search keyword.");
      return;
    }

    setIsScraperRunning(true);
    setScraperStatus("running");
    setScraperLogs(`Starting scraper for keyword: "${scraperKeyword}"...\n\n`);

    try {
      const response = await fetch("/api/run-scraper", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyword: scraperKeyword.trim() }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body stream received.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          setScraperLogs((prev) => prev + chunk);
        }
      }

      setScraperStatus("completed");
    } catch (e) {
      setScraperLogs((prev) => prev + `\n[ERROR] Scraper run failed: ${errorMessage(e)}\n`);
      setScraperStatus("failed");
    } finally {
      setIsScraperRunning(false);
    }
  };

  useEffect(() => {
    if (!firebaseReady || !rtdb) return;

    const runsQuery = query(
      ref(rtdb, "eu_discovery_results"),
      orderByChild("createdAt"),
      limitToLast(20)
    );

    const unsubAdded = onChildAdded(
      runsQuery,
      (snap) => {
        const v = snap.val() as unknown;
        const dataArr = isRecord(v) && Array.isArray(v.data) ? v.data : [];
        const next: RunSummary = {
          id: snap.key ?? "",
          createdAt: pickString(v, "createdAt"),
          dataCount: dataArr.length,
        };
        setRuns((prev) => {
          const map = new Map(prev.map((r) => [r.id, r]));
          map.set(next.id, next);
          return sortRunsDesc(Array.from(map.values()));
        });
      },
      (e) => setError(errorMessage(e))
    );

    const unsubChanged = onChildChanged(
      runsQuery,
      (snap) => {
        const v = snap.val() as unknown;
        const dataArr = isRecord(v) && Array.isArray(v.data) ? v.data : [];
        const next: RunSummary = {
          id: snap.key ?? "",
          createdAt: pickString(v, "createdAt"),
          dataCount: dataArr.length,
        };
        setRuns((prev) => {
          const map = new Map(prev.map((r) => [r.id, r]));
          map.set(next.id, next);
          return sortRunsDesc(Array.from(map.values()));
        });
      },
      (e) => setError(errorMessage(e))
    );

    const unsubRemoved = onChildRemoved(
      runsQuery,
      (snap) => {
        setRuns((prev) => prev.filter((r) => r.id !== snap.key));
      },
      (e) => setError(errorMessage(e))
    );

    // End the "loading" state once the initial read completes (even if empty).
    get(runsQuery)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
    };
  }, [firebaseReady]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!rtdb || !confirm("Are you sure you want to delete this run? All discovered data for this specific run will be removed from the database.")) return;
    
    try {
      await remove(ref(rtdb, `eu_discovery_results/${id}`));
    } catch (e) {
      alert(`Delete failed: ${errorMessage(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_700px_at_20%_10%,rgba(33,97,140,0.18),transparent_60%),radial-gradient(900px_600px_at_80%_0%,rgba(219,98,74,0.20),transparent_55%),linear-gradient(180deg,#fbf7f0,rgba(251,247,240,0.7))]">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-black">
              EU Discovery Results - Runs
            </h1>
            <p className="text-sm text-black">
              Realtime view of <code className="font-mono">/eu_discovery_results</code>{" "}
              in Firebase RTDB.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 hover:scale-105 active:scale-95 shadow-md"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Scraper
            </button>
            <Link 
              href="/applications" 
              className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white transition hover:scale-105 active:scale-95 shadow-md"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l2 2h3a2 2 0 012 2v10a2 2 0 01-2 2z" /></svg>
              AI Applications
            </Link>
          </div>
        </header>

        <main className="mt-8">
          {missing.length ? (
            <SetupMessage missing={missing} />
          ) : !rtdb ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Setup</h2>
              <p className="mt-2 text-sm text-black">
                Firebase is not initialized. Double-check your{" "}
                <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> env
                vars in <code className="font-mono">web/.env.local</code>.
              </p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">Error</h2>
              <p className="mt-2 text-sm text-black whitespace-pre-wrap">
                {error}
              </p>
              <p className="mt-3 text-sm text-black">
                If this says permission denied, RTDB rules must allow read on{" "}
                <code className="font-mono">/eu_discovery_results</code>.
              </p>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-2xl border border-black/10 bg-white/50"
                />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-white/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold tracking-tight text-black">
                No runs found
              </h2>
              <p className="mt-2 text-sm text-black">
                The database path <code className="font-mono">/eu_discovery_results</code>{" "}
                is empty (or you do not have read access).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {runs.map((r) => (
                <div key={r.id} className="group relative">
                  <Link
                    href={`/runs/${encodeURIComponent(r.id)}`}
                    className="block rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 pr-12">
                        <div className="mt-2 text-base font-semibold tracking-tight text-black" suppressHydrationWarning>
                          {formatCreatedAt(r.createdAt)}
                        </div>
                        <div className="mt-1 truncate text-sm text-black">
                          {r.dataCount ?? 0} opportunities
                        </div>
                      </div>
                      <div className="rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs text-black group-hover:bg-black/10">
                        Open
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={(e) => handleDelete(e, r.id)}
                    className="absolute bottom-5 right-5 z-20 rounded-full border border-rose-100 bg-rose-50 p-2 text-rose-600 transition hover:bg-rose-100 shadow-sm"
                    title="Delete Run"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>

      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-2xl transition-all">
            <div className="flex items-center justify-between border-b border-black/5 pb-4">
              <div>
                <h3 className="text-lg font-bold text-black flex items-center gap-2">
                  <span>Run Puppeteer Scraper</span>
                  {isScraperRunning && (
                    <span className="flex h-2.5 w-2.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                  )}
                </h3>
                <p className="text-xs text-neutral-500">
                  Visit the EU portal and extract funding opportunities in real time.
                </p>
              </div>
              <button
                onClick={() => {
                  if (isScraperRunning) {
                    if (!confirm("Scraper is still running. Are you sure you want to close this window? The bot will continue running in the background.")) return;
                  }
                  setIsModalOpen(false);
                }}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600">
                Search Keyword
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  value={scraperKeyword}
                  onChange={(e) => setScraperKeyword(e.target.value)}
                  disabled={isScraperRunning}
                  placeholder="e.g. hydrogen energy, artificial intelligence..."
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black placeholder-neutral-400 focus:border-black focus:outline-none disabled:bg-neutral-50"
                />
                <button
                  onClick={handleRunScraper}
                  disabled={isScraperRunning}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-50 shadow-md whitespace-nowrap"
                >
                  {isScraperRunning ? (
                    <>
                      <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Running...
                    </>
                  ) : (
                    "Start Scraper"
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between bg-neutral-900 px-4 py-2 rounded-t-lg border-b border-neutral-800">
                <span className="font-mono text-xs text-neutral-400">Terminal Logs</span>
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                  scraperStatus === "running" ? "bg-emerald-950 text-emerald-400" :
                  scraperStatus === "completed" ? "bg-blue-950 text-blue-400" :
                  scraperStatus === "failed" ? "bg-rose-950 text-rose-400" : "bg-neutral-800 text-neutral-400"
                }`}>
                  {scraperStatus}
                </span>
              </div>
              <div 
                ref={logContainerRef}
                className="h-64 overflow-y-auto bg-neutral-950 p-4 font-mono text-xs text-emerald-400 border border-neutral-800 rounded-b-lg whitespace-pre-wrap scrollbar-thin scrollbar-thumb-neutral-800"
              >
                {scraperLogs || "Console output will appear here after clicking 'Start Scraper'."}
              </div>
            </div>
            
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setScraperLogs("");
                  setScraperStatus("idle");
                }}
                disabled={isScraperRunning || !scraperLogs}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                Clear Logs
              </button>
              <button
                onClick={() => {
                  if (isScraperRunning) {
                    if (!confirm("Scraper is still running. Close window?")) return;
                  }
                  setIsModalOpen(false);
                }}
                className="rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 px-4 py-2 text-xs font-bold transition active:scale-95"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
