import type { SupabaseClient } from "@supabase/supabase-js";
import type { Consultation, NoteSection } from "@workspace/api-zod";
import { RECORDINGS_BUCKET } from "./supabase";

/** Shape of a `public.consultations` row, in the database's snake_case. */
export type ConsultationRow = {
  id: string;
  patient_ref: string | null;
  template: string;
  title: string;
  sections: NoteSection[];
  plain_text: string;
  anonymized: boolean;
  transcript: string | null;
  audio_path: string | null;
  audio_duration_seconds: number | string | null;
  patient_id: string | null;
  created_at: string;
  updated_at: string;
};

export const CONSULTATION_COLUMNS =
  "id, patient_ref, template, title, sections, plain_text, anonymized, " +
  "transcript, audio_path, audio_duration_seconds, patient_id, created_at, updated_at";

export function rowToConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    patientRef: row.patient_ref,
    template: row.template as Consultation["template"],
    title: row.title,
    sections: row.sections ?? [],
    plainText: row.plain_text,
    anonymized: row.anonymized,
    transcript: row.transcript,
    audioPath: row.audio_path,
    // `numeric` comes back as a string from postgres-js; normalise to a number.
    audioDurationSeconds:
      row.audio_duration_seconds === null ? null : Number(row.audio_duration_seconds),
    patientId: row.patient_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Storage rejects very large delete batches, so they go out in chunks. */
const REMOVE_BATCH_SIZE = 100;

/**
 * Remove recordings from the private bucket.
 *
 * Deleting a consultation row does not cascade into storage, so the object has
 * to go explicitly or the audio would outlive the note the physician deleted.
 * Storage RLS still applies: only the caller's own objects can be removed.
 */
export async function removeRecordings(
  supabase: SupabaseClient,
  paths: Array<string | null | undefined>,
): Promise<void> {
  const keys = paths.filter((p): p is string => Boolean(p));

  for (let i = 0; i < keys.length; i += REMOVE_BATCH_SIZE) {
    await supabase.storage
      .from(RECORDINGS_BUCKET)
      .remove(keys.slice(i, i + REMOVE_BATCH_SIZE));
  }
}
