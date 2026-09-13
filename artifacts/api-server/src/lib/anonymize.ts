/**
 * Local, deterministic anonymizer. Runs before any text leaves the server
 * towards the AI provider. Heuristic — not a substitute for clinical judgment.
 */

const HONORIFICS =
  "(?:Sr\\.?|Sra\\.?|Srta\\.?|Dr\\.?|Dra\\.?|Lic\\.?|Don|Doña|Sr|Sra)";
const CUES =
  "(?:paciente|el paciente|la paciente|se llama|llamado|llamada|nombre|apellido|madre|padre|hijo|hija|esposo|esposa|acompañante|tutor|tutora)";
const CAP = "[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+";
const NAME_SEQ = `${CAP}(?:\\s+(?:de\\s+|del\\s+|la\\s+)?${CAP}){1,3}`;

function toInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => !/^(de|del|la)$/i.test(w))
    .map((w) => w[0]!.toUpperCase() + ".")
    .join("");
}

export function anonymizeText(input: string): { text: string; replacements: number } {
  let count = 0;
  let text = input;

  const sub = (re: RegExp, fn: (...m: string[]) => string) => {
    text = text.replace(re, (...args) => {
      count += 1;
      return fn(...(args as string[]));
    });
  };

  // Honorific + name: "Sra. María Pérez" -> "Sra. M.P."
  sub(new RegExp(`\\b(${HONORIFICS})\\s+(${NAME_SEQ})`, "g"), (_m, h, n) => `${h} ${toInitials(n)}`);

  // Cue + name: "paciente Juan Carlos Gómez" -> "paciente J.C.G."
  sub(new RegExp(`\\b(${CUES})\\s*[:,]?\\s+(${NAME_SEQ})`, "gi"), (_m, c, n) => `${c} ${toInitials(n)}`);

  // DNI / documento / historia clínica numbers
  sub(/\b(DNI|D\.N\.I\.|documento|doc\.?|HC|historia cl[ií]nica|afiliado|n[uú]mero de afiliado|CUIL|CUIT)\s*[:#nº°]*\s*[\d.\-\s]{6,}/gi, (_m, k) => `${k} [OMITIDO]`);

  // Phone numbers (7+ digits with separators)
  sub(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3,4}[\s-]?\d{4}\b/g, () => "[TEL]");

  // Emails
  sub(/[\w.+-]+@[\w-]+\.[\w.]+/g, () => "[EMAIL]");

  // Street addresses: "calle X 123", "Av. Y 456"
  sub(new RegExp(`\\b(calle|av\\.?|avenida|pasaje|ruta|barrio)\\s+${CAP}(?:\\s+${CAP})*\\s*\\d{1,5}`, "gi"), () => "[DOMICILIO]");

  return { text, replacements: count };
}
