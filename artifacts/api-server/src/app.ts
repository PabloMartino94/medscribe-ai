import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import { APIError } from "openai";
import { AiProviderError } from "@workspace/openai";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Drop the query string: it is not needed and could carry identifiers.
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// In production the frontend is served by this same process, so no browser ever
// makes a cross-origin call. CORS_ORIGINS exists for the case where the SPA is
// hosted separately; left unset, no cross-origin request is allowed.
const corsOrigins = (process.env["CORS_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins }));
}

// Refine sends a whole note back, and transcripts of long consultations are
// bigger than the 100kb default.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------

// Defaults to the built Vite output, resolved from this bundle's location
// (artifacts/api-server/dist) so the same layout works locally and in Docker.
const staticDir =
  process.env["STATIC_DIR"] ??
  path.resolve(__dirname, "..", "..", "medscribe", "dist", "public");

app.use(
  express.static(staticDir, {
    index: false,
    // Vite emits content-hashed asset filenames, so they can be cached hard.
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

// SPA fallback. Registered as plain middleware rather than a wildcard route
// because Express 5's path matcher no longer accepts a bare "*" pattern.
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(staticDir, "index.html"), (err) => {
    if (err) next();
  });
});

app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    req.log.error({ err }, "Unhandled error");

    // Only errors this app raised carry a status we are willing to send. An
    // upstream client's error also has `.status`, and adopting it once turned
    // a Gemini "unknown model" 404 into a 404 on our own route — which reads
    // as if the endpoint did not exist.
    const status =
      err instanceof AiProviderError
        ? err.status
        : typeof (err as { status?: number })?.status === "number" &&
            !(err instanceof APIError)
          ? (err as { status: number }).status
          : 500;

    const message =
      err instanceof AiProviderError
        ? err.message
        : status === 500
          ? "Error interno del servidor"
          : (err as Error).message;

    res.status(status).json({ error: message });
  },
);

export default app;
