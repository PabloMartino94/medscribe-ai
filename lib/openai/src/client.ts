import OpenAI from "openai";

const apiKey = process.env["OPENAI_API_KEY"];

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY must be set. Create a key at https://platform.openai.com/api-keys " +
      "and add it to the environment (see .env.example).",
  );
}

// `OPENAI_BASE_URL` lets the app run against an OpenAI-compatible gateway
// (Azure OpenAI, OpenRouter, a self-hosted proxy) without code changes.
const baseURL = process.env["OPENAI_BASE_URL"];

export const openai = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});

/**
 * Models are env-configurable so the deployment can be re-pointed without a
 * rebuild. The defaults are the cheapest models that still produce reliable
 * Spanish clinical prose and strict JSON.
 */
export const MODELS = {
  transcribe: process.env["OPENAI_TRANSCRIBE_MODEL"] || "gpt-4o-mini-transcribe",
  structure: process.env["OPENAI_STRUCTURE_MODEL"] || "gpt-4o",
} as const;
