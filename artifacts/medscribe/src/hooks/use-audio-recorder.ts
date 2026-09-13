import { useState, useRef, useEffect, useCallback } from "react";

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startTimer = useCallback(() => {
    if (!timerIntervalRef.current) {
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    }
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    pauseTimer();
    setTimerSeconds(0);
  }, [pauseTimer]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else {
          mimeType = ""; // Let browser decide
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(1000); // chunk every 1s
      setIsRecording(true);
      setIsPaused(false);
      resetTimer();
      startTimer();
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      if (err.name === "NotAllowedError") {
        setError("Permiso de micrófono denegado. Por favor, acéptelo en la configuración del navegador.");
      } else {
        setError("Error al acceder al micrófono.");
      }
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      pauseTimer();
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      startTimer();
    }
  };

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorderRef.current) {
        reject(new Error("No active recorder"));
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        
        // Stop all tracks to release microphone
        mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
        
        setIsRecording(false);
        setIsPaused(false);
        resetTimer();
        resolve(audioBlob);
      };

      mediaRecorderRef.current.stop();
      pauseTimer();
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pauseTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [pauseTimer]);

  return {
    isRecording,
    isPaused,
    timerSeconds,
    startRecording,
    pauseRecording,
    stopRecording,
    error,
  };
}
