import { useState, type FormEvent } from 'react';
import { Bug, Check, Lightbulb, Loader2, Plus, Trash2 } from 'lucide-react';
import { useFeedback, describeClient } from '@/hooks/use-feedback';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ResponsiveDialog } from '@/components/responsive-dialog';
import { cn } from '@/lib/utils';
import type { FeedbackItem } from '@workspace/api-client-react';

type Status = FeedbackItem['status'];
type Kind = FeedbackItem['kind'];

/** The statuses, in the order an item travels through them. */
const STATUSES: { value: Status; label: string; className: string }[] = [
  { value: 'open', label: 'Pendiente', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: 'in_progress', label: 'En curso', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { value: 'done', label: 'Resuelto', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  { value: 'discarded', label: 'Descartado', className: 'bg-muted text-muted-foreground' },
];

function statusMeta(status: Status) {
  return STATUSES.find((s) => s.value === status) ?? STATUSES[0]!;
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  return data?.error || fallback;
}

/**
 * Bugs and improvement requests, as a board the whole team shares.
 *
 * The statuses are the point: a physician who reports something wants to know
 * it was read and shipped, and without a state on the item the only way to
 * find out is to ask.
 */
export function FeedbackBoard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { items, query, create, setStatus, remove } = useFeedback();

  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<Kind>('bug');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const resetForm = () => {
    setKind('bug');
    setTitle('');
    setDetail('');
    setComposing(false);
  };

  const visible = items.filter((i) =>
    showResolved ? true : i.status === 'open' || i.status === 'in_progress',
  );
  const resolvedCount = items.length - items.filter(
    (i) => i.status === 'open' || i.status === 'in_progress',
  ).length;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || create.isPending) return;

    try {
      await create.mutateAsync({
        data: {
          kind,
          title: title.trim(),
          detail: detail.trim() || undefined,
          client: describeClient() || undefined,
        },
      });
      resetForm();
      toast({ title: 'Reporte enviado', description: 'Queda en el tablero como pendiente.' });
    } catch (err) {
      toast({
        title: 'No se pudo enviar el reporte',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  const handleStatus = async (item: FeedbackItem, status: Status) => {
    try {
      await setStatus.mutateAsync({ id: item.id, data: { status } });
    } catch (err) {
      toast({
        title: 'No se pudo cambiar el estado',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (item: FeedbackItem) => {
    try {
      await remove.mutateAsync({ id: item.id });
      toast({ title: 'Reporte borrado' });
    } catch (err) {
      toast({
        title: 'No se pudo borrar',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Errores y mejoras"
      description="Lo que reportes lo ve todo el equipo, y el estado se actualiza cuando se aplica."
    >
      <div className="space-y-4 pb-2">
        {composing ? (
          <form onSubmit={handleSubmit} className="space-y-3 bg-muted/30 p-3 rounded-lg border">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={kind === 'bug' ? 'default' : 'outline'}
                className="h-10"
                onClick={() => setKind('bug')}
              >
                <Bug className="w-4 h-4 mr-1.5" />
                Error
              </Button>
              <Button
                type="button"
                variant={kind === 'improvement' ? 'default' : 'outline'}
                className="h-10"
                onClick={() => setKind('improvement')}
              >
                <Lightbulb className="w-4 h-4 mr-1.5" />
                Mejora
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fb-title" className="text-xs">
                En una línea
              </Label>
              <Input
                id="fb-title"
                autoFocus
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'El botón de grabar no aparece en el celular'
                    : 'Poder duplicar una nota del día anterior'
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fb-detail" className="text-xs">
                Detalle (opcional)
              </Label>
              <Textarea
                id="fb-detail"
                rows={4}
                maxLength={4000}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'Qué estabas haciendo, qué esperabas que pasara y qué pasó.'
                    : 'Para qué te serviría y en qué momento la usarías.'
                }
              />
              <p className="text-[11px] text-muted-foreground leading-tight">
                No pongas datos de pacientes: esto lo lee todo el equipo. Se guarda también
                qué navegador y qué pantalla estás usando, para poder reproducir el problema.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={resetForm}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={!title.trim() || create.isPending}>
                {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enviar
              </Button>
            </div>
          </form>
        ) : (
          <Button className="w-full h-11" onClick={() => setComposing(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Reportar algo
          </Button>
        )}

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando el tablero...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Todavía no hay nada reportado. Si algo no funciona o se te ocurre una mejora,
            escribila acá y queda registrada.
          </p>
        ) : (
          <div className="space-y-2">
            {visible.map((item) => {
              const meta = statusMeta(item.status);
              return (
                <div key={item.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    {item.kind === 'bug' ? (
                      <Bug className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                    ) : (
                      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm font-medium leading-snug break-words',
                          (item.status === 'done' || item.status === 'discarded') &&
                            'line-through text-muted-foreground',
                        )}
                      >
                        {item.title}
                      </p>
                      {item.detail && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                          {item.detail}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        {item.authorName || 'Alguien'} ·{' '}
                        {new Date(item.createdAt).toLocaleDateString()}
                        {item.mine && ' · tuyo'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* The select is the status: it already shows the current
                        one, so a badge beside it only repeated the word. */}
                    <Select
                      value={item.status}
                      onValueChange={(v) => void handleStatus(item, v as Status)}
                    >
                      <SelectTrigger
                        className={cn('h-9 text-xs flex-1 border-0 font-medium', meta.className)}
                        aria-label={`Estado: ${meta.label}. Cambiar`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {item.mine && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Borrar este reporte"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDelete(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

            {resolvedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs text-muted-foreground"
                onClick={() => setShowResolved((v) => !v)}
              >
                <Check className="w-3.5 h-3.5 mr-1.5" />
                {showResolved
                  ? 'Ocultar los cerrados'
                  : `Ver ${resolvedCount} cerrado${resolvedCount > 1 ? 's' : ''}`}
              </Button>
            )}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}
