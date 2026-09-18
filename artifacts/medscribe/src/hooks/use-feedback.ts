import { useQueryClient } from '@tanstack/react-query';
import {
  useListFeedback,
  useCreateFeedback,
  useUpdateFeedbackStatus,
  useDeleteFeedback,
  type FeedbackItem,
} from '@workspace/api-client-react';

/** Every list variant starts with the path, so one prefix invalidates them all. */
const FEEDBACK_KEY = ['/api/feedback'] as const;

/**
 * The shared board of bugs and improvement requests.
 *
 * Shared on purpose: everyone sees everyone's reports and anyone can move an
 * item's status, so an already-reported bug is visible before it is reported
 * twice and shipped fixes can be marked done by whoever notices.
 */
export function useFeedback() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: FEEDBACK_KEY });
  };

  const query = useListFeedback({ status: 'all' });

  const create = useCreateFeedback({ mutation: { onSuccess: invalidate } });
  const setStatus = useUpdateFeedbackStatus({ mutation: { onSuccess: invalidate } });
  const remove = useDeleteFeedback({ mutation: { onSuccess: invalidate } });

  const items: FeedbackItem[] = query.data ?? [];
  const openCount = items.filter(
    (i) => i.status === 'open' || i.status === 'in_progress',
  ).length;

  return { items, openCount, query, create, setStatus, remove };
}

/**
 * A short description of the browser and device.
 *
 * "Se ve mal en mi celular" is unfixable without knowing which phone, and the
 * person reporting it should not have to know how to find out.
 */
export function describeClient(): string {
  if (typeof navigator === 'undefined') return '';
  const size =
    typeof window === 'undefined' ? '' : ` · ${window.innerWidth}x${window.innerHeight}`;
  return `${navigator.userAgent}${size}`.slice(0, 300);
}
