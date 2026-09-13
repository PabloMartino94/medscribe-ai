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
 * The transcription model takes its behaviour from config, not from prose:
 * asking it in the prompt to label speakers was simply ignored. Kept short and
 * purely about vocabulary.
 */
const GEMINI_INSTRUCTION =
  `Transcribí el audio palabra por palabra, en su idioma original. ${DOMAIN_HINT} ` +
  "Devolvé únicamente la transcripción, sin comentarios, sin encabezados y sin comillas. " +
  "Si el audio no contiene habla, devolvé una cadena vacía.";

/** Turn prefixes the rest of the pipeline understands. */
const SPEAKER_LINE = /^(Médico|Paciente|Acompañante|Hablante)[^:\n]{0,20}:/im;

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

type GeminiPart = {
  text?: string;
  speaker?: string;
  speakerId?: string | number;
  audioTranscription?: { text?: string; speaker?: string; speakerId?: string | number };
};

/**
 * Pulls the transcript out of a generateContent response.
 *
 * The transcription model can answer with either plain `text` parts or
 * `audioTranscription` parts; the OpenAI-compatible surface only forwards the
 * former, which is why that path returned an empty string for real speech and
 * this one talks to Gemini directly.
 */
function extractTranscript(body: unknown): { text: string; partKeys: string[] } {
  const parts =
    (body as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> })?.candidates?.[0]
      ?.content?.parts ?? [];

  const partKeys = [...new Set(parts.flatMap((p) => Object.keys(p ?? {})))];

  // With diarization on, each turn arrives as its own part carrying a speaker.
  // Turns go on their own lines so the labels survive into the note.
  const lines = parts.map((part) => {
    const text = (part.text ?? part.audioTranscription?.text ?? "").trim();
    if (!text) return "";
    const speaker =
      part.speaker ??
      part.audioTranscription?.speaker ??
      part.speakerId ??
      part.audioTranscription?.speakerId;
    return speaker !== undefined ? `${speaker}: ${text}` : text;
  });

  const joined = lines.some((l) => l.includes(": ")) ? lines.filter(Boolean).join("\n") : lines.join("");
  return { text: joined.trim(), partKeys };
}

const LABEL_INSTRUCTION =
  "Lo que sigue es la transcripción de una consulta médica, sin identificar quién habla.\n" +
  'Reescribila separando las intervenciones, una por línea, con el prefijo "Médico:", ' +
  '"Paciente:" o "Acompañante:" según quién la haya dicho.\n' +
  "REGLAS: no cambies, no resumas, no corrijas y no agregues palabras. Solo separá y " +
  'etiquetá. Si no se puede saber quién habla en una intervención, usá "Hablante:".\n' +
  "Devolvé únicamente la transcripción etiquetada.";

/**
 * Labels turns from content when the audio pipeline did not label them.
 *
 * This is inference, not acoustics: it reads who plausibly said each line
 * ("respirá profundo" is the physician, "me duele" the patient). Worse than
 * real diarization, better than one undifferentiated block — and the note's
 * attribution rules need labels to work at all.
 */
async function labelSpeakers(transcript: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: MODELS.structure,
      messages: [
        { role: "system", content: LABEL_INSTRUCTION },
        { role: "user", content: transcript },
      ],
    });

    const labelled = (completion.choices[0]?.message?.content ?? "").trim();
    if (!labelled || !SPEAKER_LINE.test(labelled)) return transcript;

    // A model that summarised instead of labelling would silently drop clinical
    // content, so anything much shorter than the original is not trusted.
    if (labelled.length < transcript.length * 0.6) return transcript;

    return labelled;
  } catch {
    // Labelling is an enhancement; never lose the transcript over it.
    return transcript;
  }
}

/**
 * Pulls speaker-labelled turns out of an Interactions API response.
 *
 * The exact nesting is not something to hard-code against: the response is
 * walked for any object carrying text, and the nearest speaker field wins.
 * Anything unrecognised falls through to the caller's fallback.
 */
