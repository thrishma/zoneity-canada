import { NextRequest, NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ChatPayload } from "@/types";

const SYSTEM_PROMPT = `You are a Canadian municipal zoning expert assistant for Zoneity Canada — a national zoning intelligence engine.
You help researchers, housing advocates, developers, planners, and journalists understand zoning bylaws
and land use regulations across Canadian municipalities.

RULES:
- For questions about specific regulation values (lot size, height, parking, density, secondary suites, multiplexes), ALWAYS call get_structured_metrics FIRST. It returns precise extracted values directly from bylaws.
- Use search_bylaws for specific clause wording, conditions, exceptions, or topics not covered by structured metrics.
- Cite the source (municipality, bylaw name) inline after every regulation value.
- If the question involves multiple municipalities, call get_structured_metrics with all relevant IDs and compare.
- Never fabricate regulation values — if the data shows null/MISSING, say the data was not found in the indexed sections.
- Be concise but thorough. Planners and researchers need precise, citable answers.
- When comparing municipalities, use a markdown table.

CITATION FORMAT: *(City of [Municipality], [Bylaw Name], s.[X.X])*`;

export async function POST(req: NextRequest) {
  try {
    const body: ChatPayload = await req.json();
    const { question, municipalityId, municipalityName } = body;

    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const municipalityContext = municipalityName
      ? `\n\nActive municipality filter: **${municipalityName}** (id: ${municipalityId ?? "unknown"}). Focus answers on this municipality unless the user asks to compare others.`
      : "";

    // ── LangChain tools ────────────────────────────────────────────────────────

    const getStructuredMetrics = tool(
      async ({ municipality_ids }: { municipality_ids: string[] }) => {
        const ids = municipality_ids.includes("all")
          ? await fetch(`${base}/api/bylaws/municipalities`)
              .then((r) => r.json())
              .then((d: { municipalities?: { id: string }[] }) =>
                (d.municipalities ?? []).map((m) => m.id)
              )
          : municipality_ids;

        const qs = ids.map((id: string) => `id=${encodeURIComponent(id)}`).join("&");
        const data = await fetch(`${base}/api/bylaws/compare?${qs}`).then((r) => r.json()) as {
          metrics?: unknown[];
        };
        return JSON.stringify(data.metrics ?? []);
      },
      {
        name: "get_structured_metrics",
        description:
          "Get structured zoning metrics (min lot size, max height, parking, density, secondary suites, multiplexes) for one or more municipalities. Use this FIRST when asked about specific regulation values or comparisons.",
        schema: z.object({
          municipality_ids: z
            .array(z.string())
            .describe(
              "List of municipality IDs e.g. ['waterloo-on', 'kitchener-on']. Use ['all'] to get all indexed municipalities."
            ),
        }),
      }
    );

    const searchBylaws = tool(
      async ({
        query,
        municipality_id,
        bylaw_type,
        limit,
      }: {
        query: string;
        municipality_id?: string;
        bylaw_type?: string;
        limit?: number;
      }) => {
        const params = new URLSearchParams({ q: query });
        if (municipality_id) params.set("municipality", municipality_id);
        if (bylaw_type) params.set("type", bylaw_type);
        if (limit) params.set("limit", String(limit));

        const data = await fetch(`${base}/api/bylaws/search?${params}`).then((r) => r.json()) as {
          results?: unknown[];
        };
        return JSON.stringify(data.results ?? []);
      },
      {
        name: "search_bylaws",
        description:
          "Semantic search across ingested bylaw sections. Use for specific clause text, conditions, or regulations not covered by structured metrics.",
        schema: z.object({
          query: z.string().describe("Plain-English search query"),
          municipality_id: z
            .string()
            .optional()
            .describe("Filter to a specific municipality id"),
          bylaw_type: z
            .enum(["zoning_bylaw", "official_plan", "parking_bylaw", "site_plan_bylaw"])
            .optional()
            .describe("Filter by document type"),
          limit: z.number().optional().describe("Number of results (default 6, max 12)"),
        }),
      }
    );

    // ── LangChain agent ────────────────────────────────────────────────────────

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", SYSTEM_PROMPT + municipalityContext],
      ["human", "{input}"],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = await createOpenAIToolsAgent({
      llm,
      tools: [getStructuredMetrics, searchBylaws],
      prompt,
    });

    const executor = new AgentExecutor({
      agent,
      tools: [getStructuredMetrics, searchBylaws],
      maxIterations: 4,
      returnIntermediateSteps: false,
    });

    const result = await executor.invoke({ input: question });

    return NextResponse.json({ answer: result.output ?? "" });
  } catch (err) {
    console.error("[chat/langchain]", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
