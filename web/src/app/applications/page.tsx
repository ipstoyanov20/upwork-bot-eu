"use client";

import { useEffect, useState } from "react";
import { onValue, ref, remove } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import Link from "next/link";

type ApplicationDraft = {
  id: string;
  callId: string;
  callMetadata?: {
    title: string;
    topicCode: string;
    programme: string;
  };
  projectTitle?: string;
  status: string;
  createdAt: string;
  analysis?: any;
};

export default function ApplicationsDashboard()
{
  const [applications, setApplications] = useState<ApplicationDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() =>
  {
    if (!rtdb) return;

    const appsRef = ref(rtdb, "application_drafts");
    const unsub = onValue(appsRef, (snap) =>
    {
      if (!snap.exists())
      {
        setApplications([]);
        setLoading(false);
        return;
      }
      const data = snap.val();
      const list = Object.values(data) as ApplicationDraft[];
      // Sort by newest
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setApplications(list);
      setLoading(false);
    }, (e) =>
    {
      setError(e.message);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const deleteApplication = async (id: string) => {
    if (!rtdb || !confirm("Are you sure you want to delete this application?")) return;
    try {
      await remove(ref(rtdb, `application_drafts/${id}`));
    } catch (e) {
      alert("Failed to delete: " + (e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-black pb-20">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-10 flex items-center justify-between">
          <div>
            <Link href="/" className="text-xs font-semibold text-black/40 hover:text-black uppercase tracking-wider">
              ← Main Dashboard
            </Link>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">AI Applications</h1>
            <p className="mt-2 text-black/60">Manage your grant proposals generated via Perplexity.</p>
          </div>
        </header>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl border border-black/10 bg-white/50" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
            {error}
          </div>
        ) : applications.length === 0 ? (
          <div className="rounded-2xl border border-black/10 bg-white/50 p-12 text-center">
            <h3 className="text-lg font-semibold">No applications yet</h3>
            <p className="mt-2 text-black/50">Start by clicking "Apply Now" on any funding opportunity.</p>
            <Link href="/" className="mt-6 inline-block rounded-xl bg-black px-6 py-2 text-sm font-bold text-white">
              Browse Calls
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {applications.map((app) => (
              <div key={app.id} className="group relative flex flex-col rounded-2xl border border-black/10 bg-white p-6 shadow-sm transition hover:shadow-md hover:-translate-y-1">
                <div className="flex items-center justify-between mb-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    app.status === 'ready' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' : 
                    app.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {app.status === 'ready' ? 'Ready for Client' : app.status}
                  </span>
                  <button 
                    onClick={() => deleteApplication(app.id)}
                    className="text-black/20 hover:text-rose-600 transition"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
                
                <h3 className="font-bold text-lg leading-tight mb-1 line-clamp-2">
                  {app.projectTitle || app.callMetadata?.title || 'Untitled Project'}
                </h3>
                {app.analysis?.part_a?.objectives && (
                  <p className="text-xs text-black/50 line-clamp-3 mb-4 leading-relaxed italic">
                    {typeof app.analysis.part_a.objectives === 'string' ? app.analysis.part_a.objectives : 'Complex objective data...'}
                  </p>
                )}
                
                <div className="mt-auto pt-4 flex flex-col gap-2 border-t border-black/5">
                  <div className="flex items-center justify-between text-xs text-black/50">
                    <span>{app.callMetadata?.programme}</span>
                    <span className="font-mono">{new Date(app.createdAt).toLocaleDateString()}</span>
                  </div>
                  <Link 
                    href={`/applications/${app.id}`}
                    className="mt-2 text-center rounded-xl bg-black text-white py-2 text-sm font-bold hover:bg-black/80 transition"
                  >
                    View Proposal
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
