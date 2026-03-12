"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onValue, ref, set, update } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import Link from "next/link";
import { exportToDocx } from "@/lib/export";

type Tab = "consortium" | "partA" | "budget" | "partB";

function ensureArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

function SmartRender({ content }: { content: any }) {
  if (!content) return null;
  if (typeof content === "string") {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }
  if (Array.isArray(content)) {
    return (
      <ul className="list-disc pl-5 space-y-1">
        {content.map((item, i) => (
          <li key={i}><SmartRender content={item} /></li>
        ))}
      </ul>
    );
  }
  if (typeof content === "object") {
    return (
      <div className="space-y-3">
        {Object.entries(content).map(([key, value]) => (
          <div key={key}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-0.5">{key.replace(/_/g, ' ')}</div>
            <div className="text-sm leading-relaxed"><SmartRender content={value} /></div>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(content)}</span>;
}

import { Suspense } from "react";

function ApplicationReviewContent()
{
  const router = useRouter();
  const params = useParams<{ draftId: string }>();
  const draftId = params?.draftId;

  const [activeTab, setActiveTab] = useState<Tab>("consortium");
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() =>
  {
    if (!draftId || !rtdb) return;

    const draftRef = ref(rtdb, `application_drafts/${draftId}`);
    const unsub = onValue(draftRef, (snap) =>
    {
      if (!snap.exists())
      {
        setError("Draft not found");
        setLoading(false);
        return;
      }
      setDraft(snap.val());
      setLoading(false);
    }, (e) =>
    {
      setError(e.message);
      setLoading(false);
    });

    return () => unsub();
  }, [draftId]);

  const handleSave = async (updatedAnalysis: any) =>
  {
    if (!rtdb || !draftId) return;
    try
    {
      await set(ref(rtdb, `application_drafts/${draftId}/analysis`), updatedAnalysis);
      setIsEditing(false);
    } catch (e)
    {
      alert("Failed to save: " + (e as Error).message);
    }
  };

  const copyToClipboard = (text: string) =>
  {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  const toggleReadyForClient = async () => {
    if (!rtdb || !draftId) return;
    const newStatus = draft.status === "ready" ? "completed" : "ready";
    try {
      await update(ref(rtdb, `application_drafts/${draftId}`), {
        status: newStatus
      });
    } catch (e) {
      alert("Failed to update status: " + (e as Error).message);
    }
  };

  if (loading) return <div className="p-10 text-center">Loading application draft...</div>;
  if (error) return <div className="p-10 text-center text-rose-600">{error}</div>;

  const { analysis, status, callMetadata } = draft;

  if (status === "drafting")
  {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#fbf7f0] p-10">
        <div className="animate-spin h-12 w-12 border-4 border-emerald-500 border-t-transparent rounded-full mb-6"></div>
        <h1 className="text-2xl font-bold">Generating AI Analysis...</h1>
        <p className="mt-2 text-black/60 text-lg">Our AI is researching the call and drafting your proposal. This usually takes 10-30 seconds.</p>
        <p className="mt-6 text-sm text-black/40">Draft ID: {draftId}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-black pb-20">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/" className="text-xs font-semibold text-black/40 hover:text-black uppercase tracking-wider">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight truncate">
              {analysis?.part_a?.title || "Application Draft"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-black/60">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                {status}
              </span>
              <span>Topic: <code className="font-mono text-xs">{callMetadata?.topicCode}</code></span>
              <span>•</span>
              <a href={callMetadata?.href} target="_blank" rel="noopener" className="hover:underline">View Portal</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleReadyForClient}
              className={`rounded-xl px-4 py-2 font-semibold transition shadow-sm ${
                status === 'ready' ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "border border-black/10 bg-white hover:bg-black/5"
              }`}
            >
              {status === 'ready' ? "✓ Ready for Client" : "Mark Ready"}
            </button>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`rounded-xl px-4 py-2 font-semibold transition shadow-sm ${isEditing ? "bg-black text-white" : "border border-black/10 bg-white hover:bg-black/5"
                }`}
            >
              {isEditing ? "Cancel Edit" : "Edit Report"}
            </button>
            <button
              onClick={() => copyToClipboard(JSON.stringify(analysis, null, 2))}
              className="rounded-xl border border-black/10 bg-white px-4 py-2 font-semibold transition hover:bg-black/5 shadow-sm"
            >
              Copy JSON
            </button>
            <button 
              onClick={() => exportToDocx(analysis, callMetadata)}
              className="rounded-xl bg-emerald-600 px-6 py-2 font-bold text-white transition hover:bg-emerald-700 shadow-lg flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Export DOCX
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="mb-8 flex gap-2 border-b border-black/10 pb-px">
          {[
            { id: "consortium", label: "Consortium & Roles" },
            { id: "partA", label: "Part A (Summary)" },
            { id: "budget", label: "Budget" },
            { id: "partB", label: "Part B (Detailed)" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`relative px-4 py-3 text-sm font-semibold transition ${activeTab === tab.id ? "text-emerald-600" : "text-black/50 hover:text-black"
                }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></div>
              )}
            </button>
          ))}
        </nav>

        <main className="rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
          {activeTab === "consortium" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="text-xl font-bold mb-6">Consortium Composition & Roles</h2>
              <div className="space-y-6">
                {ensureArray(analysis?.consortium_roles).map((p: any, i: number) => (
                  <div key={i} className="rounded-xl border border-black/5 bg-black/[0.01] p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                      <h3 className="text-lg font-bold">{p.name}</h3>
                      <span className="rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
                        {p.role}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-black/30 mb-1">Responsibilities</label>
                        <p className="text-sm leading-relaxed">{p.responsibilities}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-black/30 mb-1">Effort (Indicative)</label>
                        <p className="text-sm font-mono font-bold text-black/70">{p.effort}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "partA" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
              <div>
                <h2 className="text-xl font-bold mb-4">Part A: Project Summary</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-black/30 mb-1">Project Title</label>
                    <p className="text-lg font-medium">{analysis?.part_a?.title}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-black/30 mb-1">Objectives</label>
                    <div className="text-sm leading-relaxed"><SmartRender content={analysis?.part_a?.objectives} /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-black/30 mb-1">Concept & Approach</label>
                    <div className="text-sm leading-relaxed"><SmartRender content={analysis?.part_a?.concept} /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-black/30 mb-1">Consortium Added Value</label>
                    <div className="text-sm leading-relaxed"><SmartRender content={analysis?.part_a?.value} /></div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === "budget" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="text-xl font-bold mb-6">Budget Allocation Proposal</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-black/10">
                    <tr>
                      <th className="px-4 py-3 font-bold text-sm">Partner</th>
                      <th className="px-4 py-3 font-bold text-sm">Share (%)</th>
                      <th className="px-4 py-3 font-bold text-sm">Est. Amount (€)</th>
                      <th className="px-4 py-3 font-bold text-sm">Cost Categories</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ensureArray(analysis?.budget).map((b: any, i: number) => (
                      <tr key={i} className="border-b border-black/5 last:border-b-0 hover:bg-black/[0.01]">
                        <td className="px-4 py-4 font-medium text-sm">{b.name}</td>
                        <td className="px-4 py-4 text-sm font-mono">{b.share}</td>
                        <td className="px-4 py-4 text-sm font-mono font-bold text-emerald-700">{b.amount}</td>
                        <td className="px-4 py-4 text-sm">
                          <div className="flex flex-wrap gap-1">
                            {ensureArray(b.categories).map((c: string, j: number) => (
                              <span key={j} className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-black/60 uppercase">
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "partB" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8 pb-10">
              <h2 className="text-xl font-bold mb-6">Part B: Detailed Project Description</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                <div className="md:col-span-2 space-y-1 bg-emerald-50/30 -mx-8 px-8 py-6 mb-4 border-y border-black/5">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 uppercase tracking-wider text-emerald-800">0. Project Description and Objectives</h3>
                  <p className="text-sm leading-relaxed text-black/80 whitespace-pre-wrap">{analysis?.part_b?.description || analysis?.part_b?.objectives}</p>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">1. Impact</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.impact} /></div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">2. Innovation</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.innovation} /></div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">3. Methodology</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.methodology} /></div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">4. Consortium Fit</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.consortium} /></div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">5. Budget Narrative</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.budget_narrative} /></div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">6. Risks & Mitigation</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.risks} /></div>
                </div>
                <div className="md:col-span-2 space-y-1">
                  <h3 className="text-sm font-bold border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">7. Dissemination, Communication & Exploitation</h3>
                  <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.dissemination} /></div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ApplicationReviewPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <ApplicationReviewContent />
    </Suspense>
  );
}
