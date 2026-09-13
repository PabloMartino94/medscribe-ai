import { Router, type IRouter } from "express";
import {
  CreateConsultationBody,
  CreateConsultationResponse,
  DeleteAllConsultationsResponse,
  GetConsultationAudioResponse,
  GetConsultationResponse,
  ListConsultationsQueryParams,
  ListConsultationsResponse,
  UpdateConsultationBody,
  UpdateConsultationResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { authed, requireAuth } from "../middlewares/auth";
import {
  CONSULTATION_COLUMNS,
  removeRecordings,
  rowToConsultation,
  type ConsultationRow,
} from "../lib/consultations";
import { RECORDINGS_BUCKET } from "../lib/supabase";

const router: IRouter = Router();

const Uuid = z.string().uuid();

/** How long a recording playback link stays valid. */
const SIGNED_URL_TTL_SECONDS = 300;

router.use("/consultations", requireAuth);

router.get("/consultations", async (req, res) => {
  const { supabase } = authed(req);

  const params = ListConsultationsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "Parámetros de consulta inválidos" });
    return;
  }

  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(params.data.limit);

  if (error) {
    req.log.error({ err: error }, "Failed to list consultations");
    res.status(502).json({ error: "No se pudo leer el historial" });
    return;
  }

  res.json(
    ListConsultationsResponse.parse(
      (data as unknown as ConsultationRow[]).map(rowToConsultation),
    ),
  );
});

router.post("/consultations", async (req, res) => {
  const { user, supabase } = authed(req);

  const parsed = CreateConsultationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos: se requiere la nota estructurada" });
    return;
  }
  const { note, patientRef, transcript, audioPath, audioDurationSeconds } = parsed.data;

  const { data, error } = await supabase
    .from("consultations")
    .insert({
      user_id: user.id,
      patient_ref: patientRef ?? null,
      template: note.template,
      title: note.title,
      sections: note.sections,
      plain_text: note.plainText,
      anonymized: Boolean(note.anonymized),
      transcript: transcript ?? null,
      audio_path: audioPath ?? null,
      audio_duration_seconds: audioDurationSeconds ?? null,
    })
    .select(CONSULTATION_COLUMNS)
    .single();

  if (error || !data) {
    req.log.error({ err: error }, "Failed to create consultation");
    res.status(502).json({ error: "No se pudo guardar la consulta" });
    return;
  }

  res
    .status(201)
    .json(CreateConsultationResponse.parse(rowToConsultation(data as unknown as ConsultationRow)));
});

router.delete("/consultations", async (req, res) => {
  const { user, supabase } = authed(req);

  // Returning the deleted rows gives both the count and the object keys in one
  // round trip; listing the ids first and deleting by `in` would put every uuid
  // into the request URL. RLS would scope this to the caller anyway, but the
  // explicit user_id keeps the intent on the page.
  const { data, error } = await supabase
    .from("consultations")
    .delete()
    .eq("user_id", user.id)
    .select("audio_path");

  if (error) {
    req.log.error({ err: error }, "Failed to delete consultations");
    res.status(502).json({ error: "No se pudo borrar el historial" });
    return;
  }

  const rows = (data ?? []) as Array<{ audio_path: string | null }>;
  await removeRecordings(supabase, rows.map((r) => r.audio_path));

  res.json(DeleteAllConsultationsResponse.parse({ deleted: rows.length }));
});

router.get("/consultations/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Consulta no encontrada" });
    return;
  }

  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("id", id.data)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to read consultation");
    res.status(502).json({ error: "No se pudo leer la consulta" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Consulta no encontrada" });
    return;
  }

  res.json(GetConsultationResponse.parse(rowToConsultation(data as unknown as ConsultationRow)));
});

router.patch("/consultations/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Consulta no encontrada" });
    return;
  }

  const parsed = UpdateConsultationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const { note, patientRef } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (note) {
    patch["template"] = note.template;
    patch["title"] = note.title;
    patch["sections"] = note.sections;
    patch["plain_text"] = note.plainText;
    patch["anonymized"] = Boolean(note.anonymized);
  }
  if (patientRef !== undefined) patch["patient_ref"] = patientRef;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No hay cambios para aplicar" });
    return;
  }

  const { data, error } = await supabase
    .from("consultations")
    .update(patch)
    .eq("id", id.data)
    .select(CONSULTATION_COLUMNS)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to update consultation");
    res.status(502).json({ error: "No se pudo actualizar la consulta" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Consulta no encontrada" });
    return;
  }

  res.json(
    UpdateConsultationResponse.parse(rowToConsultation(data as unknown as ConsultationRow)),
  );
});

router.delete("/consultations/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.json(DeleteAllConsultationsResponse.parse({ deleted: 0 }));
    return;
  }

  const { data, error } = await supabase
    .from("consultations")
    .delete()
    .eq("id", id.data)
    .select("audio_path");

  if (error) {
    req.log.error({ err: error }, "Failed to delete consultation");
    res.status(502).json({ error: "No se pudo borrar la consulta" });
    return;
  }

  const rows = (data ?? []) as Array<{ audio_path: string | null }>;
  await removeRecordings(supabase, rows.map((r) => r.audio_path));

  res.json(DeleteAllConsultationsResponse.parse({ deleted: rows.length }));
});

router.get("/consultations/:id/audio", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Consulta no encontrada" });
    return;
  }

  const { data, error } = await supabase
    .from("consultations")
    .select("audio_path")
    .eq("id", id.data)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to read consultation audio path");
    res.status(502).json({ error: "No se pudo leer la consulta" });
    return;
  }

  const audioPath = (data as { audio_path: string | null } | null)?.audio_path;
  if (!audioPath) {
    res.status(404).json({ error: "Esta consulta no tiene audio guardado" });
    return;
  }

  const signed = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(audioPath, SIGNED_URL_TTL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) {
    req.log.error({ err: signed.error }, "Failed to sign recording URL");
    res.status(502).json({ error: "No se pudo generar el enlace al audio" });
    return;
  }

  res.json(
    GetConsultationAudioResponse.parse({
      url: signed.data.signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    }),
  );
});

export default router;
