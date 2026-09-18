import type { SupabaseClient } from "@supabase/supabase-js";
import type { Patient } from "@workspace/api-zod";
import { removeRecordings } from "./consultations";

/** Shape of a `public.patients` row, in the database's snake_case. */
export type PatientRow = {
  id: string;
  initials: string;
  bed: string | null;
  admitted_on: string | null;
  reason: string | null;
  age_years: number | null;
  sex: string | null;
  // numeric(5,1) arrives as a string from PostgREST, not a number.
  weight_kg: string | number | null;
  diagnosis: string | null;
  history: string | null;
  allergies: string | null;
  medications: string | null;
  discharged_at: string | null;
  created_at: string;
  updated_at: string;
  // PostgREST returns an embedded aggregate as an array of one object.
  consultations?: Array<{ count: number }>;
};

export const PATIENT_COLUMNS =
  "id, initials, bed, admitted_on, reason, age_years, sex, weight_kg, diagnosis, " +
  "history, allergies, medications, discharged_at, created_at, updated_at, " +
  "consultations(count)";

/** Postgres `numeric` crosses PostgREST as a string to keep its precision. */
function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rowToPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    initials: row.initials,
    bed: row.bed,
    admittedOn: row.admitted_on,
    reason: row.reason,
    ageYears: row.age_years,
    sex: (row.sex as "F" | "M" | "X" | null) ?? null,
    weightKg: toNumber(row.weight_kg),
    diagnosis: row.diagnosis,
    history: row.history,
    allergies: row.allergies,
    medications: row.medications,
    dischargedAt: row.discharged_at ? new Date(row.discharged_at) : null,
    noteCount: row.consultations?.[0]?.count ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Delete a patient along with everything of theirs.
 *
 * The row cascade takes the consultations, but storage objects are outside
 * Postgres: without this the recordings would outlive the patient they belong
 * to, unreachable and undeletable through the app.
 */
export async function deletePatientCascade(
  supabase: SupabaseClient,
  patientId: string,
): Promise<number> {
  const { data: notes } = await supabase
    .from("consultations")
    .select("audio_path")
    .eq("patient_id", patientId);

  const { data, error } = await supabase
    .from("patients")
    .delete()
    .eq("id", patientId)
    .select("id");

  if (error) throw error;

  await removeRecordings(
    supabase,
    ((notes ?? []) as Array<{ audio_path: string | null }>).map((n) => n.audio_path),
  );

  return (data ?? []).length;
}

/** The clinical fields, as the physician may send them. */
export type ClinicalInput = {
  ageYears?: number;
  sex?: "F" | "M" | "X" | null;
  weightKg?: number;
  diagnosis?: string;
  history?: string;
  allergies?: string;
  medications?: string;
};

/**
 * Map the clinical fields onto their columns, for create and for update alike.
 *
 * Only keys the caller actually sent are returned, so a PATCH that touches the
 * bed does not blank out the allergies. An empty string means "clear it",
 * which is how a text field reads when the physician deletes its contents.
 */
export function clinicalPatch(input: ClinicalInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const text = (key: string, value: string | undefined) => {
    if (value !== undefined) patch[key] = value.trim() || null;
  };

  if (input.ageYears !== undefined) patch["age_years"] = input.ageYears;
  if (input.sex !== undefined) patch["sex"] = input.sex || null;
  if (input.weightKg !== undefined) patch["weight_kg"] = input.weightKg;
  text("diagnosis", input.diagnosis);
  text("history", input.history);
  text("allergies", input.allergies);
  text("medications", input.medications);

  return patch;
}

/**
 * The patient's clinical background, written for the model rather than a table.
 *
 * Returns null when nothing is recorded, so the caller can leave the prompt
 * untouched instead of sending a header with no facts under it.
 */
export function patientContext(patient: Patient): string | null {
  const lines: string[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim()) {
      lines.push(`- ${label}: ${String(value).trim()}`);
    }
  };

  add("Edad", patient.ageYears === null ? null : `${patient.ageYears} años`);
  add("Sexo", patient.sex === "F" ? "femenino" : patient.sex === "M" ? "masculino" : null);
  add("Peso", patient.weightKg === null ? null : `${patient.weightKg} kg`);
  add("Motivo de internación", patient.reason);
  add("Diagnóstico principal", patient.diagnosis);
  add("Antecedentes", patient.history);
  add("Alergias", patient.allergies);
  add("Medicación habitual", patient.medications);

  const day = daysAdmitted(patient);
  if (day !== null) add("Día de internación", day + 1);

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Whole days since admission. Parsed as a plain date: `admitted_on` has no
 * time, and reading it as a timestamp lands on midnight UTC, which west of
 * Greenwich reads as the day before.
 */
function daysAdmitted(patient: Patient): number | null {
  if (!patient.admittedOn) return null;
  const parts = patient.admittedOn.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts as [number, number, number];
  const admitted = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((today - admitted) / 86_400_000);
  return days >= 0 ? days : null;
}
