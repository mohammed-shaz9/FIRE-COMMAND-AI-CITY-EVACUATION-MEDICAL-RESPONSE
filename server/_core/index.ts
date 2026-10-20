import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initSocket } from "./socket";
import { startMonitorLoop, stopMonitorLoop } from "../agent/monitor";
import { seedDemoData } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for frontend deployments (e.g. Vercel)
  app.use(cors({
    origin: "*", // Allow all for demo; can be restricted to Vercel URL
    credentials: true
  }));

  // Initialize Socket.io
  initSocket(server);

  // Seed demo data
  await seedDemoData();

  // Start automated monitoring
  startMonitorLoop();

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Health check route
  app.get("/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV });
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const isProd = process.env.NODE_ENV === "production";

  // In production (e.g. Railway), we must listen strictly on the assigned PORT
  const port = isProd ? preferredPort : await findAvailablePort(preferredPort);

  if (!isProd && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const shutdown = () => {
    stopMonitorLoop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port} (mode: ${process.env.NODE_ENV || 'development'})`);
  });
}

process.on("unhandledRejection", (reason) => console.error("[Server] Unhandled rejection:", reason));

startServer().catch(console.error);
