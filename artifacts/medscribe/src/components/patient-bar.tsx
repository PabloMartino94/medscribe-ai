import { useState } from 'react';
import { BedDouble, Loader2, LogOut, Pencil, TriangleAlert, UserRound, X } from 'lucide-react';
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
import type { Patient } from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  return data?.error || fallback;
}

/**
 * Says who the app is currently writing about.
 *
 * Without it there is nothing on screen distinguishing "this note is going into
 * J.P.'s record" from a one-off consultation, which is the kind of ambiguity
 * that puts a note on the wrong patient.
 *
 * Allergies get their own red line rather than living inside the record: they
 * are the one fact whose cost of being out of sight is measured in harm, and
 * this bar is the only thing on screen the whole time a note is being written.
 */
export function PatientBar({
  patient,
  onClear,
}: {
  patient: Patient;
  onClear: () => void;
}) {
  const { toast } = useToast();
  const { update } = usePatients('active');
  const [formOpen, setFormOpen] = useState(false);

  const days = daysAdmitted(patient);

  const handleDischarge = async () => {
    try {
      await update.mutateAsync({ id: patient.id, data: { discharged: true } });
      onClear();
      toast({
        title: `${patient.initials} fue dado de alta`,
        description: 'Sale de la lista de internados. Las notas se conservan.',
      });
    } catch (err) {
      toast({
        title: 'No se pudo dar el alta',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  const subtitle = [
    patient.ageYears ? `${patient.ageYears} a.` : null,
    patient.sex === 'F' ? 'F' : patient.sex === 'M' ? 'M' : null,
    patient.diagnosis || patient.reason,
    days === null ? null : days === 0 ? 'ingresó hoy' : `día ${days + 1}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="border-b bg-primary/5">
      <PatientFormDialog open={formOpen} onOpenChange={setFormOpen} patient={patient} />

      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-8 py-2">
        <div className="bg-primary/10 p-1.5 rounded-md text-primary shrink-0">
          <UserRound className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{patient.initials}</span>
            {patient.bed && (
              <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground shrink-0">
                <BedDouble className="w-3 h-3" />
                {patient.bed}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Ver y editar la ficha del paciente"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          onClick={() => setFormOpen(true)}
        >
          <Pencil className="w-4 h-4" />
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label="Dar de alta"
              className="h-9 px-2.5 sm:px-3 text-xs shrink-0 bg-background"
            >
              {update.isPending ? (
                <Loader2 className="w-4 h-4 sm:mr-1.5 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4 sm:mr-1.5" />
              )}
              <span className="hidden sm:inline">Dar de alta</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Dar de alta a {patient.initials}?</AlertDialogTitle>
              <AlertDialogDescription>
                Sale de la lista de internados. Sus notas y grabaciones se conservan, y podés
                volver a internarlo más adelante.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleDischarge()}>
                Dar de alta
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Salir del paciente"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          onClick={onClear}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {patient.allergies && (
        <div className="flex items-start gap-1.5 px-3 sm:px-4 md:px-8 pb-2 -mt-0.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-destructive mt-[1px]" />
          <p className="text-[11px] font-medium text-destructive leading-tight min-w-0">
            Alergias: {patient.allergies}
          </p>
        </div>
      )}
    </div>
  );
}
