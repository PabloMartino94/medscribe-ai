import app from "./app";
import { logAiDiagnostics } from "@workspace/openai";
import { logger } from "./lib/logger";

// Render injects PORT; 8080 keeps `pnpm dev` working without extra setup.
const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Opt-in (AI_DIAGNOSTICS=1) and deliberately not awaited: it must never
  // delay or fail startup.
  void logAiDiagnostics((obj, msg) => logger.info(obj, msg));
});
