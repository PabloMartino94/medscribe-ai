import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  transcribeAudio,
  structureNote,
  createConsultation,
  type Consultation,
} from '@workspace/api-client-react';

/** Where a recording is in its trip from microphone to saved note. */
export type JobState = 'waiting' | 'transcribing' | 'writing' | 'saving' | 'done' | 'error';

export type QueueJob = {
  id: string;
  /** How the patient is named in the tray. Empty for a one-off consultation. */
  patientLabel: string;
  patientId?: string;
  templateId: string;
  templateName: string;
  seconds: number;
  state: JobState;
  error?: string;
  noteId?: string;
  noteTitle?: string;
};

/**
 * Everything the job needs, captured when the recording stopped.
 *
 * Snapshotting matters more than it looks: by the time this job runs, the
 * physician has walked to the next bed and changed the selected patient and
 * possibly the template. Reading those at run time would file the note on
 * whoever is on screen then.
 */
export type JobInput = {
  file: File;
  seconds: number;
  patientId?: string;
  patientLabel: string;
  templateId: string;
  templateName: string;
  anonymize: boolean;
  keepAudio: boolean;
  preferences: string[];
};

type InternalJob = QueueJob & { input: JobInput };

const CONSULTATIONS_KEY = ['/api/consultations'] as const;
const PATIENTS_KEY = ['/api/patients'] as const;

function newId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Recordings become notes in the background, one after another.
 *
 * On a ward round the physician records at the bedside and walks to the next
 * bed; waiting out a transcription and a structuring call at each door is most
 * of the visit. Stopping the recording hands the audio to this queue and frees
 * the microphone at once.
 *
 * Serial by design, not for simplicity: the AI provider's free tier is the
 * binding constraint, and firing four notes at once is how a ward round turns
 * into four quota errors.
 */
export function useNoteQueue({
  onNoteSaved,
}: {
  onNoteSaved?: (note: Consultation) => void;
} = {}) {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<QueueJob[]>([]);

  // The work itself lives in a ref: the loop must not restart when React
  // re-renders, and an audio blob has no business in render state.
  const queueRef = useRef<InternalJob[]>([]);
  const runningRef = useRef(false);
  const onNoteSavedRef = useRef(onNoteSaved);
  onNoteSavedRef.current = onNoteSaved;

  const publish = useCallback(() => {
    // Strip the payload; the tray only ever needs the description.
    setJobs(queueRef.current.map(({ input: _input, ...rest }) => ({ ...rest })));
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<QueueJob>) => {
      const job = queueRef.current.find((j) => j.id === id);
      if (!job) return;
      Object.assign(job, changes);
      publish();
    },
    [publish],
  );

  const runJob = useCallback(
    async (job: InternalJob) => {
      const { input } = job;

      patch(job.id, { state: 'transcribing', error: undefined });
      const transcription = await transcribeAudio({
        file: input.file,
        language: 'es',
        store: input.keepAudio ? 'true' : 'false',
      });

      if (!transcription.text.trim()) {
        throw new Error('No se detectó voz en el audio.');
      }

      patch(job.id, { state: 'writing' });
      const note = await structureNote({
        text: transcription.text,
        template: input.templateId as Parameters<typeof structureNote>[0]['template'],
        anonymize: input.anonymize,
        ...(input.preferences.length > 0 ? { preferences: input.preferences } : {}),
        ...(input.patientId ? { patientId: input.patientId } : {}),
      });

      patch(job.id, { state: 'saving' });
      const saved = await createConsultation({
        note,
        transcript: transcription.text,
        ...(input.patientId ? { patientId: input.patientId } : {}),
        ...(transcription.audioPath ? { audioPath: transcription.audioPath } : {}),
        ...(transcription.durationSeconds
          ? { audioDurationSeconds: transcription.durationSeconds }
          : {}),
      });

      patch(job.id, { state: 'done', noteId: saved.id, noteTitle: saved.title });
      void queryClient.invalidateQueries({ queryKey: CONSULTATIONS_KEY });
      // The patient list shows a note count per patient.
      void queryClient.invalidateQueries({ queryKey: PATIENTS_KEY });
      onNoteSavedRef.current?.(saved);
    },
    [patch, queryClient],
  );

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = queueRef.current.find((j) => j.state === 'waiting');
        if (!next) break;
        try {
          await runJob(next);
        } catch (err) {
          const data = (err as { data?: { error?: string } } | null)?.data;
          patch(next.id, {
            state: 'error',
            error: data?.error || (err as Error)?.message || 'Falló el procesamiento',
          });
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch, runJob]);

  const enqueue = useCallback(
    (input: JobInput) => {
      const job: InternalJob = {
        id: newId(),
        patientLabel: input.patientLabel,
        ...(input.patientId ? { patientId: input.patientId } : {}),
        templateId: input.templateId,
        templateName: input.templateName,
        seconds: input.seconds,
        state: 'waiting',
        input,
      };
      queueRef.current = [...queueRef.current, job];
      publish();
      void pump();
      return job.id;
    },
    [publish, pump],
  );

  const retry = useCallback(
    (id: string) => {
      patch(id, { state: 'waiting', error: undefined });
      void pump();
    },
    [patch, pump],
  );

  /** Forget a job. Only offered for ones that finished or failed. */
  const dismiss = useCallback(
    (id: string) => {
      queueRef.current = queueRef.current.filter(
        (j) => j.id !== id || (j.state !== 'done' && j.state !== 'error'),
      );
      publish();
    },
    [publish],
  );

  const clearFinished = useCallback(() => {
    queueRef.current = queueRef.current.filter((j) => j.state !== 'done');
    publish();
  }, [publish]);

  const active = jobs.filter((j) => j.state !== 'done' && j.state !== 'error');
  const failed = jobs.filter((j) => j.state === 'error');

  // A queued recording only exists in this tab: it was never uploaded, so
  // closing the tab loses the encounter with no way to recover it.
  useEffect(() => {
    if (active.length === 0 && failed.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active.length, failed.length]);

  return { jobs, active, failed, enqueue, retry, dismiss, clearFinished };
}

/** What the tray says a job is doing right now. */
export function jobStateLabel(state: JobState): string {
  switch (state) {
    case 'waiting':
      return 'En espera';
    case 'transcribing':
      return 'Transcribiendo';
    case 'writing':
      return 'Redactando';
    case 'saving':
      return 'Guardando';
    case 'done':
      return 'Lista';
    case 'error':
      return 'Falló';
  }
}
