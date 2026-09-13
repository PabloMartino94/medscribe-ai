import { Buffer } from "node:buffer";
import { MODELS, PROVIDER, openai } from "./client";

type Log = (obj: Record<string, unknown>, msg: string) => void;

/** Half a second of silent 16 kHz mono PCM — enough to exercise an audio path. */
function silentWavBase64(): string {
  const samples = 8000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(16000 * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2)]).toString("base64");
}

function describe(err: unknown): string {
  const e = err as { status?: number; message?: string };
  return e?.status ? `${e.status}: ${e.message ?? ""}`.slice(0, 200) : String(e?.message ?? err);
}

/** Candidate ids to probe, configured one first, duplicates dropped. */
function candidates(configured: string, extra: string[]): string[] {
  return [...new Set([configured, ...extra])];
}

async function probeChat(model: string): Promise<string> {
  try {
    const r = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Responde solamente: ok" }],
      max_completion_tokens: 16,
    });
    return `ok (${(r.choices[0]?.message?.content ?? "").trim().slice(0, 20)})`;
  } catch (err) {
    return describe(err);
  }
}

async function probeAudio(model: string, wav: string): Promise<string> {
  try {
    const r = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribí el audio." },
            { type: "input_audio", input_audio: { data: wav, format: "wav" } },
          ],
        },
      ],
    });
    return `ok (${(r.choices[0]?.message?.content ?? "").trim().slice(0, 20)})`;
  } catch (err) {
    return describe(err);
  }
}

/**
 * Reports which models this key can actually reach, and which of them accept
 * the two calls the app makes.
 *
 * Opt-in via AI_DIAGNOSTICS=1. It exists because an unsupported model or
 * modality comes back as a bare 404 with no body: the provider never says
 * which name it expected, so the only way to find out is to try.
 */
export async function logAiDiagnostics(log: Log): Promise<void> {
  if (process.env["AI_DIAGNOSTICS"] !== "1") return;

  try {
    const available: string[] = [];
    for await (const model of openai.models.list()) available.push(model.id);
    log({ provider: PROVIDER, configured: MODELS, count: available.length }, "AI models listed");

    if (PROVIDER !== "gemini") return;

    const wav = silentWavBase64();

    const chatResults: Record<string, string> = {};
    for (const m of candidates(MODELS.structure, [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "models/gemini-2.5-flash",
    ])) {
      chatResults[m] = await probeChat(m);
    }
    log({ chatResults }, "AI chat probe");

    const audioResults: Record<string, string> = {};
    for (const m of candidates(MODELS.transcribe, [
      "gemini-3.5-transcribe",
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "models/gemini-2.5-flash",
    ])) {
      audioResults[m] = await probeAudio(m, wav);
    }
    log({ audioResults }, "AI audio probe");
  } catch (err) {
    log({ provider: PROVIDER, err: describe(err) }, "AI diagnostics failed");
  }
}
