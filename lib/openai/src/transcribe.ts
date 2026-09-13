import { Buffer } from "node:buffer";
import { toFile } from "openai";
import {
  AI_API_KEY,
  GEMINI_NATIVE_BASE_URL,
  MODELS,
  PROVIDER,
  openai,
} from "./client";
import { AiProviderError, aiErrorFromStatus, toAiProviderError } from "./errors";

export type TranscribableFormat = "wav" | "mp3";

/**
 * Steers the model toward clinical vocabulary. OpenAI takes it as the
 * transcription `prompt`; Gemini takes it as part of the instruction.
 */
const DOMAIN_HINT =
  "Consulta médica en español. Términos clínicos, nombres de fármacos, dosis y cifras de signos vitales.";

/**
 * Asks for speaker-labelled turns, not just words.
 *
 * In a recorded consultation it matters enormously who said what: a patient's
 * guess is part of the history, while the same sentence from the physician is
 * an assessment. Without labels the structuring step cannot tell them apart.
 * Only the Gemini path does this — OpenAI's transcription models do not
 * separate speakers.
 */
const GEMINI_INSTRUCTION =
  `Transcribí el audio palabra por palabra, en su idioma original. ${DOMAIN_HINT}\n` +
  "Es la grabación de una consulta médica. Identificá quién habla y escribí una línea " +
  'por intervención, con el prefijo "Médico:", "Paciente:" o "Acompañante:". ' +
  'Si no se puede determinar quién habla en una intervención, usá "Hablante:". ' +
  "Si habla una sola persona (un dictado), igual usá el prefijo que corresponda.\n" +
  "No resumas, no interpretes y no corrijas lo que se dice: esto es una transcripción.\n" +
  "Devolvé únicamente la transcripción, sin comentarios, sin encabezados y sin comillas. " +
  "Si el audio no contiene habla, devolvé una cadena vacía.";

/** Things a model may wrap a transcript in when asked for bare text. */
const EMPTY_ANSWERS = new Set([
  "",
  '""',
  "(sin habla)",
  "[sin habla]",
  "sin habla",
  "no hay habla",
  "(silencio)",
  "[silencio]",
  "silencio",
]);

function cleanTranscript(raw: string): string {
  let text = raw.trim();

  // Strip a single layer of surrounding quotes the model may have added.
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "«" && last === "»")) {
      text = text.slice(1, -1).trim();
    }
  }

  // On silence OpenAI sometimes echoes the prompt back, and Gemini sometimes
  // narrates the absence of speech. Both mean "nothing was said".
  if (text === DOMAIN_HINT) return "";
  if (EMPTY_ANSWERS.has(text.toLowerCase())) return "";

  return text;
}

/**
 * Speech to text, across both providers.
 *
 * OpenAI has a dedicated transcription endpoint. Gemini's OpenAI-compatible
 * surface does not implement `/audio/transcriptions` at all, so its audio goes
 * through `/chat/completions` as an `input_audio` content part instead.
 */
const MIME_BY_FORMAT: Record<TranscribableFormat, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

type GeminiPart = { text?: string; audioTranscription?: { text?: string } };

/**
 * Pulls the transcript out of a generateContent response.
 *
 * The transcription model can answer with either plain `text` parts or
 * `audioTranscription` parts; the OpenAI-compatible surface only forwards the
 * former, which is why that path returned an empty string for real speech and
 * this one talks to Gemini directly.
 */
function extractTranscript(body: unknown): string {
  const parts =
    (body as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> })?.candidates?.[0]
      ?.content?.parts ?? [];

  return parts
    .map((part) => part.text ?? part.audioTranscription?.text ?? "")
    .join("")
    .trim();
}

/** Speech to text through Gemini's own REST API. */
async function transcribeWithGemini(
  buffer: Buffer,
  format: TranscribableFormat,
): Promise<string> {
  const url = `${GEMINI_NATIVE_BASE_URL.replace(/\/+$/, "")}/models/${encodeURIComponent(
    MODELS.transcribe,
  )}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": AI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: GEMINI_INSTRUCTION },
              {
                inline_data: {
                  mime_type: MIME_BY_FORMAT[format],
                  data: buffer.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new AiProviderError("No se pudo contactar a Gemini. Reintentá en unos segundos.");
  }

  if (!response.ok) {
    throw aiErrorFromStatus(response.status, MODELS.transcribe);
  }

  return cleanTranscript(extractTranscript(await response.json()));
}

/**
 * Speech to text, across both providers.
 *
 * OpenAI has a dedicated transcription endpoint. Gemini has one too, but not
 * on its OpenAI-compatible surface — that path answers 200 with empty content
 * for the transcription model — so Gemini audio goes to its native REST API.
 */
export async function transcribeAudio(
  buffer: Buffer,
  format: TranscribableFormat,
  language: string,
): Promise<string> {
  if (PROVIDER === "gemini") {
    return transcribeWithGemini(buffer, format);
  }

  const transcription = await openai.audio.transcriptions
    .create({
      file: await toFile(buffer, `audio.${format}`),
      model: MODELS.transcribe,
      language,
      prompt: DOMAIN_HINT,
    })
    .catch((err: unknown) => {
      throw toAiProviderError(err, MODELS.transcribe);
    });

  return cleanTranscript(transcription.text);
}
