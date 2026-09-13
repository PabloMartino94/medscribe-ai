import { MODELS, PROVIDER, openai } from "./client";

/**
 * Asks the provider which models this key can actually reach, and logs the
 * answer next to the ones configured.
 *
 * Opt-in via AI_DIAGNOSTICS=1, because it costs a network round trip on every
 * boot. It exists because a wrong model id surfaces as a bare 404 with no body
 * — the provider does not say which name it expected, so the only way to find
 * out is to ask for the list.
 */
export async function logAiDiagnostics(
  log: (obj: Record<string, unknown>, msg: string) => void,
): Promise<void> {
  if (process.env["AI_DIAGNOSTICS"] !== "1") return;

  const configured = { transcribe: MODELS.transcribe, structure: MODELS.structure };

  try {
    const available: string[] = [];
    for await (const model of openai.models.list()) {
      available.push(model.id);
    }
    log({ provider: PROVIDER, configured, available }, "AI diagnostics");
  } catch (err) {
    log({ provider: PROVIDER, configured, err }, "AI diagnostics failed");
  }
}
