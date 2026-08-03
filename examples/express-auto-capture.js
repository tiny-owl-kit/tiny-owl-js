/**
 * Example: Express Auto-Capture (task 015.1)
 *
 * Demonstrates the optional `@tiny-owl-kit/observability/express` adapter,
 * which auto-fills `context.method` / `context.endpoint` (and `statusCode`
 * on errors) so you don't have to pass them by hand on every log call.
 *
 * Run: node examples/express-auto-capture.js  (after `npm run build`)
 */

import express from "express";
import { TinyOwl } from "../dist/index.js";
import { tinyowlExpress } from "../dist/express.js";

const client = new TinyOwl({
  apiKey: process.env.TINYOWL_API_KEY ?? "your-api-key-here",
  projectSecret:
    process.env.TINYOWL_PROJECT_SECRET ?? "your-project-secret-here",
  baseUrl: process.env.TINYOWL_BASE_URL ?? "http://localhost:5001/api",
});

const app = express();

// Mount before your routes — attaches `req.tinyowl`.
app.use(tinyowlExpress(client));

app.get("/users/:id", async (req, res) => {
  // context automatically includes { method: "GET", endpoint: "/users/:id" }
  // — the *route template*, not the raw "/users/123" URL, to keep event
  // cardinality low. Pass extra fields explicitly if you need them.
  await req.tinyowl.info("Fetched user", { userId: req.params.id });
  res.json({ id: req.params.id, name: "Ada Lovelace" });
});

app.get("/boom", () => {
  throw new Error("Something broke");
});

// Mount last — auto-logs uncaught errors, then forwards to your own handler.
app.use(tinyowlExpress.errorHandler(client));

// Your app's own error handler still runs as normal — this adapter never
// swallows errors or writes to the response.
app.use((err, _req, res, _next) => {
  console.error("❌ Unhandled error:", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`🦉 Example server listening on http://localhost:${port}`);
});
