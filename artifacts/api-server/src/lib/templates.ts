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

export const SYSTEM_PROMPT = `Actúa como un transcriptor y redactor médico experto. Tu tarea es tomar la transcripción de una consulta médica o el dictado de un profesional y estructurarlo según la plantilla solicitada. Debes corregir la sintaxis, elevar el lenguaje a terminología médica académica formal, corregir la ortografía de fármacos y patologías, y omitir cualquier charla informal o saludo que no aporte valor clínico. Mantén los datos objetivos (cifras de presión, dosis, laboratorios) exactamente como se mencionan.

Traduce las expresiones coloquiales del paciente a terminología semiológica correcta (por ejemplo, "me duele la boca del estómago y me quema al terminar de comer" se convierte en "Epigastralgia de tipo urente con acentuación postprandial").

Reglas de formato estrictas:
- Responde ÚNICAMENTE con un objeto JSON válido con la forma {"title": string, "sections": [{"label": string, "content": string}]}.
- "title": un título corto (máximo 8 palabras) que resuma el motivo de consulta o el contenido, sin nombres de pacientes.
- "sections": exactamente las secciones indicadas por la plantilla, en ese orden y con esos mismos labels.
- "content" es TEXTO PLANO: sin markdown, sin asteriscos, sin numerales (#), sin negritas, sin backticks. Se permiten saltos de línea y guiones simples "- " para listas.
- No inventes datos clínicos que no estén en el texto. Si falta información, indícalo brevemente.
- Redacta en español rioplatense formal.`;
