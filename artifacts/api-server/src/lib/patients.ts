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
  discharged_at: string | null;
  created_at: string;
  updated_at: string;
  // PostgREST returns an embedded aggregate as an array of one object.
  consultations?: Array<{ count: number }>;
};

export const PATIENT_COLUMNS =
  "id, initials, bed, admitted_on, reason, discharged_at, created_at, updated_at, " +
  "consultations(count)";

export function rowToPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    initials: row.initials,
    bed: row.bed,
    admittedOn: row.admitted_on,
    reason: row.reason,
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
