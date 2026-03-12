import { NextRequest, NextResponse } from "next/server";
import { get, ref, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import mammoth from "mammoth";
const pdf = require("pdf-parse");

export const runtime = "nodejs";

const PERPLEXITY_API_KEY = (process.env.PERPLEXITY_API_KEY || "").replace(/['"]/g, "").trim();

export async function POST(req: NextRequest) {
  try {
    const { draftId } = await req.json();
    if (!draftId || !rtdb) return NextResponse.json({ error: "No draft ID provided" }, { status: 400 });

    const draftSnap = await get(ref(rtdb, `application_drafts/${draftId}`));
    if (!draftSnap.exists()) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    const draft = draftSnap.val();
    const { callMetadata, projectTitle, participants, userDocs } = draft;

    // Extract text from documents if available
    let documentContext = "";
    if (userDocs && Array.isArray(userDocs)) {
      for (const doc of userDocs) {
        try {
          const buffer = Buffer.from(doc.data.split(",")[1], "base64");
          let text = "";
          if (doc.type === "application/pdf") {
            const data = await pdf(buffer);
            text = data.text;
          } else if (doc.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const data = await mammoth.extractRawText({ buffer });
            text = data.value;
          } else if (doc.type === "text/plain") {
            text = buffer.toString("utf-8");
          }
          if (text) {
            documentContext += `\n--- DOCUMENT: ${doc.name} ---\n${text.substring(0, 3000)}\n`;
          }
        } catch (err) {
          console.error(`Failed to extract text from ${doc.name}:`, err);
        }
      }
    }

    if (!PERPLEXITY_API_KEY) {
      console.log("No Perplexity API Key found, using mock mode.");
      const mockResult = generateMockAnalysis(draft);
      await set(ref(rtdb, `application_drafts/${draftId}/analysis`), mockResult);
      await set(ref(rtdb, `application_drafts/${draftId}/status`), "completed");
      return NextResponse.json({ success: true, mocked: true });
    }

    const prompt = `You are an expert EU funding consultant. I have an Application Draft for a funding call. 
Please analyze the call and the consortium to generate a structured application proposal.

CALL INFO:
Topic ID: ${callMetadata?.topicCode}
Title: ${callMetadata?.title}
Programme: ${callMetadata?.programme}
Deadline: ${callMetadata?.deadline}
Action Type: ${callMetadata?.typeOfAction}
Total Call Budget: ${callMetadata?.budget}

CONSORTIUM:
${participants.map((p: any) => `- Name: ${p.name}, Info: ${p.description}`).join('\n')}

PROJECT TITLE PROPOSAL: ${projectTitle || "Generate one based on the call and consortium"}

${documentContext ? `EXTRA CONTEXT FROM UPLOADED DOCUMENTS:\n${documentContext}\n` : ""}

Please generate the following sections in a structured way:
1. Consortium & Roles: For each participant, propose:
   - Role (e.g. coordinator, WP leader, technical partner, pilot site, exploitation partner).
   - Main responsibilities.
   - Indicative effort (e.g. relative percentage of work or indicative person-months).

2. Part A – short project description:
   - Project title (if AI-generated).
   - Objectives.
   - High-level concept and approach.
   - Summary of consortium composition and added value.

3. Budget Proposal per Partner: For each participant:
   - Indicative budget share (percentage of total and estimated amount in EUR).
   - High-level cost categories (personnel, subcontracting, travel, equipment, etc.).
   - Guided by the call's max budget and number of partners.

4. Part B – detailed project description:
   - Project description and objectives.
   - Impact (expected outcomes, target stakeholders, alignment with EU policies).
   - Innovation (state-of-the-art, novelty, added value).
   - Methodology and work plan: key work packages (WP1-WP5), tasks, deliverables, milestones, and timeline overview.
   - Consortium description: roles and competences of each partner, why this consortium is fit.
   - Budget narrative: qualitative explanation of major cost items and resource allocation.
   - Risks and mitigation measures.
   - Dissemination, communication, and exploitation plan.

FORMAT: Return ONLY a JSON object with strictly these keys: "consortium_roles", "part_a", "budget", "part_b". 
Current "part_b" should be an object containing sub-keys for each bullet point above.`;

    console.log("Sending request to Perplexity API...");

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
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
        ]
      }),
    });

    console.log("Perplexity Request Status:", response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Perplexity Error Body:", errorBody);
      try {
        const errorData = JSON.parse(errorBody);
        throw new Error(`Perplexity API Error: ${JSON.stringify(errorData)}`);
      } catch {
        throw new Error(`Perplexity API Error (${response.status}): ${errorBody}`);
      }
    }

    const result = await response.json();
    console.log("Perplexity Response Received successfully.");

    let content;
    try {
      let rawContent = result.choices[0].message.content.trim();
      // Handle the case where AI wraps JSON in markdown backticks
      if (rawContent.startsWith("```json")) {
        rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (rawContent.startsWith("```")) {
        rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();
      }
      content = JSON.parse(rawContent);
    } catch (e) {
      console.error("Failed to parse Perplexity JSON content:", result.choices[0].message.content);
      throw new Error("AI returned invalid JSON format. Please try again.");
    }

    // Save back to Firebase
    await set(ref(rtdb, `application_drafts/${draftId}/analysis`), content);
    await set(ref(rtdb, `application_drafts/${draftId}/status`), "completed");

    return NextResponse.json({ success: true, data: content });

  } catch (e) {
    console.error("Analysis Pipeline Error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function generateMockAnalysis(draft: any) {
  const { participants, callMetadata } = draft;
  return {
    consortium_roles: participants.map((p: any, i: number) => ({
      name: p.name,
      role: i === 0 ? "Coordinator" : "Technical Partner",
      responsibilities: "Leading primary research and development of the core platform.",
      effort: "15 PM"
    })),
    part_a: {
      title: draft.projectTitle || "SMART-EU " + callMetadata?.topicCode,
      objectives: "To revolutionize the way data is handled in this sector through innovative blockchain and AI technologies.",
      concept: "A distributed ledger system that ensures transparency and efficiency across the entire value chain.",
      value: "This consortium brings together world-class research institutes and industry leaders."
    },
    budget: participants.map((p: any, i: number) => ({
      name: p.name,
      share: i === 0 ? "40%" : "30%",
      amount: "€1.2M",
      categories: ["Personnel", "Travel", "Equipment"]
    })),
    part_b: {
      description: "Detailed description of the project aims and technical feasibility.",
      impact: "Significant reduction in operational costs and carbon footprint.",
      innovation: "State-of-the-art AI integration for real-time optimization.",
      methodology: "Agile development with iterative pilots across 3 EU countries.",
      consortium: "A balanced mix of academic rigor and industrial scale.",
      budget_narrative: "Resource allocation is weighted towards key technical developments.",
      risks: "Potential delays in hardware supply chain (mitigated by multiple vendors).",
      dissemination: "Dedicated website, social media, and 5 peer-reviewed publications."
    }
  };
}
