import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { usePatients } from '@/hooks/use-patients';
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
import type { Patient } from '@workspace/api-client-react';

/** Matches the length the database enforces, so the limit is felt while typing. */
const MAX_INITIALS = 16;

type Sex = 'F' | 'M' | 'X';

/** Every field as a string, which is what an input actually holds. */
type FormState = {
  initials: string;
  bed: string;
  admittedOn: string;
  reason: string;
  ageYears: string;
  sex: Sex | '';
  weightKg: string;
  diagnosis: string;
  history: string;
  allergies: string;
  medications: string;
};

const EMPTY: FormState = {
  initials: '',
  bed: '',
  admittedOn: '',
  reason: '',
  ageYears: '',
  sex: '',
  weightKg: '',
  diagnosis: '',
  history: '',
  allergies: '',
  medications: '',
};

function fromPatient(patient: Patient): FormState {
  return {
    initials: patient.initials,
    bed: patient.bed ?? '',
    admittedOn: patient.admittedOn ?? '',
    reason: patient.reason ?? '',
    ageYears: patient.ageYears === null || patient.ageYears === undefined ? '' : String(patient.ageYears),
    sex: (patient.sex as Sex | null) ?? '',
    weightKg: patient.weightKg === null || patient.weightKg === undefined ? '' : String(patient.weightKg),
    diagnosis: patient.diagnosis ?? '',
    history: patient.history ?? '',
    allergies: patient.allergies ?? '',
    medications: patient.medications ?? '',
  };
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  return data?.error || fallback;
}

/** A number the API will accept, or undefined to leave the column alone. */
function numberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The patient's record: who they are, and what a physician needs to know before
 * writing about them.
 *
 * The clinical half exists to be read by the model, not only by a human. An
 * evolution note on day four is written by someone who already knows the age,
 * the comorbidities and the allergies — none of which anyone says out loud
 * during the visit, so none of which used to reach the note.
 */
export function PatientFormDialog({
  open,
  onOpenChange,
  patient,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent means this is a new admission. */
  patient?: Patient | null;
  onCreated?: (patient: Patient) => void;
}) {
  const { toast } = useToast();
  const { create, update } = usePatients('active');
  const [form, setForm] = useState<FormState>(EMPTY);

  const editing = Boolean(patient);
  const pending = create.isPending || update.isPending;

  // Reopening on another patient must not show the previous one's history.
  useEffect(() => {
    if (open) setForm(patient ? fromPatient(patient) : EMPTY);
  }, [open, patient]);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.initials.trim() || pending) return;

    // Sent on every save, empty string included: clearing a field has to be
    // able to clear the column, which a "skip the empties" rule would prevent.
    const data = {
      initials: form.initials.trim(),
      bed: form.bed.trim(),
      reason: form.reason.trim(),
      diagnosis: form.diagnosis.trim(),
      history: form.history.trim(),
      allergies: form.allergies.trim(),
      medications: form.medications.trim(),
      ageYears: numberOrUndefined(form.ageYears),
      weightKg: numberOrUndefined(form.weightKg),
      sex: form.sex || undefined,
      ...(form.admittedOn ? { admittedOn: form.admittedOn } : {}),
    };

    try {
      if (patient) {
        await update.mutateAsync({ id: patient.id, data });
        toast({ title: `Ficha de ${data.initials} actualizada` });
      } else {
        const created = await create.mutateAsync({ data });
        toast({ title: `${created.initials} agregado` });
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: editing ? 'No se pudo guardar la ficha' : 'No se pudo agregar el paciente',
        description: errorMessage(err, 'Reintentá en unos segundos'),
        variant: 'destructive',
      });
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Ficha de ${patient?.initials}` : 'Nuevo paciente'}
      description="Lo que cargues acá el sistema se lo pasa a la IA como antecedente al escribir cada nota."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Iniciales" htmlFor="p-initials" hint="El nombre completo va en la historia del hospital.">
            <Input
              id="p-initials"
              required
              autoFocus={!editing}
              maxLength={MAX_INITIALS}
              value={form.initials}
              onChange={(e) => set('initials')(e.target.value)}
              placeholder="J.P."
            />
          </Field>
          <Field label="Cama o habitación" htmlFor="p-bed">
            <Input
              id="p-bed"
              value={form.bed}
              onChange={(e) => set('bed')(e.target.value)}
              placeholder="302-A"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Edad" htmlFor="p-age">
            <Input
              id="p-age"
              inputMode="numeric"
              value={form.ageYears}
              onChange={(e) => set('ageYears')(e.target.value)}
              placeholder="72"
            />
          </Field>
          <Field label="Sexo" htmlFor="p-sex">
            <Select value={form.sex} onValueChange={(v) => set('sex')(v)}>
              <SelectTrigger id="p-sex">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {/* Abbreviated because the trigger is a third of a phone row:
                    "Masculino" rendered clipped mid-word. */}
                <SelectItem value="F">Fem.</SelectItem>
                <SelectItem value="M">Masc.</SelectItem>
                <SelectItem value="X">Otro</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Peso (kg)" htmlFor="p-weight">
            <Input
              id="p-weight"
              inputMode="decimal"
              value={form.weightKg}
              onChange={(e) => set('weightKg')(e.target.value)}
              placeholder="78"
            />
          </Field>
        </div>

        <Field label="Fecha de ingreso" htmlFor="p-admitted" hint={editing ? undefined : 'Si lo dejás vacío, se toma hoy.'}>
          <Input
            id="p-admitted"
            type="date"
            value={form.admittedOn}
            onChange={(e) => set('admittedOn')(e.target.value)}
          />
        </Field>

        <Field label="Motivo de internación" htmlFor="p-reason" hint="Lo que lo trajo.">
          <Input
            id="p-reason"
            value={form.reason}
            onChange={(e) => set('reason')(e.target.value)}
            placeholder="Dolor abdominal"
          />
        </Field>

        <Field label="Diagnóstico principal" htmlFor="p-diagnosis" hint="El problema que se está tratando hoy.">
          <Input
            id="p-diagnosis"
            value={form.diagnosis}
            onChange={(e) => set('diagnosis')(e.target.value)}
            placeholder="Colecistitis aguda litiásica"
          />
        </Field>

        <Field label="Antecedentes" htmlFor="p-history" hint="Comorbilidades, cirugías, hábitos.">
          <Textarea
            id="p-history"
            rows={3}
            value={form.history}
            onChange={(e) => set('history')(e.target.value)}
            placeholder="HTA, DBT2 en tratamiento, colecistectomía 2019, extabaquista"
          />
        </Field>

        <Field label="Alergias" htmlFor="p-allergies" hint="Se muestra siempre a la vista y llega a cada nota.">
          <Textarea
            id="p-allergies"
            rows={2}
            value={form.allergies}
            onChange={(e) => set('allergies')(e.target.value)}
            placeholder="Penicilina (rash). Sin otras conocidas."
          />
        </Field>

        <Field label="Medicación habitual" htmlFor="p-medications">
          <Textarea
            id="p-medications"
            rows={3}
            value={form.medications}
            onChange={(e) => set('medications')(e.target.value)}
            placeholder="Enalapril 10 mg/día, metformina 850 mg c/12 h"
          />
        </Field>

        <div className="flex gap-2 pt-2 sticky bottom-0 bg-background pb-1">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" disabled={pending || !form.initials.trim()}>
            {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editing ? 'Guardar' : 'Agregar'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground leading-tight">{hint}</p>}
    </div>
  );
}
