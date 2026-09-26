import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, RotateCw, X } from 'lucide-react';
import { jobStateLabel, type QueueJob } from '@/hooks/use-note-queue';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * What the queue is doing, without taking the screen away from recording.
 *
 * Collapsed it is one line, because during a ward round the answer to "is it
 * working?" is a count and a spinner. It expands for the two cases where the
 * detail matters: something failed, or a note is ready to open.
 */
export function NoteQueueTray({
  jobs,
  onOpenNote,
  onRetry,
  onDismiss,
  onClearFinished,
}: {
  jobs: QueueJob[];
  onOpenNote: (noteId: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearFinished: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (jobs.length === 0) return null;

  const working = jobs.filter((j) => j.state !== 'done' && j.state !== 'error').length;
  const failed = jobs.filter((j) => j.state === 'error').length;
  const done = jobs.filter((j) => j.state === 'done').length;

  const summary = [
    working > 0 ? `${working} en proceso` : null,
    done > 0 ? `${done} lista${done > 1 ? 's' : ''}` : null,
    failed > 0 ? `${failed} con error` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="border-t bg-card/60 backdrop-blur">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 sm:px-4 md:px-8 py-2 text-left"
      >
        {working > 0 ? (
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
        ) : failed > 0 ? (
          <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
        ) : (
          <Check className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className="text-xs font-medium min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown
          className={cn('w-4 h-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <div className="px-3 sm:px-4 md:px-8 pb-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs',
                job.state === 'error'
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-border/50 bg-background/60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {job.patientLabel || 'Consulta suelta'}
                  <span className="font-normal text-muted-foreground"> · {job.templateName}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {job.state === 'error'
                    ? job.error
                    : job.state === 'done'
                      ? job.noteTitle || 'Nota guardada'
                      : `${jobStateLabel(job.state)}...`}
                </div>
              </div>

              {job.state === 'done' && job.noteId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={() => onOpenNote(job.noteId!)}
                >
                  Abrir
                </Button>
              )}

              {job.state === 'error' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={() => onRetry(job.id)}
                >
                  <RotateCw className="w-3.5 h-3.5 mr-1" />
                  Reintentar
                </Button>
              )}

              {(job.state === 'done' || job.state === 'error') && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Quitar de la lista"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  onClick={() => onDismiss(job.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}

              {job.state !== 'done' && job.state !== 'error' && (
                <Loader2
                  className={cn(
                    'w-4 h-4 shrink-0 text-muted-foreground',
                    job.state !== 'waiting' && 'animate-spin',
                  )}
                />
              )}
            </div>
          ))}

          {done > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-8 text-xs text-muted-foreground"
              onClick={onClearFinished}
            >
              Quitar las {done > 1 ? 'listas' : 'lista'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
