import { Buffer } from "node:buffer";
import { toFile } from "openai";
import { MODELS, PROVIDER, openai } from "./client";

export type TranscribableFormat = "wav" | "mp3";

/**
 * Steers the model toward clinical vocabulary. OpenAI takes it as the
 * transcription `prompt`; Gemini takes it as part of the instruction.
 */
const DOMAIN_HINT =
  "Consulta médica en español. Términos clínicos, nombres de fármacos, dosis y cifras de signos vitales.";

const GEMINI_INSTRUCTION =
  `Transcribí el audio palabra por palabra, en su idioma original. ${DOMAIN_HINT} ` +
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
export async function transcribeAudio(
  buffer: Buffer,
  format: TranscribableFormat,
  language: string,
): Promise<string> {
  if (PROVIDER === "gemini") {
    const completion = await openai.chat.completions.create({
      model: MODELS.transcribe,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: GEMINI_INSTRUCTION },
            {
              type: "input_audio",
              input_audio: { data: buffer.toString("base64"), format },
            },
          ],
        },
      ],
    });

    return cleanTranscript(completion.choices[0]?.message?.content ?? "");
  }

  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(buffer, `audio.${format}`),
    model: MODELS.transcribe,
    language,
    prompt: DOMAIN_HINT,
  });

  return cleanTranscript(transcription.text);
}
