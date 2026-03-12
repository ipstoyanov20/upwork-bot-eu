"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
          <div className="flex flex-wrap items-center gap-4">
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
                        <div className="mt-2 text-base font-semibold tracking-tight text-black">
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
    </div>
  );
}
