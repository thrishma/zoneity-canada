import { NextRequest } from "next/server";
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
- Use query_open_data for questions about: building permits, neighbourhood associations, planning communities, landmarks (schools/parks/services), and address-level amenity proximity.
- Cite the source (municipality, bylaw name) inline after every regulation value.
- If the question involves multiple municipalities, call get_structured_metrics with all relevant IDs and compare.
- Never fabricate regulation values — if the data shows null/MISSING, say the data was not found in the indexed sections.
- Be concise but thorough. Planners and researchers need precise, citable answers.
- When comparing municipalities, use a markdown table.

OPEN DATA DATASETS (data.waterloo.ca):
- building_permits: City of Waterloo building permits — filter by STATUS, ISSUE_YEAR, PERMITTYPE, ADDRESS. Aggregate by ISSUE_YEAR or STATUS.
- planning_communities: Kitchener planning community boundaries — 55 communities, fields: PLANNING_COMMUNITY, PLANNINGCOMMUNITYID.
- neighbourhood_assoc: City of Waterloo neighbourhood associations — 45 neighbourhoods, fields: NAME, WEBSITE.
- landmarks: Kitchener landmarks — fields: LANDMARK (name), CATEGORY, SUBCATEGORY, STREET, CIVIC_NO. Key CATEGORY values: "PARK", "EDUCATION FACILITY", "EMERGENCY SERVICE", "GOVERNMENT SERVICE", "PLAYGROUND", "PLACE OF WORSHIP", "POINT OF INTEREST", "LIBRARY", "SPORTS SOCCER" etc.
- address_proximity: Kitchener address proximity — nearest park/school/etc per address — fields: ADDRESS, NEAREST_PARK, NEAREST_ELEMENTARY_SCHOOL.

CITATION FORMAT: *(City of [Municipality], [Bylaw Name], s.[X.X])*`;

function encode(obj: Record<string, string>) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function POST(req: NextRequest) {
  const body: ChatPayload = await req.json();
  const { question, municipalityId, municipalityName } = body;

  if (!question?.trim()) {
    return new Response(JSON.stringify({ error: "question is required" }), { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const municipalityContext = municipalityName
    ? `\n\nActive municipality filter: **${municipalityName}** (id: ${municipalityId ?? "unknown"}).`
    : "";

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
        "Get structured zoning metrics for one or more municipalities. Use this FIRST for regulation values or comparisons.",
      schema: z.object({
        municipality_ids: z.array(z.string()).describe(
          "Municipality IDs e.g. ['waterloo-on', 'kitchener-on']. Use ['all'] for all municipalities."
        ),
      }),
    }
  );

  const searchBylaws = tool(
    async ({ query, municipality_id, bylaw_type, limit }: {
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
        "Semantic search across ingested bylaw sections for specific clause text, conditions, or exceptions.",
      schema: z.object({
        query: z.string().describe("Plain-English search query"),
        municipality_id: z.string().optional(),
        bylaw_type: z
          .enum(["zoning_bylaw", "official_plan", "parking_bylaw", "site_plan_bylaw"])
          .optional(),
        limit: z.number().optional(),
      }),
    }
  );

  const queryOpenData = tool(
    async ({ dataset, municipality, filters, aggregate, limit }: {
      dataset: string;
      municipality?: string;
      filters?: Record<string, string>;
      aggregate?: string;
      limit?: number;
    }) => {
      const params = new URLSearchParams({ dataset });
      if (municipality) params.set("municipality", municipality);
      if (aggregate) params.set("aggregate", aggregate);
      if (limit) params.set("limit", String(Math.min(limit, 50)));
      for (const [key, value] of Object.entries(filters ?? {})) {
        params.set(`filter[${key}]`, value);
      }
      const data = await fetch(`${base}/api/open-data?${params}`).then((r) => r.json()) as {
        total?: number;
        features?: unknown[];
        buckets?: unknown[];
        aggregate?: string;
      };
      // Return summary to keep context manageable
      if (data.buckets) {
        return JSON.stringify({ aggregate: data.aggregate, buckets: data.buckets });
      }
      return JSON.stringify({
        total: data.total,
        sample: (data.features ?? []).slice(0, 10),
      });
    },
    {
      name: "query_open_data",
      description:
        "Query open datasets from data.waterloo.ca: building_permits, planning_communities, neighbourhood_assoc, landmarks, address_proximity. Use aggregate to count records by a property (e.g. ISSUE_YEAR, STATUS). Use filters to narrow results by property values.",
      schema: z.object({
        dataset: z
          .enum(["building_permits", "planning_communities", "neighbourhood_assoc", "landmarks", "address_proximity"])
          .describe("Which dataset to query"),
        municipality: z.string().optional().describe("e.g. 'waterloo-on' or 'kitchener-on'"),
        filters: z.record(z.string(), z.string()).optional().describe(
          "Property key=value filters e.g. { STATUS: 'Issued', ISSUE_YEAR: '2023' }"
        ),
        aggregate: z.string().optional().describe(
          "Property key to group and count by, e.g. 'ISSUE_YEAR' or 'STATUS'"
        ),
        limit: z.number().optional().describe("Max records to return (max 50)"),
      }),
    }
  );

  const llm = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
    streaming: true,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT + municipalityContext],
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  const agent = await createOpenAIToolsAgent({
    llm,
    tools: [getStructuredMetrics, searchBylaws, queryOpenData],
    prompt,
  });

  const executor = new AgentExecutor({
    agent,
    tools: [getStructuredMetrics, searchBylaws, queryOpenData],
    maxIterations: 5,
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const eventStream = executor.streamEvents(
          { input: question },
          { version: "v2" }
        );

        for await (const event of eventStream) {
          // Tool call status — show the user what the agent is doing
          if (event.event === "on_tool_start") {
            const statusMap: Record<string, string> = {
              get_structured_metrics: "Fetching zoning metrics...",
              search_bylaws: "Searching bylaws...",
              query_open_data: "Querying open data...",
            };
            const toolName = statusMap[event.name] ?? "Working...";
            controller.enqueue(encode({ type: "status", content: toolName }));
          }

          // Stream LLM tokens — skip tool-call chunks (they have no string content)
          if (event.event === "on_chat_model_stream") {
            const raw = event.data?.chunk?.content;
            const token =
              typeof raw === "string"
                ? raw
                : Array.isArray(raw) && typeof raw[0]?.text === "string"
                ? raw[0].text
                : "";
            if (token) {
              controller.enqueue(encode({ type: "token", content: token }));
            }
          }

          // Fallback: capture full output from agent finish if no tokens streamed
          if (event.event === "on_chain_end" && event.name === "AgentExecutor") {
            const output = event.data?.output?.output;
            if (typeof output === "string" && output) {
              controller.enqueue(encode({ type: "fallback", content: output }));
            }
          }
        }

        controller.enqueue(encode({ type: "done", content: "" }));
      } catch (err) {
        console.error("[chat/stream]", err);
        controller.enqueue(encode({ type: "error", content: "Stream failed" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
