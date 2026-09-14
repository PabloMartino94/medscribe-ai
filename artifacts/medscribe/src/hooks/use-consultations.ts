import { useQueryClient } from '@tanstack/react-query';
import {
  useListConsultations,
  useCreateConsultation,
  useUpdateConsultation,
  useDeleteConsultation,
  useDeleteAllConsultations,
  getListConsultationsQueryKey,
  type Consultation,
} from '@workspace/api-client-react';

/**
 * Server-backed consultation history.
 *
 * Every mutation invalidates the list so the sidebar and the open note stay in
 * step without each caller having to remember to refetch.
 */
export function useConsultations(patientId?: string) {
  const queryClient = useQueryClient();

  // Invalidate by path prefix: the key carries the query params, so a fixed key
  // would only ever refresh the one patient currently on screen.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey().slice(0, 1) });

  const query = useListConsultations(patientId ? { patientId } : undefined);

  const create = useCreateConsultation({ mutation: { onSuccess: invalidate } });
  const update = useUpdateConsultation({ mutation: { onSuccess: invalidate } });
  const remove = useDeleteConsultation({ mutation: { onSuccess: invalidate } });
  const removeAll = useDeleteAllConsultations({ mutation: { onSuccess: invalidate } });

  const consultations: Consultation[] = query.data ?? [];

  return { consultations, query, create, update, remove, removeAll };
}
