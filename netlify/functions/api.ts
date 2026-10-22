import express from "express";
import serverless from "serverless-http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../server/routers";
import { createContext } from "../../server/_core/context";
import { tickOnce } from "../../server/agent/monitor";
import { seedDemoData } from "../../server/db";

// Netlify Functions have no long-lived timer, so the 2 s monitor loop is replayed on demand from
// elapsed time on each request. State lives in this warm instance's memory (resets on cold start).
// ponytail: in-memory per-instance; add a store (Netlify Blobs) if cold-start resets matter.
let last = Date.now();
let seeded: Promise<void> | null = null;

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(async (_req, _res, next) => {
  seeded ??= seedDemoData();
  await seeded;
  const due = Math.min(8, Math.floor((Date.now() - last) / 2000));
  last += due * 2000;
  if (Date.now() - last > 20000) last = Date.now();
  for (let i = 0; i < due; i++) await tickOnce();
  next();
});
app.get("/api/health", (_q, r) => { r.json({ status: "ok", host: "netlify" }); });
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

export const handler = serverless(app);
