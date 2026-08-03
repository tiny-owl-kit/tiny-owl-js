/**
 * Example: Next.js Auto-Capture (task 015.1, Phase 2)
 *
 * Demonstrates the optional `@tiny-owl-kit/observability/nextjs` adapter,
 * which wraps an App Router Route Handler (`route.ts`) to auto-log
 * `method` / `endpoint` / `statusCode` on non-2xx responses and thrown
 * errors — without changing the core `EchoNova` log API.
 *
 * This file mirrors what you'd place at `app/api/users/[id]/route.ts` in a
 * real Next.js project. It isn't meant to be run standalone with `node`
 * (App Router Route Handlers only run inside the Next.js server runtime).
 */

import { TinyOwl } from "../dist/index.js";
import { withTinyowl } from "../dist/nextjs.js";

const client = new TinyOwl({
  apiKey: process.env.TINYOWL_API_KEY ?? "your-api-key-here",
  projectSecret:
    process.env.TINYOWL_PROJECT_SECRET ?? "your-project-secret-here",
  baseUrl: process.env.TINYOWL_BASE_URL ?? "http://localhost:5001/api",
});

// app/api/users/[id]/route.ts
export const GET = withTinyowl(
  client,
  async (req, { params }) => {
    const user = await getUser(params.id);
    if (!user) {
      // Auto-logged as an error with { method: "GET", endpoint: "/api/users/[id]", statusCode: 404 }
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(user);
  },
  // Low-cardinality template for the dynamic segment — avoids one event
  // "endpoint" value per concrete user id.
  { route: "/api/users/[id]" },
);

async function getUser(id) {
  if (id === "missing") return null;
  return { id, name: "Ada Lovelace" };
}
