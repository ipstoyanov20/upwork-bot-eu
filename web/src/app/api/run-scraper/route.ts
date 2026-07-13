import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { keyword } = await req.json();
    if (!keyword) {
      return new Response(JSON.stringify({ error: "Keyword is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const currentDir = process.cwd();
    const rootDir = currentDir.endsWith("web") 
      ? currentDir.slice(0, -3) 
      : currentDir.endsWith("web/") || currentDir.endsWith("web\\")
      ? currentDir.slice(0, -4)
      : currentDir;
      
    const scraperPath = rootDir + (rootDir.endsWith("/") || rootDir.endsWith("\\") ? "" : "/") + "puppeteer_scraper.js";

    const cmd = "node";
    const args = [scraperPath, keyword];
    const opts = {
      cwd: rootDir,
      env: { ...process.env },
    };

    const child = spawn(cmd, args, opts);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let isClosed = false;
        child.stdout.on("data", (data) => {
          if (!isClosed) {
            try { controller.enqueue(encoder.encode(data.toString())); } catch(e) {}
          }
        });

        child.stderr.on("data", (data) => {
          if (!isClosed) {
            try { controller.enqueue(encoder.encode(data.toString())); } catch(e) {}
          }
        });

        child.on("close", (code) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`\n[PROCESS_COMPLETED] Scraper finished with exit code ${code}\n`));
              controller.close();
            } catch(e) {}
            isClosed = true;
          }
        });

        child.on("error", (err) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`[PROCESS_ERROR] Failed to start scraper: ${err.message}\n`));
              controller.close();
            } catch(e) {}
            isClosed = true;
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
