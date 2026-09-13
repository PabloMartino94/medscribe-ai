import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { getConsultationAudio } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

/**
 * Plays back the recording stored for a consultation.
 *
 * The URL is minted on demand rather than with the consultation list: signed
 * URLs expire in minutes, so fetching one up front would hand the player a
 * dead link by the time the physician scrolls to it.
 */
export function RecordingPlayer({
  consultationId,
  durationSeconds,
}: {
  consultationId: string;
  durationSeconds?: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const link = await getConsultationAudio(consultationId);
      setUrl(link.url);
    } catch {
      setError('No se pudo cargar el audio.');
    } finally {
      setLoading(false);
    }
  };

  if (url) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio src={url} controls autoPlay className="w-full h-10" />;
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={load} disabled={loading}>
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5 mr-1.5" />
        )}
        Escuchar audio
      </Button>
      {durationSeconds ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.round(durationSeconds)}s
        </span>
      ) : null}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
