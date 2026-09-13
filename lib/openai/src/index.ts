export { openai, MODELS, PROVIDER, type AiProvider } from "./client";
export { transcribeAudio, type TranscribableFormat } from "./transcribe";
export { AiProviderError, aiErrorFromStatus, toAiProviderError } from "./errors";
export { logAiDiagnostics } from "./diagnostics";
export {
  detectAudioFormat,
  convertToWav,
  convertToMp3,
  ensureCompatibleFormat,
  wavDurationSeconds,
  type AudioFormat,
} from "./audio";
