import { useState, type FormEvent } from 'react';
import { BedDouble, Loader2, Plus, UserRound, X } from 'lucide-react';
import { usePatients, daysAdmitted } from '@/hooks/use-patients';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { Patient } from '@workspace/api-client-react';

/** Matches the length the database enforces, so the limit is felt while typing. */
const MAX_INITIALS = 16;

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  return data?.error || fallback;
}

function stay(patient: Patient): string {
  const days = daysAdmitted(patient);
  if (days === null) return '';
  if (days === 0) return 'ingresó hoy';
  return days === 1 ? '1 día internado' : `${days} días internado`;
}

/**
 * The ward round list: who is admitted, and who is open right now.
 *
 * Selecting a patient scopes recording and history to them; with nobody
 * selected the app behaves as it did before, for one-off consultations.
 */
export function PatientPanel({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (patient: Patient | null) => void;
}) {
  const { toast } = useToast();
  const { patients, query, create, remove } = usePatients('active');

  const [adding, setAdding] = useState(false);
  const [initials, setInitials] = useState('');
  const [bed, setBed] = useState('');
  const [reason, setReason] = useState('');

  const resetForm = () => {
    setInitials('');
    setBed('');
    setReason('');
    setAdding(false);
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!initials.trim() || create.isPending) return;

    try {
      const patient = await create.mutateAsync({
        data: {
          initials: initials.trim(),
          bed: bed.trim() || undefined,
          reason: reason.trim() || undefined,
        },
      });
      resetForm();
      onSelect(patient);
      toast({ title: `${patient.initials} agregado` });
    } catch (err) {
      toast({
        title: 'No se pudo agregar el paciente',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (patient: Patient) => {
    try {
      await remove.mutateAsync({ id: patient.id });
      if (selectedId === patient.id) onSelect(null);
      toast({ title: `${patient.initials} y sus notas fueron borrados` });
    } catch (err) {
      toast({
        title: 'No se pudo borrar el paciente',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm tracking-tight text-muted-foreground uppercase">
          Pacientes
        </h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4 mr-1" />}
          {adding ? '' : 'Agregar'}
        </Button>
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="space-y-2 bg-muted/30 p-3 rounded-lg border border-border/50">
          <div className="space-y-1">
            <Label htmlFor="p-initials" className="text-xs">
              Iniciales
            </Label>
            <Input
              id="p-initials"
              autoFocus
              required
              maxLength={MAX_INITIALS}
              value={initials}
              onChange={(e) => setInitials(e.target.value)}
              placeholder="J.P."
              className="h-8 text-xs bg-background"
            />
            <p className="text-[11px] text-muted-foreground leading-tight">
              Solo iniciales. El nombre completo va en la historia clínica del hospital.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-bed" className="text-xs">
              Cama o habitación
            </Label>
            <Input
              id="p-bed"
              value={bed}
              onChange={(e) => setBed(e.target.value)}
              placeholder="302-A"
              className="h-8 text-xs bg-background"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-reason" className="text-xs">
              Motivo de internación
            </Label>
            <Input
              id="p-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Dolor abdominal"
              className="h-8 text-xs bg-background"
            />
          </div>
          <Button type="submit" size="sm" className="w-full h-8 text-xs" disabled={create.isPending}>
            {create.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Agregar paciente
          </Button>
        </form>
      )}

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : patients.length === 0 ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No hay pacientes internados. Agregá uno para ir sumando sus visitas, o grabá sin
          paciente para una consulta suelta.
        </p>
      ) : (
        <div className="space-y-1.5">
          {patients.map((patient) => {
            const selected = patient.id === selectedId;
            return (
              <div
                key={patient.id}
                className={cn(
                  'flex items-start rounded-lg border transition-colors hover:bg-muted/50',
                  selected ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/20',
                )}
              >
                <button
                  onClick={() => onSelect(selected ? null : patient)}
                  className="flex-1 text-left p-2.5 min-w-0"
                >
                  <div className="flex items-center gap-1.5 font-medium text-sm">
                    <UserRound className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="truncate">{patient.initials}</span>
                    {patient.bed && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <BedDouble className="w-3 h-3" />
                        {patient.bed}
                      </span>
                    )}
                  </div>
                  {patient.reason && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {patient.reason}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2">
                    <span>{stay(patient)}</span>
                    <span>
                      {patient.noteCount === 1 ? '1 nota' : `${patient.noteCount ?? 0} notas`}
                    </span>
                  </div>
                </button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Borrar ${patient.initials}`}
                      className="h-7 w-7 m-2 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Borrar a {patient.initials}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminan también sus {patient.noteCount ?? 0} notas y las grabaciones.
                        No se puede deshacer. Si el paciente se va de alta, usá “Dar de alta” en
                        su lugar: eso conserva todo.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleDelete(patient)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Borrar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
