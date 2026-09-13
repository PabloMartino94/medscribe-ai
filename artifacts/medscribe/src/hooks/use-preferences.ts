import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetPreferences,
  useSetPreferences,
  getGetPreferencesQueryKey,
} from '@workspace/api-client-react';

/**
 * Standing style preferences, stored on the physician's profile so they follow
 * them across devices instead of living in one browser's localStorage.
 */
export function usePreferences() {
  const queryClient = useQueryClient();
  const key = getGetPreferencesQueryKey();

  const query = useGetPreferences();
  const preferences = query.data?.preferences ?? [];

  const mutation = useSetPreferences({
    mutation: {
      onSuccess: (data) => {
        // Write the server's answer straight into the cache: the list is small
        // and this keeps the settings panel from flickering after a save.
        queryClient.setQueryData(key, data);
      },
    },
  });

  const save = useCallback(
    (next: string[]) => mutation.mutateAsync({ data: { preferences: next } }),
    [mutation],
  );

  const addPreference = useCallback(
    (pref: string) => {
      const trimmed = pref.trim();
      if (!trimmed || preferences.includes(trimmed)) return Promise.resolve(null);
      return save([...preferences, trimmed]);
    },
    [preferences, save],
  );

  const removePreference = useCallback(
    (pref: string) => save(preferences.filter((p) => p !== pref)),
    [preferences, save],
  );

  return { preferences, addPreference, removePreference, save, isSaving: mutation.isPending };
}
