import { useQueryClient } from '@tanstack/react-query';
import {
  useListPatients,
  useCreatePatient,
  useUpdatePatient,
  useDeletePatient,
  type Patient,
} from '@workspace/api-client-react';

/** Both list keys start with their path, so one prefix invalidates every variant. */
const PATIENTS_KEY = ['/api/patients'] as const;
const CONSULTATIONS_KEY = ['/api/consultations'] as const;

/**
 * The physician's patients.
 *
 * Every mutation invalidates the consultation lists too: discharging or
 * deleting a patient changes which notes are on screen, and the note count
 * shown beside each patient comes from the same rows.
 */
export function usePatients(status: 'active' | 'discharged' | 'all' = 'active') {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: PATIENTS_KEY });
    void queryClient.invalidateQueries({ queryKey: CONSULTATIONS_KEY });
  };

  const query = useListPatients({ status });

  const create = useCreatePatient({ mutation: { onSuccess: invalidate } });
  const update = useUpdatePatient({ mutation: { onSuccess: invalidate } });
  const remove = useDeletePatient({ mutation: { onSuccess: invalidate } });

  const patients: Patient[] = query.data ?? [];

  return { patients, query, create, update, remove };
}

/** Whole days since admission, counted from the date the physician recorded. */
export function daysAdmitted(patient: Patient): number | null {
  if (!patient.admittedOn) return null;
  const [y, m, d] = patient.admittedOn.split('-').map(Number);
  if (!y || !m || !d) return null;
  // Built from the parts, not parsed as a string: "2026-09-14" parses as UTC
  // midnight, which reads as the day before anywhere west of Greenwich.
  const admitted = new Date(y, m - 1, d);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((midnight.getTime() - admitted.getTime()) / 86_400_000));
}

/** How the patient is named across the UI: initials, plus bed when known. */
export function patientLabel(patient: Patient): string {
  return patient.bed ? `${patient.initials} · ${patient.bed}` : patient.initials;
}