function extractTurns(node: unknown, out: Array<{ speaker?: string; text: string }> = []) {
  if (Array.isArray(node)) {
    for (const item of node) extractTurns(item, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  const obj = node as Record<string, unknown>;
  const text = typeof obj["text"] === "string" ? obj["text"] : undefined;
  const speaker =
    typeof obj["speaker"] === "string"
      ? obj["speaker"]
      : typeof obj["speaker_id"] === "string" || typeof obj["speaker_id"] === "number"
        ? String(obj["speaker_id"])
        : typeof obj["speakerId"] === "string" || typeof obj["speakerId"] === "number"
          ? String(obj["speakerId"])
          : undefined;

  if (text && text.trim()) {
    out.push(speaker ? { speaker, text: text.trim() } : { text: text.trim() });
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") extractTurns(value, out);
  }
  return out;
}

/**
 * Speech to text through the Interactions API, which is where Gemini exposes
 * real speaker separation. `generateContent` silently ignores the diarization
 * setting, so a two-voice recording came back as one block.
 */
async function transcribeWithInteractions(
  buffer: Buffer,
  mimeType: string,
): Promise<{ transcript: string; diarized: boolean; keys: string[] } | null> {
  const url = `${GEMINI_NATIVE_BASE_URL.replace(/\/+$/, "")}/interactions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": AI_API_KEY,
        "content-type": "application/json",
        // The endpoint is versioned by date, not by path.
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify({
        model: MODELS.transcribe,
        input: [
          { type: "text", text: GEMINI_INSTRUCTION },
          { type: "audio", data: buffer.toString("base64"), mime_type: mimeType },
        ],
        generation_config: {
          // Diarization is only available alongside verbatim mode.
          transcription_config: { mode: { type: "verbatim", diarization_mode: "speaker" } },
        },
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const body: unknown = await response.json().catch(() => null);
  if (!body) return null;

  const turns = extractTurns(body);
  if (turns.length === 0) return null;

  const diarized = turns.some((t) => t.speaker !== undefined);
  const transcript = diarized
    ? turns.map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text)).join("\n")
    : turns.map((t) => t.text).join(" ");

  return {
    transcript: cleanTranscript(transcript),
    diarized,
    keys: Object.keys(body as Record<string, unknown>),
  };
}

/** Speech to text through Gemini's own REST API. */
async function transcribeWithGemini(
  buffer: Buffer,
  format: TranscribableFormat,
  onDiagnostic?: (info: Record<string, unknown>) => void,
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
        // Speaker separation is a config switch, not something the model can be
        // asked for in the prompt. Capped at 30 minutes of audio when on.
        generationConfig: {
          audioTranscriptionConfig: { diarization: true },
        },
      }),
    });
  } catch {
    throw new AiProviderError("No se pudo contactar a Gemini. Reintentá en unos segundos.");
  }

  if (!response.ok) {
    throw aiErrorFromStatus(response.status, MODELS.transcribe);
  }

  const { text, partKeys } = extractTranscript(await response.json());
  onDiagnostic?.({ path: "generateContent", partKeys });
  return cleanTranscript(text);
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
  onDiagnostic?: (info: Record<string, unknown>) => void,
): Promise<string> {
  if (PROVIDER === "gemini") {
    // Preferred: real separation by voice.
    const viaInteractions = await transcribeWithInteractions(buffer, MIME_BY_FORMAT[format]);

    if (viaInteractions?.diarized && viaInteractions.transcript) {
      onDiagnostic?.({ path: "interactions", diarization: "acoustic" });
      return viaInteractions.transcript;
    }

    // Otherwise fall back to generateContent, then infer the speakers from
    // what was said. Inference is the last resort, never the first choice.
    const transcript =
      viaInteractions?.transcript ||
      (await transcribeWithGemini(buffer, format, onDiagnostic));

    if (!transcript || SPEAKER_LINE.test(transcript)) return transcript;

    onDiagnostic?.({
      diarization: "absent",
      interactionsKeys: viaInteractions?.keys,
    });
    return labelSpeakers(transcript);
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
