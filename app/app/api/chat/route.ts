import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ChatPayload } from "@/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a Canadian municipal zoning expert assistant for the Zoneity Canada platform.
You help researchers, housing advocates, developers, planners, and journalists understand zoning bylaws
and land use regulations across Canadian municipalities.

You have access to a search tool. Use it to retrieve relevant bylaw sections before answering.

RULES:
- For questions about specific regulation values (lot size, height, parking, density, secondary suites, multiplexes), ALWAYS call get_structured_metrics FIRST. It returns precise extracted values directly from bylaws.
- Use search_bylaws for specific clause wording, conditions, exceptions, or topics not covered by structured metrics.
- Cite the source (municipality, bylaw name) inline after every regulation value.
- If the question involves multiple municipalities, call get_structured_metrics with all relevant IDs and compare.
- Never fabricate regulation values — if the data shows null/MISSING, say the data was not found in the indexed sections.
- Be concise but thorough. Planners and researchers need precise, citable answers.
- When comparing municipalities, use a markdown table.
- For general planning questions (e.g. "What is inclusionary zoning?"), answer directly without searching.

CITATION FORMAT: *(City of [Municipality], [Bylaw Name], s.[X.X])*

If a municipality filter is active, focus your search on that municipality unless the user asks for a comparison.`;

export async function POST(req: NextRequest) {
  try {
    const body: ChatPayload = await req.json();
    const { question, municipalityId, municipalityName } = body;

    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const municipalityContext = municipalityName
      ? `\n\nActive municipality filter: **${municipalityName}** (id: ${municipalityId ?? "unknown"}). Focus answers on this municipality unless the user asks to compare others.`
      : "";

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "get_structured_metrics",
          description:
            "Get structured zoning metrics (min lot size, max height, parking, density, secondary suites, multiplexes) for one or more municipalities. Use this FIRST when asked about specific regulation values or comparisons.",
          parameters: {
            type: "object",
            properties: {
              municipality_ids: {
                type: "array",
                items: { type: "string" },
                description: "List of municipality IDs (e.g. ['waterloo-on', 'kitchener-on']). Use 'all' to get all indexed municipalities.",
              },
            },
            required: ["municipality_ids"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_bylaws",
          description:
            "Semantic search across ingested bylaw sections. Use this for specific clause text, conditions, or regulations not covered by structured metrics.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Plain-English search query",
              },
              municipality_id: {
                type: "string",
                description: "Filter to a specific municipality id (optional)",
              },
              bylaw_type: {
                type: "string",
                enum: ["zoning_bylaw", "official_plan", "parking_bylaw", "site_plan_bylaw"],
                description: "Filter by document type (optional)",
              },
              limit: {
                type: "number",
                description: "Number of results (default 6, max 12)",
              },
            },
            required: ["query"],
          },
        },
      },
    ];

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT + municipalityContext },
      { role: "user", content: question },
    ];

    const MAX_ITERATIONS = 4;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools,
        tool_choice: "auto",
      });

      const choice = response.choices[0];
      messages.push({ role: "assistant", content: choice.message.content, tool_calls: choice.message.tool_calls });

      if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
        return NextResponse.json({ answer: choice.message.content ?? "" });
      }

      // Execute tool calls
      for (const tc of choice.message.tool_calls) {
        if (!("function" in tc)) continue;
        const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

        if (tc.function.name === "get_structured_metrics") {
          let args: { municipality_ids: string[] };
          try {
            args = JSON.parse(tc.function.arguments) as typeof args;
          } catch {
            messages.push({ role: "tool", tool_call_id: tc.id, content: "Invalid arguments" });
            continue;
          }

          const ids = args.municipality_ids.includes("all")
            ? await fetch(`${base}/api/bylaws/municipalities`)
                .then((r) => r.json())
                .then((d: { municipalities?: { id: string }[] }) => (d.municipalities ?? []).map((m) => m.id))
            : args.municipality_ids;

          const qs = ids.map((id: string) => `id=${encodeURIComponent(id)}`).join("&");
          const compareRes = await fetch(`${base}/api/bylaws/compare?${qs}`);
          const compareData = await compareRes.json() as { metrics?: unknown[] };

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(compareData.metrics ?? []),
          });
          continue;
        }

        if (tc.function.name === "search_bylaws") {
          let args: { query: string; municipality_id?: string; bylaw_type?: string; limit?: number };
          try {
            args = JSON.parse(tc.function.arguments) as typeof args;
          } catch {
            messages.push({ role: "tool", tool_call_id: tc.id, content: "Invalid arguments" });
            continue;
          }

          const params = new URLSearchParams({ q: args.query });
          if (args.municipality_id) params.set("municipality", args.municipality_id);
          if (args.bylaw_type) params.set("type", args.bylaw_type);
          if (args.limit) params.set("limit", String(args.limit));

          const searchRes = await fetch(`${base}/api/bylaws/search?${params}`);
          const data = await searchRes.json() as { results?: unknown[]; error?: string };

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(data.results ?? []),
          });
        }
      }
    }

    return NextResponse.json({ answer: "I was unable to complete the search in time. Please try again." });
  } catch (err) {
    console.error("[chat]", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
