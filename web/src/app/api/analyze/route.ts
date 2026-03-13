import { NextRequest, NextResponse } from "next/server";
import { get, ref, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { getDocumentProxy, extractText } from "unpdf";
import officeParser from "officeparser";
import Tesseract from "tesseract.js";

export const runtime = "nodejs";

const PERPLEXITY_API_KEY = (process.env.PERPLEXITY_API_KEY || "").replace(/['"]/g, "").trim();

// Utility for retries
async function fetchWithRetry(url: string, options: any, retries = 3, timeout = 60000) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (response.ok) return response;
      if (response.status >= 500) {
        console.warn(`Retry ${i + 1}/${retries} due to server error ${response.status}`);
        continue;
      }
      return response; // Return non-retriable error (4xx)
    } catch (err: any) {
      clearTimeout(id);
      if (err.name === 'AbortError') {
        console.warn(`Retry ${i + 1}/${retries} due to timeout`);
      } else {
        console.warn(`Retry ${i + 1}/${retries} due to error: ${err.message}`);
      }
      if (i === retries - 1) throw err;
    }
  }
  throw new Error("Max retries reached");
}

// Text Chunking
function chunkText(text: string, chunkSize = 4000): string[] {
  const chunks: string[] = [];
  let currentPos = 0;
  while (currentPos < text.length) {
    let end = currentPos + chunkSize;
    if (end < text.length) {
      // Try to find a logical break (paragraph or newline)
      const nextNewline = text.lastIndexOf("\n", end);
      if (nextNewline > currentPos + chunkSize * 0.8) {
        end = nextNewline;
      }
    }
    chunks.push(text.substring(currentPos, end).trim());
    currentPos = end;
  }
  return chunks.filter(c => c.length > 50); // Ignore tiny chunks
}

