import { APIError } from "openai";
import { MODELS, PROVIDER } from "./client";

/**
 * An upstream failure, translated for the physician.
 *
 * The provider's own status code must never become ours: Gemini answers an
 * unknown model with a bare 404, and passing that through made the browser
 * report the app's own route as missing. Everything upstream is a 502 — the
 * request was fine, the dependency was not.
 */
export class AiProviderError extends Error {
  readonly status = 502;
  /** Status the provider returned, for the logs. */
  readonly providerStatus: number | undefined;

  constructor(message: string, providerStatus?: number) {
    super(message);
    this.name = "AiProviderError";
    this.providerStatus = providerStatus;
  }
}

const PROVIDER_LABEL = PROVIDER === "gemini" ? "Gemini" : "OpenAI";

/**
 * Maps a provider HTTP status to something a user can act on, naming the
 * likely cause rather than echoing the raw status.
 */
export function aiErrorFromStatus(status: number, model: string): AiProviderError {
  switch (status) {
    case 400:
      return new AiProviderError(
        `${PROVIDER_LABEL} rechazó el pedido. Puede que el modelo "${model}" no acepte este tipo de entrada.`,
        400,
      );
    case 401:
    case 403:
      return new AiProviderError(
        `${PROVIDER_LABEL} rechazó la credencial. Revisá AI_API_KEY.`,
        status,
      );
    case 404:
      return new AiProviderError(
        `${PROVIDER_LABEL} no reconoce el modelo "${model}". Revisá AI_TRANSCRIBE_MODEL / AI_STRUCTURE_MODEL.`,
        404,
      );
    case 429:
      return new AiProviderError(
        `Se agotó la cuota de ${PROVIDER_LABEL} por ahora. Esperá unos minutos.`,
        429,
      );
    default:
      return new AiProviderError(
        `${PROVIDER_LABEL} falló (error ${status}). Reintentá en unos segundos.`,
        status,
      );
  }
}

/** Same, for a failure raised by the OpenAI client. */
export function toAiProviderError(err: unknown, model: string): AiProviderError {
  if (err instanceof AiProviderError) return err;
  if (!(err instanceof APIError)) {
    return new AiProviderError(
      `No se pudo contactar a ${PROVIDER_LABEL}. Reintentá en unos segundos.`,
    );
  }
  return aiErrorFromStatus(err.status ?? 502, model);
}

export const CONFIGURED_MODELS = MODELS;
