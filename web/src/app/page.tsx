"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  get,
  limitToLast,
  onChildAdded,
  onChildChanged,
  orderByChild,
  query,
  ref,
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

    // End the "loading" state once the initial read completes (even if empty).
    get(runsQuery)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));

    return () => {
      unsubAdded();
      unsubChanged();
    };
  }, [firebaseReady]);

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
          <div className="flex flex-wrap items-center gap-3 text-xs text-black">
            <span>Showing latest 20 runs</span>
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
                <Link
                  key={r.id}
                  href={`/runs/${encodeURIComponent(r.id)}`}
                  className="group rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
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
              ))}
            </div>
          )}
        </main>

      </div>
    </div>
  );
}