// Deterministic Budget Logic
function generateRuleBasedBudget(totalBudgetStr: string | undefined, participants: any[]) {
  // Parse budget string: e.g. "€ 10.00 million" -> 10000000
  let total = 0;
  if (totalBudgetStr) {
    const cleaned = totalBudgetStr.replace(/[^0-9.]/g, "");
    total = parseFloat(cleaned) || 0;
    if (totalBudgetStr.toLowerCase().includes("million")) {
      total *= 1000000;
    }
  }

  if (total === 0) total = 3000000; // Default fallback for calculation if missing

  const count = participants.length;
  if (count === 0) return [];

  const coordShare = 0.35;
  const partnerShare = (1 - coordShare) / (count - 1 || 1);

  return participants.map((p, i) => {
    const share = i === 0 ? coordShare : partnerShare;
    const amount = total * share;
    return {
      name: p.name,
      share: (share * 100).toFixed(1) + "%",
      amountEUR: Math.round(amount),
      amountFormatted: "€" + (amount / 1000000).toFixed(2) + "M",
      categories: [
        { name: "Personnel Costs", share: "65%" },
        { name: "Subcontracting", share: "10%" },
        { name: "Travel and Subsistence", share: "5%" },
        { name: "Equipment & Other Goods", share: "15%" },
        { name: "Indirect Costs (25%)", share: "5%" }
      ]
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const { draftId } = await req.json();
    if (!draftId || !rtdb) return NextResponse.json({ error: "No draft ID provided" }, { status: 400 });

    const draftSnap = await get(ref(rtdb, `application_drafts/${draftId}`));
    if (!draftSnap.exists()) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    const draft = draftSnap.val();
    const { callMetadata, projectTitle, participants, userDocs } = draft;

    const extractionResults: any[] = [];
    let combinedContext = "";

    if (userDocs && Array.isArray(userDocs)) {
      for (const doc of userDocs) {
        try {
          const buffer = Buffer.from(doc.data.split(",")[1], "base64");
          let extractedText = "";
          let method = "standard";

          if (doc.type === "application/pdf") {
            const pdfProxy = await getDocumentProxy(new Uint8Array(buffer));
            const { text } = await extractText(pdfProxy);
            extractedText = text.join("\n");
            
            // Basic OCR Fallback if text is suspiciously short/empty
            if (extractedText.trim().length < 200) {
              console.log(`PDF text extraction yielded very little for ${doc.name}, attempting OCR...`);
              const { data: { text: ocrText } } = await Tesseract.recognize(buffer, "eng");
              if (ocrText.length > extractedText.length) {
                extractedText = ocrText;
                method = "ocr";
              }
            }
          } else if (doc.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const raw = await officeParser.parseOffice(buffer);
            extractedText = typeof raw === "string" ? raw : JSON.stringify(raw);
          } else if (doc.type === "text/plain") {
            extractedText = buffer.toString("utf-8");
          }

          if (extractedText) {
            const chunks = chunkText(extractedText);
            extractionResults.push({
              name: doc.name,
              method,
              charCount: extractedText.length,
              chunkCount: chunks.length,
            });
            // We only send a limited selection to the AI to prevent context overflow, 
            // but we process everything for the internal structured output.
            combinedContext += `\n--- DOCUMENT: ${doc.name} ---\n${extractedText.substring(0, 8000)}\n`;
          }
        } catch (err: any) {
          console.error(`Failed to extract from ${doc.name}:`, err);
          extractionResults.push({ name: doc.name, error: err.message });
        }
      }
    }

    if (!PERPLEXITY_API_KEY) {
      return NextResponse.json({ error: "PERPLEXITY_API_KEY is not configured. Live AI integration required." }, { status: 500 });
    }

    // Rule-Based Budget
    const ruleBudget = generateRuleBasedBudget(callMetadata?.budget, participants || []);

    const prompt = `You are an expert EU funding consultant. Analyze the following and generate a structured application proposal.
IMPORTANT: The budget calculations have been pre-determined by the system. Use the provided budget figures exactly as they are. Your role is to phrase the narrative around why this budget is appropriate for the proposed work.

CALL INFO:
Topic ID: ${callMetadata?.topicCode}
Title: ${callMetadata?.title}
Programme: ${callMetadata?.programme}
Deadline: ${callMetadata?.deadline}
Action Type: ${callMetadata?.typeOfAction}

CONSORTIUM:
${participants.map((p: any) => `- Name: ${p.name}, Info: ${p.description}`).join('\n')}

DETERMINISTIC BUDGET SHARE (USE THESE FIGURES):
${ruleBudget.map(b => `- ${b.name}: ${b.share} (${b.amountFormatted})`).join('\n')}

DOCUMENT CONTEXT (EXCERPTS):
${combinedContext}

FORMAT: Return ONLY a JSON object with strictly these keys: "consortium_roles", "part_a", "budget_narrative", "part_b".
- "consortium_roles": Array of objects { name, role, responsibilities, effort }.
- "part_a": Object { title, objectives, concept, value_added }.
- "budget_narrative": Detailed qualitative explanation of the budget per partner, referencing the shares provided.
- "part_b": Object with keys for "description", "impact", "innovation", "methodology", "consortium_description", "risks", "dissemination".

Do not return any other text or markdown.`;

    const response = await fetchWithRetry("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: "You are an expert EU Horizon Europe grant writer. Return ONLY a valid JSON object. Do not include any markdown formatting or backticks around the JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI Gateway Error (${response.status}): ${errorBody}`);
    }

    const aiData = await response.json();
    let aiContent;
    try {
      let raw = aiData.choices[0].message.content.trim();
      if (raw.startsWith("```json")) raw = raw.replace(/^```json/, "").replace(/```$/, "").trim();
      else if (raw.startsWith("```")) raw = raw.replace(/^```/, "").replace(/```$/, "").trim();
      aiContent = JSON.parse(raw);
    } catch (e) {
      console.error("AI JSON Parse Error:", e, aiData.choices[0].message.content);
      throw new Error(`AI returned malformed JSON: ${aiData.choices[0].message.content.substring(0, 100)}...`);
    }

    const cleanCitations = (obj: any): any => {
      if (typeof obj === 'string') return obj.replace(/\[\d+\]/g, "");
      if (Array.isArray(obj)) return obj.map(cleanCitations);
      if (obj && typeof obj === 'object') {
        const cleaned: any = {};
        for (const key in obj) {
          cleaned[key] = cleanCitations(obj[key]);
        }
        return cleaned;
      }
      return obj;
    };

    aiContent = cleanCitations(aiContent);

    // Merge everything into final report
    const finalAnalysis = {
      ...aiContent,
      budget: ruleBudget, // Use our deterministic budget
      metadata: {
        generatedAt: new Date().toISOString(),
        extraction: extractionResults,
        callId: callMetadata?.topicCode
      }
    };

    await set(ref(rtdb, `application_drafts/${draftId}/analysis`), finalAnalysis);
    await set(ref(rtdb, `application_drafts/${draftId}/status`), "completed");

    return NextResponse.json({ success: true, extraction: extractionResults });

  } catch (e: any) {
    console.error("Analysis Pipeline Exception:", e);
    return NextResponse.json({ 
      error: e.message,
      status: "failed"
    }, { status: 500 });
  }
}
