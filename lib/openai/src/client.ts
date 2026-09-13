import OpenAI from "openai";

/**
 * Which API the key belongs to.
 *
 * Gemini exposes an OpenAI-compatible surface, so one client and one set of
 * call sites serve both. The compatibility is not total — it covers
 * `/chat/completions` but not `/audio/transcriptions` — which is why
 * transcription branches on this value; structuring does not need to.
 */
export type AiProvider = "openai" | "gemini";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

const DEFAULT_MODELS: Record<AiProvider, { transcribe: string; structure: string }> = {
  // Cheapest OpenAI models that still produce reliable Spanish clinical prose
  // and strict JSON.
  openai: { transcribe: "gpt-4o-mini-transcribe", structure: "gpt-4o" },
  // Probed against the live API: gemini-2.5-flash answers 404 on this key even
  // for plain chat, despite being listed. Transcription uses the dedicated
  // model on purpose — on half a second of silence the general-purpose flash
  // models invented speech ("Hola, buenos días."), which in a clinical note is
  // a fabricated finding; gemini-3.5-transcribe correctly returned nothing.
  gemini: { transcribe: "gemini-3.5-transcribe", structure: "gemini-3.5-flash" },
};

const rawProvider = (process.env["AI_PROVIDER"] ?? "openai").trim().toLowerCase();

if (rawProvider !== "openai" && rawProvider !== "gemini") {
  // Never echo the received value: the most likely way to get here is pasting
  // the API key into the wrong variable, and the message ends up in the logs.
  throw new Error(
    'AI_PROVIDER must be exactly "openai" or "gemini". ' +
      "If you meant to set the API key, the variable is AI_API_KEY.",
  );
}

export const PROVIDER: AiProvider = rawProvider;

const apiKey = process.env["AI_API_KEY"] || process.env["OPENAI_API_KEY"];

if (!apiKey) {
  throw new Error(
    PROVIDER === "gemini"
      ? "AI_API_KEY must be set to a Gemini API key (https://aistudio.google.com/apikey). See .env.example."
      : "AI_API_KEY must be set to an OpenAI API key (https://platform.openai.com/api-keys). See .env.example.",
  );
}

// An explicit base URL wins, so the app can also run against any other
// OpenAI-compatible gateway without a code change.
const baseURL =
  process.env["AI_BASE_URL"] ||
  process.env["OPENAI_BASE_URL"] ||
  (PROVIDER === "gemini" ? GEMINI_BASE_URL : undefined);

export const openai = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});

/** Models are env-configurable so a deployment can be re-pointed without a rebuild. */
export const MODELS = {
  transcribe:
    process.env["AI_TRANSCRIBE_MODEL"] ||
    process.env["OPENAI_TRANSCRIBE_MODEL"] ||
    DEFAULT_MODELS[PROVIDER].transcribe,
  structure:
    process.env["AI_STRUCTURE_MODEL"] ||
    process.env["OPENAI_STRUCTURE_MODEL"] ||
    DEFAULT_MODELS[PROVIDER].structure,
} as const;
