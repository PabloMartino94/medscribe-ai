import { useState, useRef, useEffect } from "react";

type RefineScope = "note" | "global";
import { Mic, Square, Loader2, Pause, Play, Settings2, Trash2, FileAudio, Stethoscope, Send, X, LogOut } from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePreferences } from "@/hooks/use-preferences";
import { useConsultations } from "@/hooks/use-consultations";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import {
  useListTemplates,
  useAnonymizeText,
  useStructureNote,
  useTranscribeAudio,
  useRefineNote,
  type Consultation,
  type Patient,
  type StructuredNote,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Drawer, DrawerContent, DrawerTrigger, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { CopyButton } from "@/components/copy-button";
import { PatientPanel } from "@/components/patient-panel";
import { PatientBar } from "@/components/patient-bar";
import { RecordingPlayer } from "@/components/recording-player";
import { useTheme } from "@/components/theme-provider";

/** Projects a stored consultation back into the shape the AI endpoints expect. */
function toStructuredNote(c: Consultation): StructuredNote {
  return {
    template: c.template,
    title: c.title,
    sections: c.sections,
    plainText: c.plainText,
    anonymized: c.anonymized,
    processedAt: c.createdAt,
  };
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  return data?.error || fallback;
}

export default function Home() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { email, signOut } = useAuth();

  // State
  const [text, setText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useLocalStorage<string>("medscribe-template", "soap");
  const [autoAnonymize, setAutoAnonymize] = useLocalStorage<boolean>("medscribe-anonymize", false);
  const [keepAudio, setKeepAudio] = useLocalStorage<boolean>("medscribe-keep-audio", true);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [currentNote, setCurrentNote] = useState<Consultation | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentNoteIdRef.current = currentNote?.id ?? null;
  }, [currentNote]);

  // Recording captured by the last transcription, attached to the next note saved.
  const pendingAudioRef = useRef<{ audioPath?: string; durationSeconds?: number }>({});

  // Server-backed history and standing preferences. With a patient selected the
  // history is that patient's timeline instead of everything.
  const { consultations, create, update, remove, removeAll } = useConsultations(
    selectedPatient?.id,
  );
  const { preferences, addPreference, removePreference } = usePreferences();

  // Refinement chat
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant', text: string }[]>([]);
  const [refineInput, setRefineInput] = useState("");
  const [refineScope, setRefineScope] = useLocalStorage<RefineScope>("medscribe_refine_scope", "note");
  const [newPrefInput, setNewPrefInput] = useState("");

  // File Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // API Hooks
  const { data: templates = [] } = useListTemplates();

  const anonymizeMutation = useAnonymizeText({
    mutation: {
      onSuccess: (data) => {
        setText(data.text);
        toast({ title: `Anonimizado completado`, description: `Se ocultaron ${data.replacements} identificadores.` });
      },
      onError: (err) => {
        toast({ title: "Error al anonimizar", description: errorMessage(err, "Ocurrió un error inesperado"), variant: "destructive" });
      }
    }
  });

  const structureMutation = useStructureNote({
    mutation: {
      onSuccess: async (note) => {
        const pendingAudio = pendingAudioRef.current;
        pendingAudioRef.current = {};
        try {
          const saved = await create.mutateAsync({
            data: {
              note,
              transcript: text.trim() || undefined,
              ...(selectedPatient ? { patientId: selectedPatient.id } : {}),
              ...(pendingAudio.audioPath ? { audioPath: pendingAudio.audioPath } : {}),
              ...(pendingAudio.durationSeconds ? { audioDurationSeconds: pendingAudio.durationSeconds } : {}),
            },
          });
          setCurrentNote(saved);
          setChatMessages([]);
          toast({ title: "Nota estructurada y guardada" });
        } catch (err) {
          toast({ title: "La nota se generó pero no se pudo guardar", description: errorMessage(err, "Reintentá en unos segundos"), variant: "destructive" });
        }
      },
      onError: (err) => {
        toast({ title: "Error al estructurar", description: errorMessage(err, "Ocurrió un error inesperado"), variant: "destructive" });
      }
    }
  });

  // Binds each in-flight refinement to the note it was requested for, so a late
  // response never overwrites a different note the user switched to meanwhile.
  const pendingRefineRef = useRef<{ noteId: string; scope: RefineScope } | null>(null);

  const refineMutation = useRefineNote({
    mutation: {
      onSuccess: async (note) => {
        const pending = pendingRefineRef.current;
        pendingRefineRef.current = null;
        if (!pending) return;

        let updated: Consultation;
        try {
          updated = await update.mutateAsync({ id: pending.noteId, data: { note } });
        } catch (err) {
          toast({ title: "No se pudo guardar el cambio", description: errorMessage(err, "Reintentá en unos segundos"), variant: "destructive" });
          return;
        }

        setCurrentNote((prev) => (prev && prev.id === pending.noteId ? updated : prev));
        if (currentNoteIdRef.current !== pending.noteId) {
          toast({ title: "Cambio aplicado a la nota anterior", description: "Se actualizó en el historial." });
          return;
        }

        if (pending.scope === 'global') {
          setChatMessages(prev => [...prev, { role: 'assistant', text: "Guardado como preferencia permanente y aplicado a esta nota." }]);
        } else {
          setChatMessages(prev => [...prev, { role: 'assistant', text: "Listo, apliqué el cambio." }]);
        }
        setRefineInput("");
      },
      onError: (err) => {
        pendingRefineRef.current = null;
        toast({ title: "Error al refinar", description: errorMessage(err, "Ocurrió un error inesperado"), variant: "destructive" });
      }
    }
  });

  // Regenerating an existing note into another template. Separate from the
  // mutation above because its result is saved differently: it carries the
  // original transcript but never the recording.
  const regenerateSourceRef = useRef<string | null>(null);

  const regenerateMutation = useStructureNote({
    mutation: {
      onSuccess: async (note) => {
        const transcript = regenerateSourceRef.current;
        regenerateSourceRef.current = null;
        try {
          const saved = await create.mutateAsync({
            data: {
              note,
              ...(transcript ? { transcript } : {}),
              ...(selectedPatient ? { patientId: selectedPatient.id } : {}),
              // The recording stays with the note it was made for: two rows
              // pointing at one object would delete each other's audio.
            },
          });
          setCurrentNote(saved);
          setChatMessages([]);
          const name = templates.find((t) => t.id === saved.template)?.name ?? saved.template;
          toast({ title: `Nota regenerada como ${name}` });
        } catch (err) {
          toast({ title: "La nota se generó pero no se pudo guardar", description: errorMessage(err, "Reintentá en unos segundos"), variant: "destructive" });
        }
      },
      onError: (err) => {
        regenerateSourceRef.current = null;
        toast({ title: "Error al regenerar", description: errorMessage(err, "Ocurrió un error inesperado"), variant: "destructive" });
      }
    }
  });

  const transcribeMutation = useTranscribeAudio({
    mutation: {
      onSuccess: (data) => {
        pendingAudioRef.current = {
          ...(data.audioPath ? { audioPath: data.audioPath } : {}),
          ...(data.durationSeconds ? { durationSeconds: data.durationSeconds } : {}),
        };
        setIsUploading(false);

        // An empty transcript is a successful request with nothing in it. Say
        // so: appending "" left the screen unchanged and looked like a freeze.
        if (!data.text.trim()) {
          toast({
            title: "No se detectó voz en el audio",
            description: "Revisá el micrófono y volvé a intentar.",
            variant: "destructive",
          });
          return;
        }

        setText((prev) => (prev ? prev + "\n\n" + data.text : data.text));
        toast({ title: "Transcripción completada", description: `Duración: ${Math.round(data.durationSeconds)}s` });
      },
      onError: (err) => {
        toast({ title: "Error de transcripción", description: errorMessage(err, "Ocurrió un error al procesar el audio"), variant: "destructive" });
        setIsUploading(false);
      }
    }
  });

  // Audio Recorder
  const {
    isRecording,
    isPaused,
    timerSeconds,
    startRecording,
    pauseRecording,
    stopRecording,
    error: recorderError
  } = useAudioRecorder();

  useEffect(() => {
    if (recorderError) {
      toast({ title: "Error de micrófono", description: recorderError, variant: "destructive" });
    }
  }, [recorderError, toast]);

  // Actions
  const handleStopRecording = async () => {
    try {
      const blob = await stopRecording();
      const file = new File([blob], "grabacion.webm", { type: blob.type });
      transcribeMutation.mutate({ data: { file, language: "es", store: keepAudio ? "true" : "false" } });
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    transcribeMutation.mutate({ data: { file, language: "es", store: keepAudio ? "true" : "false" } });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleProcess = () => {
    if (!text.trim()) {
      toast({ title: "El texto está vacío", variant: "destructive" });
      return;
    }
    structureMutation.mutate({
      data: {
        text,
        template: selectedTemplateId as Consultation["template"],
        anonymize: autoAnonymize,
        preferences: preferences.length > 0 ? preferences : undefined,
      }
    });
  };

  const handleRefine = () => {
    if (!refineInput.trim() || !currentNote || refineMutation.isPending) return;

    const instruction = refineInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: instruction }]);

    pendingRefineRef.current = { noteId: currentNote.id, scope: refineScope };
    const note = toStructuredNote(currentNote);

    if (refineScope === 'global') {
      void addPreference(instruction);
      refineMutation.mutate({
        data: { note, instruction, preferences: [...preferences, instruction] }
      });
    } else {
      refineMutation.mutate({
        data: { note, instruction, preferences: preferences.length > 0 ? preferences : undefined }
      });
    }
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);

    // With no note open the picker just chooses the format of the next one.
    if (!currentNote || id === currentNote.template || regenerateMutation.isPending) return;

    const transcript = currentNote.transcript?.trim();
    if (!transcript) {
      toast({
        title: "Esta nota no se puede regenerar",
        description: "No tiene guardada la transcripción de origen.",
        variant: "destructive",
      });
      return;
    }

    regenerateSourceRef.current = transcript;
    regenerateMutation.mutate({
      data: {
        text: transcript,
        template: id as Consultation["template"],
        anonymize: currentNote.anonymized,
        preferences: preferences.length > 0 ? preferences : undefined,
      },
    });
  };

  const handleAnonymizeNow = () => {
    if (!text.trim()) return;
    anonymizeMutation.mutate({ data: { text } });
  };

  const clearAllHistory = async () => {
    try {
      const { deleted } = await removeAll.mutateAsync();
      setCurrentNote(null);
      setChatMessages([]);
      toast({ title: `Se borraron ${deleted} consultas` });
    } catch (err) {
      toast({ title: "No se pudo borrar el historial", description: errorMessage(err, "Reintentá en unos segundos"), variant: "destructive" });
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await remove.mutateAsync({ id });
      setCurrentNote((prev) => (prev && prev.id === id ? null : prev));
      toast({ title: "Consulta borrada" });
    } catch (err) {
      toast({ title: "No se pudo borrar la consulta", description: errorMessage(err, "Reintentá en unos segundos"), variant: "destructive" });
    }
  };

  const selectPatient = (patient: Patient | null) => {
    setSelectedPatient(patient);
    // The open note belongs to whoever was selected before; leaving it on
    // screen under a new patient's header is how notes end up misattributed.
    setCurrentNote(null);
    setChatMessages([]);
    setText("");
    pendingAudioRef.current = {};
  };

  const loadHistoryNote = (note: Consultation) => {
    setCurrentNote(note);
    // Raw setter on purpose: opening a note must not regenerate it.
    setSelectedTemplateId(note.template);
    setChatMessages([]);
    toast({ title: "Nota cargada desde el historial" });
  };

  // Sub-components
  const renderSettingsPanel = () => (
    <div className="space-y-6">
      <PatientPanel selectedId={selectedPatient?.id ?? null} onSelect={selectPatient} />

      <div className="space-y-4 pt-2 border-t">
        <h4 className="font-semibold text-sm tracking-tight text-muted-foreground uppercase">Ajustes</h4>

        <div className="flex items-center justify-between">
          <Label htmlFor="theme-toggle" className="cursor-pointer">Modo oscuro</Label>
          <Switch
            id="theme-toggle"
            checked={theme === "dark"}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-4">
            <Label htmlFor="auto-anon" className="cursor-pointer">Anonimizar siempre</Label>
            <p className="text-[11px] text-muted-foreground leading-tight mt-1">Ocultar datos sensibles antes de enviarlos a la IA</p>
          </div>
          <Switch
            id="auto-anon"
            checked={autoAnonymize}
            onCheckedChange={setAutoAnonymize}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-4">
            <Label htmlFor="keep-audio" className="cursor-pointer">Guardar el audio</Label>
            <p className="text-[11px] text-muted-foreground leading-tight mt-1">Conservar la grabación junto a la consulta</p>
          </div>
          <Switch
            id="keep-audio"
            checked={keepAudio}
            onCheckedChange={setKeepAudio}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="font-semibold text-sm tracking-tight text-muted-foreground uppercase">Preferencias permanentes</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Se aplican a todas las notas que generes, desde cualquier dispositivo.
        </p>

        {preferences.length > 0 && (
          <div className="space-y-2">
            {preferences.map((pref) => (
              <div key={pref} className="flex items-start justify-between bg-muted/30 p-2.5 rounded-md text-sm border border-border/50 gap-2">
                <span className="flex-1 leading-snug">{pref}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0 -mt-1 -mr-1" onClick={() => void removePreference(pref)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="Agregar preferencia..."
            value={newPrefInput}
            onChange={e => setNewPrefInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newPrefInput.trim()) {
                void addPreference(newPrefInput.trim());
                setNewPrefInput("");
              }
            }}
            className="h-8 text-xs bg-background"
          />
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => {
              if (newPrefInput.trim()) {
                void addPreference(newPrefInput.trim());
                setNewPrefInput("");
              }
            }}
          >
            Agregar
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm tracking-tight text-muted-foreground uppercase">
            {selectedPatient ? `Visitas de ${selectedPatient.initials}` : "Historial"}
          </h4>
          {consultations.length > 0 && !selectedPatient && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-destructive">
                  <Trash2 className="w-4 h-4 mr-1" />
                  Borrar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Borrar todo el historial?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se eliminarán permanentemente las {consultations.length} consultas guardadas en tu cuenta, junto con sus grabaciones. No se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void clearAllHistory()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Borrar todo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {consultations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {selectedPatient
              ? "Todavía no hay visitas para este paciente."
              : "No hay consultas guardadas."}
          </p>
        ) : (
          <div className="space-y-2">
            {consultations.map(note => (
              <div
                key={note.id}
                className={cn(
                  "flex items-start rounded-lg border transition-colors hover:bg-muted/50",
                  currentNote?.id === note.id ? "border-primary bg-primary/5" : "border-transparent bg-muted/20"
                )}
              >
                <button
                  onClick={() => loadHistoryNote(note)}
                  className="flex-1 text-left p-3 min-w-0"
                >
                  <div className="font-medium text-sm truncate">{note.title || "Sin título"}</div>
                  <div className="text-xs text-muted-foreground flex justify-between mt-1 gap-2">
                    <span className="truncate">{templates.find(t => t.id === note.template)?.name || note.template}</span>
                    <span className="shrink-0">{new Date(note.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Borrar consulta"
                  className="h-7 w-7 m-2 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => void deleteNote(note.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground pt-2 border-t leading-relaxed">
          {selectedPatient
            ? "Lo que grabes ahora se suma a las visitas de este paciente."
            : "Tus consultas se guardan en tu cuenta y solo vos podés verlas."}
        </p>
      </div>

      <div className="space-y-2 pt-2 border-t">
        {email && <p className="text-xs text-muted-foreground truncate">{email}</p>}
        <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => void signOut()}>
          <LogOut className="w-3.5 h-3.5 mr-1.5" />
          Cerrar sesión
        </Button>
      </div>
    </div>
  );

  const renderOutputPanel = (note: Consultation) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">{note.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Plantilla: {templates.find(t => t.id === note.template)?.name}
            {note.anonymized && " • Anonimizada"}
          </p>
        </div>
        <CopyButton text={note.plainText} label="Copiar todo" variant="default" />
      </div>

      {note.audioPath && (
        <RecordingPlayer consultationId={note.id} durationSeconds={note.audioDurationSeconds} />
      )}

      <div className="space-y-4">
        {note.sections.map((sec, i) => (
          <Card key={i} className="border-border/50 bg-card/50 shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-4 border-b bg-muted/20 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold text-primary">{sec.label}</CardTitle>
              <CopyButton text={sec.content} variant="ghost" size="icon" label="" className="h-8 w-8 text-muted-foreground hover:text-foreground" />
            </CardHeader>
            <CardContent className="p-4">
              <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                {sec.content}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Refinement Chat Panel */}
      <div className="mt-8 border-t border-border/50 pt-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Refinar nota</h3>

        {chatMessages.length > 0 && (
          <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto pr-2">
            {chatMessages.map((msg, i) => (
              <div key={i} className={cn(
                "p-3 rounded-xl text-sm max-w-[85%] shadow-sm",
                msg.role === 'user'
                  ? "bg-muted ml-auto rounded-br-sm text-foreground border border-border/50"
                  : "bg-primary text-primary-foreground mr-auto rounded-bl-sm"
              )}>
                {msg.text}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 bg-muted/20 p-3 rounded-xl border border-border/50">
          <div className="flex bg-muted/50 p-1 rounded-lg max-w-fit border border-border/50">
            <button
              onClick={() => setRefineScope('note')}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all", refineScope === 'note' && "bg-background shadow-sm text-foreground")}
            >
              Solo esta nota
            </button>
            <button
              onClick={() => setRefineScope('global')}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all", refineScope === 'global' && "bg-background shadow-sm text-foreground")}
            >
              Para todos los resultados
            </button>
          </div>

          <div className="flex gap-2 items-end">
            <Textarea
              value={refineInput}
              onChange={e => setRefineInput(e.target.value)}
              placeholder="Indicá qué cambiar... (ej.: 'agregá control en 4 semanas', 'usá mmHg en la presión')"
              className="min-h-[60px] text-sm resize-none bg-background focus-visible:ring-primary/50"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRefine();
                }
              }}
            />
            <Button
              size="icon"
              className="h-[60px] w-[60px] shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all active:scale-95"
              onClick={handleRefine}
              disabled={!refineInput.trim() || refineMutation.isPending}
            >
              {refineMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-1" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isSaving = create.isPending || update.isPending;

  return (
    <div className="h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden bg-background text-foreground selection:bg-primary/20">

      {/* LEFT COLUMN: DESKTOP ONLY */}
      <div className="hidden md:flex w-[320px] flex-col border-r bg-card/30">
        <div className="p-6 border-b flex items-center gap-2">
          <div className="bg-primary/10 p-2 rounded-lg text-primary">
            <Stethoscope className="w-5 h-5" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">MedScribe AI</h1>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-6 pb-24">
            {renderSettingsPanel()}
          </div>
        </ScrollArea>
      </div>

      {/* CENTER COLUMN: INPUT & ACTIONS */}
      <div className="flex-1 flex flex-col min-w-0 relative bg-background">
        {/* MOBILE HEADER */}
        <div className="md:hidden flex items-center justify-between p-4 border-b bg-card/50 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-1.5 rounded-md text-primary">
              <Stethoscope className="w-4 h-4" />
            </div>
            <h1 className="font-bold text-base tracking-tight">MedScribe</h1>
          </div>
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 relative">
                {preferences.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                  </span>
                )}
                <Settings2 className="w-4 h-4" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader>
                <DrawerTitle>Ajustes e Historial</DrawerTitle>
              </DrawerHeader>
              <ScrollArea className="overflow-y-auto px-4 pb-8">
                {renderSettingsPanel()}
              </ScrollArea>
            </DrawerContent>
          </Drawer>
        </div>

        {selectedPatient && (
          <PatientBar patient={selectedPatient} onClear={() => selectPatient(null)} />
        )}

        {/* MAIN SCROLL AREA */}
        <ScrollArea className="flex-1 px-4 md:px-8 py-6 pb-36 md:pb-6">
          <div className="flex flex-col gap-8 max-w-3xl mx-auto w-full">

            {/* MOBILE OUTPUT PLACEMENT (Visible only if currentNote exists and on mobile) */}
            {currentNote && (
              <div className="md:hidden mb-8">
                {renderOutputPanel(currentNote)}
                <div className="my-8 border-b-2 border-dashed border-border" />
              </div>
            )}

            {/* INPUT SECTION */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Entrada</h2>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={transcribeMutation.isPending || isUploading || isRecording}
                    className="h-8 text-xs"
                  >
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileAudio className="w-3.5 h-3.5 mr-1.5" />}
                    Subir Audio
                  </Button>
                </div>
              </div>

              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escriba, dicte o grabe el encuentro clínico aquí..."
                className="min-h-[200px] md:min-h-[300px] text-base leading-relaxed resize-y bg-card border-border/50 shadow-inner focus-visible:ring-primary/50"
              />

              <div className="flex flex-wrap items-center justify-between gap-4 bg-muted/30 p-3 rounded-lg border border-border/50">
                <div className="flex-1 min-w-[200px]">
                  {templates.length > 0 && (
                    <div className="space-y-1.5">
                      <Tabs value={selectedTemplateId} onValueChange={handleTemplateChange} className="w-full">
                        <TabsList className="w-full h-auto flex-wrap p-1">
                          {templates.map(t => (
                            <TabsTrigger
                              key={t.id}
                              value={t.id}
                              disabled={regenerateMutation.isPending}
                              className="flex-1 text-xs py-1.5"
                            >
                              {t.name}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                      <p className="text-[11px] text-muted-foreground leading-tight flex items-center gap-1.5">
                        {regenerateMutation.isPending ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            Regenerando la nota en ese formato...
                          </>
                        ) : currentNote ? (
                          "Elegí otro formato para regenerar esta consulta."
                        ) : (
                          "Formato de la nota que vas a generar."
                        )}
                      </p>
                    </div>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAnonymizeNow}
                  disabled={!text || anonymizeMutation.isPending}
                  className="h-8 text-xs bg-background"
                >
                  {anonymizeMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Anonimizar texto
                </Button>
              </div>
            </div>

          </div>
        </ScrollArea>

        {/* STICKY BOTTOM ACTION BAR */}
        <div className="absolute bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur-md pb-safe p-4 md:p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-10">
          <div className="max-w-3xl mx-auto flex items-center justify-center gap-3 md:gap-6">

            {/* RECORDING CONTROLS */}
            {!isRecording ? (
              <Button
                onClick={startRecording}
                disabled={transcribeMutation.isPending || structureMutation.isPending}
                className="w-16 h-16 rounded-full rounded-tr-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg shadow-destructive/20 transition-all hover:scale-105 active:scale-95"
              >
                <Mic className="w-6 h-6" />
              </Button>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  variant={isPaused ? "default" : "secondary"}
                  onClick={pauseRecording}
                  className="w-14 h-14 rounded-full shadow-md"
                >
                  {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                </Button>

                <div className="flex flex-col items-center justify-center px-4 min-w-[80px]">
                  <div className={cn("w-3 h-3 rounded-full mb-1", isPaused ? "bg-muted-foreground" : "bg-destructive animate-pulse")} />
                  <span className="text-lg font-mono font-medium tabular-nums">{formatTime(timerSeconds)}</span>
                </div>

                <Button
                  onClick={handleStopRecording}
                  className="w-14 h-14 rounded-full bg-foreground text-background hover:bg-foreground/90 shadow-md"
                >
                  <Square className="w-5 h-5 fill-current" />
                </Button>
              </div>
            )}

            <div className="w-px h-10 bg-border mx-2 md:mx-4" />

            <div className="relative flex-1 max-w-[200px]">
              {preferences.length > 0 && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-accent text-accent-foreground border border-border/50 text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap z-10 shadow-sm font-medium">
                  {preferences.length} pref. activa{preferences.length > 1 ? 's' : ''}
                </div>
              )}
              <Button
                size="xl"
                onClick={handleProcess}
                disabled={!text || structureMutation.isPending || isSaving || isRecording}
                className={cn(
                  "w-full h-16 rounded-2xl shadow-lg transition-all",
                  text ? "bg-primary hover:bg-primary/90 text-primary-foreground hover:scale-105 active:scale-95 shadow-primary/25" : "bg-muted text-muted-foreground"
                )}
              >
                {structureMutation.isPending || isSaving ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  "Estructurar"
                )}
              </Button>
            </div>

          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: OUTPUT (DESKTOP ONLY) */}
      <div className="hidden md:flex w-[450px] lg:w-[500px] flex-col border-l bg-card/20 relative">
        <ScrollArea className="flex-1 p-6 lg:p-8">
          {currentNote ? (
            renderOutputPanel(currentNote)
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground/60 p-8 space-y-4 pt-32">
              <Stethoscope className="w-16 h-16 opacity-20" />
              <p className="text-sm">Grabe un encuentro y presione Estructurar para generar la nota clínica formal.</p>
            </div>
          )}
        </ScrollArea>
      </div>

    </div>
  );
}
