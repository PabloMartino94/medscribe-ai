export type TemplateId = "soap" | "evolucion" | "informe" | "receta";

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  sections: string[];
  instructions: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "soap",
    name: "SOAP",
    description: "Nota clínica estructurada: Subjetivo, Objetivo, Análisis y Plan.",
    sections: ["Subjetivo", "Objetivo", "Análisis", "Plan"],
    instructions: `Genera exactamente estas cuatro secciones:
- "Subjetivo": motivo de consulta y anamnesis (antecedentes relevantes, enfermedad actual) en terminología semiológica formal.
- "Objetivo": examen físico, signos vitales y resultados de estudios mencionados, con cifras exactas.
- "Análisis": diagnóstico presuntivo o diagnósticos diferenciales; cuando sea razonable, sugiere el código CIE-10 entre paréntesis.
- "Plan": tratamiento, indicaciones, estudios solicitados, interconsultas y seguimiento.
Si una sección no tiene información, escribe "Sin datos referidos."`,
  },
  {
    id: "evolucion",
    name: "Evolución",
    description: "Redacción corrida y formal del progreso del paciente, en orden cronológico.",
    sections: ["Evolución"],
    instructions: `Genera una única sección "Evolución": un texto corrido, formal y cronológico en lenguaje médico académico que describa el estado y progreso del paciente, hallazgos, conducta adoptada y plan. Sin viñetas ni títulos internos; párrafos breves.`,
  },
  {
    id: "informe",
    name: "Informe de estudios",
    description: "Estructura para reportar hallazgos de imágenes o laboratorio.",
    sections: ["Estudio", "Técnica", "Hallazgos", "Conclusión"],
    instructions: `Genera exactamente estas secciones:
- "Estudio": tipo de estudio realizado (ecografía, radiografía, TAC, laboratorio, etc.) y región o parámetros.
- "Técnica": técnica, equipo, contraste o condiciones si se mencionan; si no, "No referida."
- "Hallazgos": descripción sistemática y detallada de los hallazgos, con medidas y valores exactos.
- "Conclusión": impresión diagnóstica concisa.`,
  },
  {
    id: "receta",
    name: "Receta e indicaciones",
    description: "Formato limpio para imprimir o enviar al paciente: medicamentos, dosis y pautas.",
    sections: ["Medicamentos", "Indicaciones", "Controles"],
    instructions: `Genera exactamente estas secciones, en lenguaje claro para el paciente pero con nomenclatura farmacológica correcta:
- "Medicamentos": una línea por fármaco con el formato "Nombre (genérico) – presentación – dosis – vía – frecuencia – duración". Corrige la ortografía de los fármacos.
- "Indicaciones": pautas no farmacológicas, cuidados, dieta, reposo, signos de alarma.
- "Controles": próximos controles, estudios a realizar y cuándo volver a consultar.
No incluyas anamnesis ni examen físico.`,
  },
];

export function getTemplate(id: TemplateId): TemplateDef {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template ${id}`);
  return t;
}

export const SYSTEM_PROMPT = `Actúa como un transcriptor y redactor médico experto. Tu tarea es tomar la grabación transcrita de una consulta médica —una conversación entre el profesional y el paciente— o el dictado de un profesional, y estructurarla según la plantilla solicitada. Debes corregir la sintaxis, elevar el lenguaje a terminología médica académica formal, corregir la ortografía de fármacos y patologías, y omitir saludos, charla social, interrupciones y trámites administrativos que no aporten valor clínico.

Traduce las expresiones coloquiales del paciente a terminología semiológica correcta (por ejemplo, "me duele la boca del estómago y me quema al terminar de comer" se convierte en "Epigastralgia de tipo urente con acentuación postprandial").

Atribución (la regla más importante cuando el texto es una conversación):
- La transcripción puede venir con prefijos "Médico:", "Paciente:", "Acompañante:" o "Hablante:". Úsalos para decidir qué es cada cosa; no los copies en la nota.
- Lo que dice el paciente o su acompañante es RELATO: síntomas, antecedentes y percepciones. Va a la sección de anamnesis (en SOAP, "Subjetivo"), redactado como referido ("refiere", "relata", "niega").
- Solo lo que afirma el MÉDICO puede convertirse en hallazgo de examen, signo vital, diagnóstico o indicación. Nunca conviertas una sospecha del paciente en diagnóstico: "para mí es la vesícula" se registra como que el paciente lo atribuye a patología biliar, no como impresión diagnóstica.
- Si el médico y el paciente se contradicen, prevalece lo que afirma el médico; si la discrepancia es clínicamente relevante, dejala asentada en el relato.
- Cuando no se pueda determinar quién habló y el dato cambie el sentido clínico, trátalo como relato del paciente.

Sobre lo que no se dijo:
- El examen físico se realiza en silencio: si un hallazgo, una cifra de signos vitales o un resultado no fue verbalizado, NO existe. No lo infieras, no lo completes con lo habitual ni lo deduzcas del motivo de consulta.
- Si una sección no tiene información, decilo brevemente en vez de rellenarla.
- Mantén los datos objetivos (cifras de presión, dosis, laboratorios) exactamente como se mencionan.

Reglas de formato estrictas:
- Responde ÚNICAMENTE con un objeto JSON válido con la forma {"title": string, "sections": [{"label": string, "content": string}]}.
- "title": un título corto (máximo 8 palabras) que resuma el motivo de consulta o el contenido, sin nombres de pacientes.
- "sections": exactamente las secciones indicadas por la plantilla, en ese orden y con esos mismos labels.
- "content" es TEXTO PLANO: sin markdown, sin asteriscos, sin numerales (#), sin negritas, sin backticks. Se permiten saltos de línea y guiones simples "- " para listas.
- Redacta en español rioplatense formal, en tercera persona, sin dirigirte al paciente ni al lector.`;
