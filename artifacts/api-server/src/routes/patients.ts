import { Router, type IRouter } from "express";
import {
  CreatePatientBody,
  CreatePatientResponse,
  DeletePatientResponse,
  GetPatientResponse,
  ListPatientsQueryParams,
  ListPatientsResponse,
  UpdatePatientBody,
  UpdatePatientResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { authed, requireAuth } from "../middlewares/auth";
import {
  deletePatientCascade,
  PATIENT_COLUMNS,
  rowToPatient,
  type PatientRow,
} from "../lib/patients";

const router: IRouter = Router();

const Uuid = z.string().uuid();

router.use("/patients", requireAuth);

router.get("/patients", async (req, res) => {
  const { supabase } = authed(req);

  const params = ListPatientsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "Parámetros de consulta inválidos" });
    return;
  }

  let query = supabase.from("patients").select(PATIENT_COLUMNS);

  // "Still admitted" is the default because it is the ward round view.
  if (params.data.status === "active") query = query.is("discharged_at", null);
  else if (params.data.status === "discharged") query = query.not("discharged_at", "is", null);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    req.log.error({ err: error }, "Failed to list patients");
    res.status(502).json({ error: "No se pudo leer la lista de pacientes" });
    return;
  }

  res.json(
    ListPatientsResponse.parse((data as unknown as PatientRow[]).map(rowToPatient)),
  );
});

router.post("/patients", async (req, res) => {
  const { user, supabase } = authed(req);

  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos: se requieren las iniciales" });
    return;
  }
  const { initials, bed, admittedOn, reason } = parsed.data;

  const { data, error } = await supabase
    .from("patients")
    .insert({
      user_id: user.id,
      initials: initials.trim(),
      bed: bed?.trim() || null,
      // Defaults to today: a patient is almost always added on admission.
      admitted_on: admittedOn ?? new Date().toISOString().slice(0, 10),
      reason: reason?.trim() || null,
    })
    .select(PATIENT_COLUMNS)
    .single();

  if (error || !data) {
    req.log.error({ err: error }, "Failed to create patient");
    res.status(502).json({ error: "No se pudo agregar el paciente" });
    return;
  }

  res.status(201).json(CreatePatientResponse.parse(rowToPatient(data as unknown as PatientRow)));
});

router.get("/patients/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Paciente no encontrado" });
    return;
  }

  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_COLUMNS)
    .eq("id", id.data)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to read patient");
    res.status(502).json({ error: "No se pudo leer el paciente" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Paciente no encontrado" });
    return;
  }

  res.json(GetPatientResponse.parse(rowToPatient(data as unknown as PatientRow)));
});

router.patch("/patients/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Paciente no encontrado" });
    return;
  }

  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const { initials, bed, admittedOn, reason, discharged } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (initials !== undefined) patch["initials"] = initials.trim();
  if (bed !== undefined) patch["bed"] = bed.trim() || null;
  if (admittedOn !== undefined) patch["admitted_on"] = admittedOn;
  if (reason !== undefined) patch["reason"] = reason.trim() || null;
  // Discharge is a timestamp rather than a flag, so the ward round list is a
  // plain "where discharged_at is null" and the date stays on the record.
  if (discharged !== undefined) {
    patch["discharged_at"] = discharged ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No hay cambios para aplicar" });
    return;
  }

  const { data, error } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", id.data)
    .select(PATIENT_COLUMNS)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to update patient");
    res.status(502).json({ error: "No se pudo actualizar el paciente" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Paciente no encontrado" });
    return;
  }

  res.json(UpdatePatientResponse.parse(rowToPatient(data as unknown as PatientRow)));
});

router.delete("/patients/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.json(DeletePatientResponse.parse({ deleted: 0 }));
    return;
  }

  try {
    const deleted = await deletePatientCascade(supabase, id.data);
    res.json(DeletePatientResponse.parse({ deleted }));
  } catch (err) {
    req.log.error({ err }, "Failed to delete patient");
    res.status(502).json({ error: "No se pudo borrar el paciente" });
  }
});

export default router;
