"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { onValue, push, ref, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";

type Participant = {
  name: string;
  description: string;
};

type CallMetadata = {
  title: string;
  topicCode: string;
  programme: string;
  href: string;
  deadline?: string;
  typeOfAction?: string;
  budget?: string;
  annexes: { title: string; url: string }[];
};

import { Suspense } from "react";

function ApplyPageContent()
{
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ callId: string }>();
  const callId = decodeURIComponent(params?.callId ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callData, setCallData] = useState<CallMetadata | null>(null);

  const [projectTitle, setProjectTitle] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
  ]);
  const [userDocs, setUserDocs] = useState<{ name: string; type: string; size: number; data: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !isSubmitting) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, isSubmitting]);

  const markDirty = () => !isDirty && setIsDirty(true);

  useEffect(() =>
  {
    if (!callId) return;

    const runId = searchParams.get("runId");

    const fallbackFetch = () => {
      fetch(`/api/local-report`)
        .then(r => r.json())
        .then(data =>
        {
          const budgets = data.budgets?.rows ?? [];
          const annexes = data.annexes?.rows ?? [];

          const myBudgets = budgets.filter((b: any) => b.topicCode === callId || b.topic === callId);
          const myAnnexes = annexes.filter((a: any) =>
          {
            return a.topicCode === callId || a.proposalUrl.includes(callId);
          });

          if (myBudgets.length > 0)
          {
            const first = myBudgets[0];
            setCallData({
              title: first.topicTitle || first.topic || callId,
              topicCode: callId,
              programme: first.programme || "EU Funding & Tenders",
              href: first.proposalUrl || "",
              deadline: first.deadline,
              typeOfAction: first.stages,
              budget: first.budgetAmountRaw,
              annexes: myAnnexes.map((a: any) => ({ title: a.title, url: a.url }))
            });
          } else
          {
            setCallData({
              title: callId,
              topicCode: callId,
              programme: "Horizon Europe",
              href: `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${callId}`,
              annexes: []
            });
          }
          setLoading(false);
        })
        .catch(e =>
        {
          setError(e.message);
          setLoading(false);
        });
    };

    if (runId && rtdb) {
      // Fetch specifically from the discovery run
      const runRef = ref(rtdb, `eu_discovery_results/${runId}/data`);
      onValue(runRef, (snap) => {
        if (snap.exists()) {
          const list = snap.val() as any[];
          const found = list.find(o => o.topicCode === callId || (o.href && o.href.includes(callId)));
          if (found) {
            setCallData({
              title: found.title || callId,
              topicCode: found.topicCode || callId,
              programme: found.programme || "Horizon Europe",
              href: found.href || "",
              deadline: found.deadlineDate,
              typeOfAction: found.typeOfAction,
              budget: found.budget,
              annexes: [] // We'd need to find these from local-report still if needed
            });
            // Still try to get annexes from local-report
            fetch(`/api/local-report`).then(r => r.json()).then(lr => {
              const annexes = lr.annexes?.rows ?? [];
              const myAnnexes = annexes.filter((a: any) => a.topicCode === callId || a.proposalUrl.includes(found.href));
              setCallData(prev => prev ? ({...prev, annexes: myAnnexes.map((a: any) => ({ title: a.title, url: a.url }))}) : null);
            }).catch(() => {});
            
            setLoading(false);
          } else {
            fallbackFetch();
          }
        } else {
          fallbackFetch();
        }
      }, { onlyOnce: true });
    } else {
      fallbackFetch();
    }
  }, [callId, searchParams]);

  const addParticipant = () =>
  {
    setParticipants([...participants, { name: "", description: "" }]);
  };

  const updateParticipant = (index: number, field: keyof Participant, value: string) =>
  {
    const next = [...participants];
    next[index] = { ...next[index]!, [field]: value };
    setParticipants(next);
  };

  const removeParticipant = (index: number) =>
  {
    if (participants.length <= 3) return;
    setParticipants(participants.filter((_, i) => i !== index));
  };
  const processFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setUserDocs(prev => [...prev, {
          name: file.name,
          type: file.type,
          size: file.size,
          data: base64
        }]);
        markDirty();
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
  };

  const [isDragging, setIsDragging] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  };

  const removeDocument = (index: number) => {
    setUserDocs(prev => prev.filter((_, i) => i !== index));
  };

  const isValid = useMemo(() =>
  {
    const filled = participants.filter(p => p.name.trim() !== "");
    return filled.length >= 3;
  }, [participants]);

  const handleSubmit = async (e: React.FormEvent) =>
  {
    e.preventDefault();
    if (!isValid || !rtdb) return;

    setIsSubmitting(true);
    try
    {
      const draftRef = push(ref(rtdb, "application_drafts"));
      const draftId = draftRef.key;

      const draftData = {
        id: draftId,
        callId,
        callMetadata: callData,
        projectTitle,
        participants: participants.filter(p => p.name.trim() !== ""),
        userDocs,
        status: "drafting",
        createdAt: new Date().toISOString(),
      };

      await set(draftRef, draftData);

      // Trigger AI Analysis
      const analysisResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });

      if (!analysisResponse.ok)
      {
        const errorText = await analysisResponse.text();
        console.error("AI Analysis failed to trigger:", errorText);
        try
        {
          const errorJson = JSON.parse(errorText);
          setError(`AI Analysis Error: ${errorJson.error || errorJson.details || "Unknown error"}`);
        } catch
        {
          setError(`AI Analysis Error: ${analysisResponse.status} ${analysisResponse.statusText}`);
        }
        setIsSubmitting(false);
        return;
      }

      router.push(`/applications/${draftId}`);
    } catch (e)
    {
      setError(e instanceof Error ? e.message : String(e));
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="p-10 text-center">Loading call details...</div>;
  if (error) return <div className="p-10 text-center text-rose-600">Error: {error}</div>;

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-black">
      <div className="mx-auto max-w-4xl px-5 py-10">
        <header className="mb-10">
          <Link href={`/runs/${searchParams.get("runId") || ""}`} className="text-sm text-black/60 hover:text-black">
            ← Back to Call Detail
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Application Setup</h1>
          <p className="mt-2 text-black/60">Configure your consortium and project details to generate an EU application draft.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Call Metadata (Read-only) */}
          <section className="rounded-2xl border border-black/10 bg-white/50 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold mb-4">Call Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Topic ID</label>
                <div className="rounded-xl border border-black/5 bg-black/[0.03] px-4 py-2.5 font-mono text-sm shadow-inner">
                  {callData?.topicCode}
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Programme</label>
                <div className="rounded-xl border border-black/5 bg-black/[0.03] px-4 py-2.5 text-sm font-medium shadow-inner">
                  {callData?.programme}
                </div>
              </div>
              <div className="md:col-span-2 space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Call Title</label>
                <div className="rounded-xl border border-black/5 bg-black/[0.03] px-4 py-2.5 text-sm font-semibold leading-relaxed shadow-inner">
                  {callData?.title}
                </div>
              </div>
              {callData?.deadline && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Deadline</label>
                  <div className="rounded-xl border border-rose-100 bg-rose-50/30 px-4 py-2.5 text-sm font-bold text-rose-900 shadow-inner">
                    {callData.deadline}
                  </div>
                </div>
              )}
              {callData?.budget && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Indicative Budget</label>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-2.5 text-sm font-bold text-emerald-900 shadow-inner">
                    {callData.budget}
                  </div>
                </div>
              )}
              {callData?.href && (
                <div className="md:col-span-2 space-y-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Portal Reference</label>
                  <a 
                    href={callData.href} 
                    target="_blank" 
                    rel="noopener" 
                    className="flex items-center justify-between rounded-xl border border-black/5 bg-black/[0.03] px-4 py-2.5 text-xs text-emerald-700 hover:bg-emerald-50 transition shadow-inner group"
                  >
                    <span className="truncate font-mono mr-4">{callData.href}</span>
                    <svg className="h-4 w-4 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Programme Annexes */}
          <section className="rounded-2xl border border-black/10 bg-white/50 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold mb-4">Programme Documentation</h2>
            {callData?.annexes && callData.annexes.length > 0 ? (
              <ul className="space-y-2">
                {callData.annexes.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-emerald-600">✓</span>
                    <a href={a.url} target="_blank" rel="noopener" className="text-sm hover:underline decoration-black/20">
                      {a.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-black/50">No specific annexes identified for this call.</p>
            )}
          </section>

          {/* Project Title */}
          <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Project Title (Optional)</h2>
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => { setProjectTitle(e.target.value); markDirty(); }}
              placeholder="e.g. AI-driven Smart Energy Management System"
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/5 transition"
            />
            <p className="mt-2 text-xs text-black/40">If left empty, the AI will propose a title based on the consortium and call.</p>
          </section>

          {/* Consortium Participants */}
          <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Consortium Participants (Min 3)</h2>
              <button
                type="button"
                onClick={addParticipant}
                className="inline-flex items-center gap-1 rounded-full bg-black/5 px-3 py-1 text-xs font-semibold hover:bg-black/10 transition"
              >
                + Add Participant
              </button>
            </div>
            <div className="space-y-4">
              {participants.map((p, idx) => (
                <div key={idx} className="relative rounded-xl border border-black/5 bg-black/[0.02] p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-black/60 mb-1">Name</label>
                      <input
                        type="text"
                        required={idx < 3}
                        value={p.name}
                        onChange={(e) => { updateParticipant(idx, "name", e.target.value); markDirty(); }}
                        placeholder="Organization Name"
                        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/5 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-black/60 mb-1">Website or Description</label>
                      <input
                        type="text"
                        value={p.description}
                        onChange={(e) => { updateParticipant(idx, "description", e.target.value); markDirty(); }}
                        placeholder="https://example.com or Short blurb"
                        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/5 transition"
                      />
                    </div>
                  </div>
                  {participants.length > 3 && (
                    <button
                      type="button"
                      onClick={() => removeParticipant(idx)}
                      className="absolute -right-2 -top-2 rounded-full bg-rose-50 p-1 text-rose-600 hover:bg-rose-100 transition shadow-sm border border-rose-100"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isValid && (
              <p className="mt-3 text-xs text-rose-600">Please provide at least 3 consortium participants.</p>
            )}
          </section>

          {/* Documents Upload */}
          <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Supporting Documentation (Optional)</h2>
            <div className="space-y-4">
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition ${
                  isDragging 
                    ? "border-emerald-500 bg-emerald-50/50 scale-[1.01]" 
                    : "border-black/10 bg-black/[0.01]"
                }`}
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/5 text-black/20">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <p className="text-sm text-black/60 font-medium mb-1">Drag and drop files here</p>
                <p className="text-xs text-black/30 mb-4 text-center">or click below to browse (PDF, DOCX, TXT)</p>
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-upload"
                  accept=".pdf,.docx,.doc,.txt"
                />
                <label
                  htmlFor="file-upload"
                  className="rounded-xl bg-black px-6 py-2.5 text-xs font-bold text-white cursor-pointer hover:bg-black/80 transition shadow-sm active:scale-95"
                >
                  Choose Files
                </label>
              </div>

              {userDocs.length > 0 && (
                <div className="grid grid-cols-1 gap-2">
                  {userDocs.map((doc, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl border border-black/5 bg-black/[0.01] px-4 py-2">
                      <div className="flex items-center gap-3">
                        <svg className="h-5 w-5 text-black/30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          <p className="text-[10px] text-black/40 capitalize">{Math.round(doc.size / 1024)} KB • {doc.type.split('/')[1]}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDocument(i)}
                        className="text-black/30 hover:text-rose-600 transition"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="pt-6">
            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className={`w-full rounded-2xl py-4 text-lg font-bold text-white transition shadow-lg ${isValid && !isSubmitting
                  ? "bg-emerald-600 hover:bg-emerald-700 hover:-translate-y-0.5"
                  : "bg-black/20 cursor-not-allowed"
                }`}
            >
              {isSubmitting ? "Saving & Triggering AI Analysis..." : "Create Application Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ApplyPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <ApplyPageContent />
    </Suspense>
  );
}
