"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useRef } from "react";
import { onValue, ref, set, update, push } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import Link from "next/link";
import { exportToDocx } from "@/lib/export";
import { exportToPdf } from "@/lib/pdf-export";
import { Suspense } from "react";

type Tab = "consortium" | "partA" | "budget" | "partB";

function ensureArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

/**
 * Enhanced Copy Button with feedback
 */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-black/5 bg-black/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black/40 transition hover:bg-black/10 hover:text-black"
    >
      {copied ? (
        <>
          <svg className="h-3 w-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
          {label || "Copy Section"}
        </>
      )}
    </button>
  );
}

function SmartRender({ content }: { content: any }) {
  if (!content) return null;
  if (typeof content === "string") {
    const cleaned = content.replace(/\[\d+\]/g, "");
    return <span className="whitespace-pre-wrap">{cleaned}</span>;
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

function ApplicationReviewContent() {
  const router = useRouter();
  const params = useParams<{ draftId: string }>();
  const draftId = params?.draftId;

  const [activeTab, setActiveTab] = useState<Tab>("consortium");
  const [draft, setDraft] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editableAnalysis, setEditableAnalysis] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draftId || !rtdb) return;

    const draftRef = ref(rtdb, `application_drafts/${draftId}`);
    const unsub = onValue(draftRef, (snap) => {
      if (!snap.exists()) {
        setError("Draft not found");
        setLoading(false);
        return;
      }
      const data = snap.val();
      setDraft(data);
      setEditableAnalysis(data.analysis);
      
      // Load versions if any
      if (data.versions) {
        const vList = Object.entries(data.versions).map(([id, v]: [string, any]) => ({
          id,
          ...v
        })).sort((a: any, b: any) => b.timestamp - a.timestamp);
        setVersions(vList);
      }
      
      setLoading(false);
    }, (e) => {
      setError(e.message);
      setLoading(false);
    });

    return () => unsub();
  }, [draftId]);

  const handleSaveEdits = async () => {
    if (!rtdb || !draftId || !editableAnalysis) return;
    setIsSaving(true);
    try {
      await update(ref(rtdb, `application_drafts/${draftId}`), {
        analysis: editableAnalysis,
        activeVersionId: 'custom',
        activeVersionLabel: 'Manual Edits'
      });
      setIsEditing(false);
    } catch (e: any) {
      alert("Failed to save: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsVersion = async () => {
    if (!rtdb || !draftId || !editableAnalysis) return;
    const label = prompt("Enter a label for this version (e.g. 'Initial Draft', 'Final Review'):", `Version ${versions.length + 1}`);
    if (label === null) return;

    setIsSaving(true);
    try {
      const versionsRef = ref(rtdb, `application_drafts/${draftId}/versions`);
      await push(versionsRef, {
        label,
        analysis: editableAnalysis,
        timestamp: Date.now()
      });
      alert("Version saved successfully!");
    } catch (e: any) {
      alert("Failed to save version: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const rollbackToVersion = async (version: any) => {
    if (!rtdb || !draftId) return;
    if (!confirm(`Are you sure you want to rollback to ${version.label}? This will overwrite your current live draft.`)) return;
    setIsSaving(true);
    try {
      await update(ref(rtdb, `application_drafts/${draftId}`), {
        analysis: version.analysis,
        activeVersionId: version.id,
        activeVersionLabel: version.label
      });
      setActiveTab("consortium");
    } catch (e: any) {
      alert("Rollback failed: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleReadyForClient = async () => {
    if (!rtdb || !draftId) return;
    const newStatus = draft.status === "ready" ? "completed" : "ready";
    try {
      await update(ref(rtdb, `application_drafts/${draftId}`), {
        status: newStatus
      });
    } catch (e: any) {
      alert("Failed to update status: " + e.message);
    }
  };

  const handleExportPdf = () => {
    if (!reportRef.current) return;
    exportToPdf("report-content", `${analysis?.part_a?.title || "proposal"}-export`);
  };

  if (loading) return <div className="p-10 text-center">Loading application draft...</div>;
  if (error) return <div className="p-10 text-center text-rose-600">{error}</div>;

  const { status, callMetadata } = draft;
  const analysis = isEditing ? editableAnalysis : draft.analysis;

  if (status === "drafting") {
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
          <div className="min-w-0 flex-1">
            <Link href="/" className="text-xs font-semibold text-black/40 hover:text-black uppercase tracking-wider">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              {analysis?.part_a?.title || "Application Draft"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-black/60">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                status === 'ready' ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
              }`}>
                {status}
              </span>
              <span>Topic: <code className="font-mono text-xs">{callMetadata?.topicCode}</code></span>
              {draft.activeVersionLabel && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1 rounded bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black/40">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {draft.activeVersionLabel}
                  </span>
                </>
              )}
              {versions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span>•</span>
                  <button 
                    onClick={() => setShowVersions(true)}
                    className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
                  >
                    View History ({versions.length})
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex rounded-xl border border-black/10 bg-white p-1 shadow-sm overflow-hidden">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className={`px-3 py-1.5 text-xs font-bold transition rounded-lg ${
                    isEditing ? "bg-black text-white" : "hover:bg-black/5"
                  }`}
                >
                  {isEditing ? "Editing Mode" : "View Mode"}
                </button>
                {isEditing && (
                  <button
                    onClick={handleSaveEdits}
                    disabled={isSaving}
                    className="ml-1 px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveAsVersion}
                disabled={isSaving}
                className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-bold transition hover:bg-black/5 shadow-sm"
                title="Save current state as a new version"
              >
                Snapshot
              </button>
              <button 
                onClick={handleExportPdf}
                className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-bold transition hover:bg-black/5 shadow-sm flex items-center gap-1.5"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                PDF
              </button>
              <button 
                onClick={() => exportToDocx(analysis, callMetadata)}
                className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-bold transition hover:bg-black/5 shadow-sm flex items-center gap-1.5 text-blue-700"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                DOCX
              </button>
              <button 
                onClick={toggleReadyForClient}
                className={`rounded-xl px-5 py-2 text-xs font-bold transition shadow-lg ${
                  status === 'ready' ? "bg-emerald-600 text-white" : "bg-black text-white hover:bg-black/80"
                }`}
              >
                {status === 'ready' ? "Ready for Client" : "Finalize Draft"}
              </button>
            </div>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="mb-8 flex overflow-x-auto gap-2 border-b border-black/10 pb-px scrollbar-hide">
          {[
            { id: "consortium", label: "Consortium" },
            { id: "partA", label: "Summary" },
            { id: "budget", label: "Budget" },
            { id: "partB", label: "Detailed Proposal" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`relative whitespace-nowrap px-4 py-3 text-sm font-semibold transition ${activeTab === tab.id ? "text-emerald-600" : "text-black/50 hover:text-black"
                }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></div>
              )}
            </button>
          ))}
        </nav>

        <main id="report-content" ref={reportRef} className="rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
          {activeTab === "consortium" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Consortium Composition & Roles</h2>
                <CopyButton text={JSON.stringify(analysis?.consortium_roles, null, 2)} label="Copy Consortium" />
              </div>
              <div className="space-y-6">
                {ensureArray(analysis?.consortium_roles).map((p: any, i: number) => (
                  <div key={i} className="rounded-xl border border-black/5 bg-black/[0.01] p-6 relative group">
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                      {isEditing ? (
                        <input 
                          value={p.name}
                          onChange={(e) => {
                            const next = [...editableAnalysis.consortium_roles];
                            next[i] = { ...next[i], name: e.target.value };
                            setEditableAnalysis({ ...editableAnalysis, consortium_roles: next });
                          }}
                          className="text-lg font-bold bg-transparent border-b border-black/10 outline-none focus:border-emerald-500"
                        />
                      ) : (
                        <h3 className="text-lg font-bold">{p.name}</h3>
                      )}
                      
                      {isEditing ? (
                        <input 
                          value={p.role}
                          onChange={(e) => {
                            const next = [...editableAnalysis.consortium_roles];
                            next[i] = { ...next[i], role: e.target.value };
                            setEditableAnalysis({ ...editableAnalysis, consortium_roles: next });
                          }}
                          className="rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700 border-none outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      ) : (
                        <span className="rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
                          {p.role}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/30 mb-1">Responsibilities</label>
                        {isEditing ? (
                          <textarea 
                            value={p.responsibilities}
                            onChange={(e) => {
                              const next = [...editableAnalysis.consortium_roles];
                              next[i] = { ...next[i], responsibilities: e.target.value };
                              setEditableAnalysis({ ...editableAnalysis, consortium_roles: next });
                            }}
                            rows={3}
                            className="w-full text-sm leading-relaxed bg-transparent border rounded-lg border-black/5 p-2 outline-none focus:border-emerald-500"
                          />
                        ) : (
                          <p className="text-sm leading-relaxed">{p.responsibilities}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/30 mb-1">Effort (Indicative)</label>
                        {isEditing ? (
                          <input 
                            value={p.effort}
                            onChange={(e) => {
                              const next = [...editableAnalysis.consortium_roles];
                              next[i] = { ...next[i], effort: e.target.value };
                              setEditableAnalysis({ ...editableAnalysis, consortium_roles: next });
                            }}
                            className="text-sm font-mono font-bold text-black/70 bg-transparent border-b border-black/10 outline-none focus:border-emerald-500"
                          />
                        ) : (
                          <p className="text-sm font-mono font-bold text-black/70">{p.effort}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "partA" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Project Summary</h2>
                <CopyButton text={JSON.stringify(analysis?.part_a, null, 2)} label="Copy Summary" />
              </div>
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-black/30 mb-1">Project Title</label>
                  {isEditing ? (
                    <input 
                      value={analysis?.part_a?.title}
                      onChange={(e) => {
                        setEditableAnalysis({
                          ...editableAnalysis,
                          part_a: { ...editableAnalysis.part_a, title: e.target.value }
                        });
                      }}
                      className="w-full text-lg font-medium bg-transparent border-b border-black/10 outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <p className="text-lg font-medium">{analysis?.part_a?.title}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-black/30 mb-1">Objectives</label>
                  {isEditing ? (
                    <textarea 
                      value={typeof analysis?.part_a?.objectives === 'string' ? analysis.part_a.objectives : JSON.stringify(analysis.part_a.objectives, null, 2)}
                      onChange={(e) => {
                        setEditableAnalysis({
                          ...editableAnalysis,
                          part_a: { ...editableAnalysis.part_a, objectives: e.target.value }
                        });
                      }}
                      rows={5}
                      className="w-full text-sm leading-relaxed bg-transparent border rounded-lg border-black/5 p-3 outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <div className="text-sm leading-relaxed"><SmartRender content={analysis?.part_a?.objectives} /></div>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-black/30 mb-1">Concept & Approach</label>
                  {isEditing ? (
                    <textarea 
                      value={typeof analysis?.part_a?.concept === 'string' ? analysis.part_a.concept : JSON.stringify(analysis.part_a.concept, null, 2)}
                      onChange={(e) => {
                        setEditableAnalysis({
                          ...editableAnalysis,
                          part_a: { ...editableAnalysis.part_a, concept: e.target.value }
                        });
                      }}
                      rows={5}
                      className="w-full text-sm leading-relaxed bg-transparent border rounded-lg border-black/5 p-3 outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <div className="text-sm leading-relaxed"><SmartRender content={analysis?.part_a?.concept} /></div>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-black/30 mb-1">Consortium Added Value</label>
                  {isEditing ? (
                    <textarea 
                      value={typeof analysis?.part_a?.value === 'string' ? analysis.part_a.value : JSON.stringify(analysis.part_a.value, null, 2)}
                      onChange={(e) => {
                        setEditableAnalysis({
                          ...editableAnalysis,
                          part_a: { ...editableAnalysis.part_a, value: e.target.value }
                        });
                      }}
                      rows={5}
                      className="w-full text-sm leading-relaxed bg-transparent border rounded-lg border-black/5 p-3 outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <div className="text-sm leading-relaxed"><SmartRender content={analysis?.part_a?.value} /></div>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === "budget" && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Budget Allocation Proposal</h2>
                <CopyButton text={JSON.stringify(analysis?.budget, null, 2)} label="Copy Budget" />
              </div>
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
                        <td className="px-4 py-4 font-medium text-sm">
                          {isEditing ? (
                             <input value={b.name} onChange={(e) => {
                               const next = [...editableAnalysis.budget];
                               next[i] = { ...next[i], name: e.target.value };
                               setEditableAnalysis({ ...editableAnalysis, budget: next });
                             }} className="bg-transparent border-b border-black/10 outline-none w-full" />
                          ) : b.name}
                        </td>
                        <td className="px-4 py-4 text-sm font-mono">
                          {isEditing ? (
                             <input value={b.share} onChange={(e) => {
                               const next = [...editableAnalysis.budget];
                               next[i] = { ...next[i], share: e.target.value };
                               setEditableAnalysis({ ...editableAnalysis, budget: next });
                             }} className="bg-transparent border-b border-black/10 outline-none w-16" />
                          ) : b.share}
                        </td>
                        <td className="px-4 py-4 text-sm font-mono font-bold text-emerald-700">
                          {isEditing ? (
                             <input value={b.amountFormatted || b.amount} onChange={(e) => {
                               const next = [...editableAnalysis.budget];
                               const key = b.amountFormatted ? 'amountFormatted' : 'amount';
                               next[i] = { ...next[i], [key]: e.target.value };
                               setEditableAnalysis({ ...editableAnalysis, budget: next });
                             }} className="bg-transparent border-b border-black/10 outline-none w-32" />
                          ) : (b.amountFormatted || b.amount)}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          <div className="flex flex-col gap-1">
                            {ensureArray(b.categories).map((c: any, j: number) => (
                              <div key={j} className="flex items-center justify-between gap-4 text-[10px]">
                                <span className="font-semibold text-black/60 uppercase">{typeof c === 'string' ? c : c.name}</span>
                                <span className="font-mono text-black/40">{typeof c === 'string' ? '' : c.share}</span>
                              </div>
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
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Detailed Project Description</h2>
                <CopyButton text={JSON.stringify(analysis?.part_b, null, 2)} label="Copy Everything" />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                <div className="md:col-span-2 space-y-1 bg-emerald-50/30 -mx-8 px-8 py-6 mb-4 border-y border-black/5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-800">Project Description and Objectives</h3>
                    <CopyButton text={analysis?.part_b?.description || analysis?.part_b?.objectives || ""} />
                  </div>
                  {isEditing ? (
                    <textarea 
                      value={analysis?.part_b?.description || analysis?.part_b?.objectives || ""}
                      onChange={(e) => {
                        setEditableAnalysis({
                          ...editableAnalysis,
                          part_b: { ...editableAnalysis.part_b, description: e.target.value }
                        });
                      }}
                      rows={6}
                      className="w-full text-sm leading-relaxed bg-white/50 border border-emerald-200 rounded-lg p-3 outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-inner"
                    />
                  ) : (
                    <p className="text-sm leading-relaxed text-black/80 whitespace-pre-wrap">{analysis?.part_b?.description || analysis?.part_b?.objectives}</p>
                  )}
                </div>

                {[
                  { key: "impact", title: "Impact" },
                  { key: "innovation", title: "Innovation" },
                  { key: "methodology", title: "Methodology" },
                  { key: "consortium_description", title: "Consortium Fit" },
                  { key: "budget_narrative", title: "Budget Narrative" },
                  { key: "risks", title: "Risks & Mitigation" },
                  { key: "dissemination", title: "Dissemination & Exploitation" }
                ].filter(item => isEditing || (analysis?.part_b?.[item.key] && String(analysis.part_b[item.key]).trim().length > 0)).map((item) => (
                  <div key={item.key} className="space-y-1">
                    <div className="flex items-center justify-between border-b border-black/5 pb-1 mb-3 bg-black/[0.02] -mx-4 px-4 py-1">
                      <h3 className="text-sm font-bold">{item.title}</h3>
                      <CopyButton text={typeof analysis?.part_b?.[item.key] === 'string' ? analysis.part_b?.[item.key] : JSON.stringify(analysis.part_b?.[item.key], null, 2)} />
                    </div>
                    {isEditing ? (
                      <textarea 
                        value={typeof analysis?.part_b?.[item.key] === 'string' ? analysis.part_b?.[item.key] : JSON.stringify(analysis.part_b?.[item.key], null, 2)}
                        onChange={(e) => {
                          setEditableAnalysis({
                            ...editableAnalysis,
                            part_b: { ...editableAnalysis.part_b, [item.key]: e.target.value }
                          });
                        }}
                        rows={6}
                        className="w-full text-sm leading-relaxed bg-transparent border rounded-lg border-black/5 p-3 outline-none focus:border-emerald-500 shadow-inner"
                      />
                    ) : (
                      <div className="text-sm leading-relaxed text-black/80"><SmartRender content={analysis?.part_b?.[item.key]} /></div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* Print-Only View: Renders all content for PDF generation */}
        <div className="hidden print:block bg-white p-10" id="print-view">
          <h1 className="text-3xl font-bold mb-4">{analysis?.part_a?.title}</h1>
          <p className="text-sm text-black/60 mb-8 font-mono">Topic: {callMetadata?.topicCode} • Draft ID: {draftId}</p>
          
          <div className="space-y-12">
            <section>
              <h2 className="text-2xl font-bold border-b-2 border-emerald-600 pb-2 mb-6">Consortium & Roles</h2>
              <div className="space-y-6">
                {ensureArray(analysis?.consortium_roles).map((p: any, i: number) => (
                  <div key={i} className="border border-black/10 p-4 rounded-xl">
                    <h3 className="font-bold text-lg">{p.name} — {p.role}</h3>
                    <p className="text-sm mt-2"><span className="font-bold opacity-40 uppercase text-xs">Responsibilities:</span> {p.responsibilities}</p>
                    <p className="text-sm mt-1"><span className="font-bold opacity-40 uppercase text-xs">Effort:</span> {p.effort}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold border-b-2 border-emerald-600 pb-2 mb-6">Project Summary</h2>
              <div className="space-y-6">
                {analysis?.part_a?.objectives && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Objectives</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_a?.objectives} /></div>
                  </div>
                )}
                {analysis?.part_a?.concept && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Concept & Approach</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_a?.concept} /></div>
                  </div>
                )}
                {analysis?.part_a?.value && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Consortium Added Value</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_a?.value} /></div>
                  </div>
                )}
              </div>
            </section>

            <section className="page-break-before-always">
              <h2 className="text-2xl font-bold border-b-2 border-emerald-600 pb-2 mb-6">Budget Allocation</h2>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/20">
                    <th className="py-2 text-xs font-bold uppercase">Partner</th>
                    <th className="py-2 text-xs font-bold uppercase">Share</th>
                    <th className="py-2 text-xs font-bold uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ensureArray(analysis?.budget).map((b: any, i: number) => (
                    <tr key={i} className="border-b border-black/5">
                      <td className="py-3 text-sm font-medium">{b.name}</td>
                      <td className="py-3 text-sm">{b.share}</td>
                      <td className="py-3 text-sm font-bold text-emerald-700">{b.amountFormatted || b.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="text-2xl font-bold border-b-2 border-emerald-600 pb-2 mb-6">Detailed Proposal</h2>
              <div className="space-y-8">
                {analysis?.part_b?.impact && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Impact</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_b?.impact} /></div>
                  </div>
                )}
                {analysis?.part_b?.innovation && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Innovation</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_b?.innovation} /></div>
                  </div>
                )}
                {analysis?.part_b?.methodology && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Methodology</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_b?.methodology} /></div>
                  </div>
                )}
                {analysis?.part_b?.budget_narrative && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Budget Narrative</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_b?.budget_narrative} /></div>
                  </div>
                )}
                {analysis?.part_b?.risks && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Risks & Mitigation</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_b?.risks} /></div>
                  </div>
                )}
                {analysis?.part_b?.dissemination && (
                  <div>
                    <h3 className="font-bold text-xs uppercase opacity-40">Dissemination, Communication & Exploitation</h3>
                    <div className="text-sm mt-1"><SmartRender content={analysis?.part_b?.dissemination} /></div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Version History Side Panel */}
        {showVersions && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowVersions(false)} />
            <div className="relative w-full max-w-sm bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
              <div className="p-6 border-b border-black/10 flex items-center justify-between">
                <h2 className="text-lg font-bold">Version History</h2>
                <button onClick={() => setShowVersions(false)} className="text-black/40 hover:text-black">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div 
                  className="p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-700 uppercase">Live Version</span>
                    <span className="text-[10px] text-emerald-600 font-mono">Current</span>
                  </div>
                  <h3 className="font-bold">Active Draft</h3>
                  <p className="text-xs text-black/60 italic">This is what you are currently viewing and editing.</p>
                </div>

                {versions.map((v) => {
                  const isActive = draft?.activeVersionId === v.id;
                  return (
                    <div 
                      key={v.id} 
                      className={`p-4 rounded-xl border transition group ${
                        isActive ? "border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500" : "border-black/10 bg-white hover:border-black/20"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-black/30 uppercase">{new Date(v.timestamp).toLocaleString()}</span>
                        {isActive && <span className="text-[10px] font-bold text-emerald-600 uppercase bg-emerald-100 px-1.5 py-0.5 rounded">Active</span>}
                      </div>
                      <h3 className="font-bold mb-3">{v.label}</h3>
                      {!isActive && (
                        <button 
                          onClick={() => {
                            rollbackToVersion(v);
                            setShowVersions(false);
                          }}
                          className="w-full py-2 text-xs font-bold bg-black text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Restore this Version
                        </button>
                      )}
                    </div>
                  );
                })}

                {versions.length === 0 && (
                  <div className="text-center py-20">
                    <div className="text-black/20 mb-2">No versions saved yet</div>
                    <p className="text-xs text-black/40">Use the "Snapshot" button to save your current work.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
