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
export function useConsultations(enabled: boolean) {
  const queryClient = useQueryClient();
  const listKey = getListConsultationsQueryKey();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const query = useListConsultations(undefined, { query: { enabled } });

  const create = useCreateConsultation({ mutation: { onSuccess: invalidate } });
  const update = useUpdateConsultation({ mutation: { onSuccess: invalidate } });
  const remove = useDeleteConsultation({ mutation: { onSuccess: invalidate } });
  const removeAll = useDeleteAllConsultations({ mutation: { onSuccess: invalidate } });

  const consultations: Consultation[] = query.data ?? [];

  return { consultations, query, create, update, remove, removeAll };
}
