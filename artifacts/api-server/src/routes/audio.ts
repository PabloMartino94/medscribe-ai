import { Router, type IRouter } from "express";
import multer from "multer";
import { toFile } from "openai";
import { TranscribeAudioResponse } from "@workspace/api-zod";
import { openai, MODELS } from "@workspace/openai";
import {
  convertToWav,
  detectAudioFormat,
  wavDurationSeconds,
} from "@workspace/openai/audio";
import { randomUUID } from "node:crypto";
import { authed, requireAuth } from "../middlewares/auth";
import { RECORDINGS_BUCKET } from "../lib/supabase";

const router: IRouter = Router();

// Memory storage only: audio never touches this server's disk. It is either
// discarded at the end of the request or handed straight to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const MIME_BY_FORMAT: Record<string, { mime: string; ext: string }> = {
  wav: { mime: "audio/wav", ext: "wav" },
  mp3: { mime: "audio/mpeg", ext: "mp3" },
  webm: { mime: "audio/webm", ext: "webm" },
  mp4: { mime: "audio/mp4", ext: "m4a" },
  ogg: { mime: "audio/ogg", ext: "ogg" },
};

router.post(
  "/audio/transcribe",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    const { user, supabase } = authed(req);

    const file = req.file;
    if (!file || file.size === 0) {
      res.status(400).json({ error: "No se recibió ningún archivo de audio" });
      return;
    }

    const language =
      typeof req.body?.language === "string" && req.body.language ? req.body.language : "es";
    const store = req.body?.store === "true" || req.body?.store === true;

    const detected = detectAudioFormat(file.buffer);

    // Store the original upload, not the 16 kHz mono WAV the model needs: it is
    // far smaller and is what the physician actually recorded.
    let audioPath: string | null = null;
    if (store) {
      const { mime, ext } = MIME_BY_FORMAT[detected] ?? { mime: "audio/webm", ext: "webm" };
      // The leading segment must be the user id — storage RLS checks it.
      const key = `${user.id}/${randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .upload(key, file.buffer, { contentType: mime, upsert: false });

      if (error) {
        // A failed upload must not cost the physician the transcription, so log
        // it and continue without a stored recording.
        req.log.error({ err: error }, "Failed to store recording");
      } else {
        audioPath = key;
      }
    }

    let buffer: Buffer;
    let ext: string;
    if (detected === "mp3") {
      buffer = file.buffer;
      ext = "mp3";
    } else if (detected === "wav") {
      buffer = file.buffer;
      ext = "wav";
    } else {
      try {
        buffer = await convertToWav(file.buffer);
        ext = "wav";
      } catch (err) {
        req.log.error({ err, detected, mimetype: file.mimetype }, "ffmpeg conversion failed");
        res.status(400).json({
          error: "No se pudo procesar el audio. Formatos soportados: mp3, m4a, wav, webm, ogg.",
        });
        return;
      }
    }

    const durationSeconds = ext === "wav" ? wavDurationSeconds(buffer) : 0;

    const prompt =
      "Consulta médica en español. Términos clínicos, nombres de fármacos, dosis y cifras de signos vitales.";
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(buffer, `audio.${ext}`),
      model: MODELS.transcribe,
      language,
      prompt,
    });

    let text = transcription.text.trim();
    // On silence the model sometimes echoes the prompt back; treat that as no speech.
    if (text === prompt) text = "";

    res.json(TranscribeAudioResponse.parse({ text, durationSeconds, audioPath }));
  },
);

export default router;
