import { useState } from 'react';
import { BedDouble, Pencil, Plus, TriangleAlert, UserRound, X } from 'lucide-react';
import { usePatients, daysAdmitted } from '@/hooks/use-patients';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
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
import { PatientFormDialog } from '@/components/patient-form';
import { cn } from '@/lib/utils';
import type { Patient } from '@workspace/api-client-react';

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
  const { patients, query, remove } = usePatients('active');

  // Null means "new patient"; a patient means "edit that record".
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (patient: Patient) => {
    setEditing(patient);
    setFormOpen(true);
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
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={openNew}>
          <Plus className="w-4 h-4 mr-1" />
          Agregar
        </Button>
      </div>

      <PatientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        patient={editing}
        onCreated={onSelect}
      />

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
                    {patient.allergies && (
                      <TriangleAlert
                        className="w-3.5 h-3.5 shrink-0 text-destructive"
                        aria-label="Tiene alergias registradas"
                      />
                    )}
                  </div>
                  {(patient.diagnosis || patient.reason) && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {patient.diagnosis || patient.reason}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2">
                    <span>{stay(patient)}</span>
                    <span>
                      {patient.noteCount === 1 ? '1 nota' : `${patient.noteCount ?? 0} notas`}
                    </span>
                  </div>
                </button>

                <div className="flex flex-col p-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar la ficha de ${patient.initials}`}
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    onClick={() => openEdit(patient)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Borrar ${patient.initials}`}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
