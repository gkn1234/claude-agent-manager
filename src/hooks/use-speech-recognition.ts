'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionResult {
  /** Whether the browser supports SpeechRecognition */
  isSupported: boolean;
  /** Whether the recognition is currently listening */
  isListening: boolean;
  /** Start listening */
  start: () => void;
  /** Stop listening */
  stop: () => void;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: {
    isFinal: boolean;
    0: { transcript: string };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface UseSpeechRecognitionOptions {
  /** Language for recognition. Default: 'zh-CN' */
  lang?: string;
  /** Called when a final transcript segment is produced */
  onResult?: (transcript: string) => void;
  /** Called with interim (partial) transcript while speaking */
  onInterim?: (transcript: string) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
}

function getSpeechRecognitionClass(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition({
  lang = 'zh-CN',
  onResult,
  onInterim,
  onError,
}: UseSpeechRecognitionOptions = {}): SpeechRecognitionResult {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isSupported = typeof window !== 'undefined' && getSpeechRecognitionClass() !== null;

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const start = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognitionClass();
    if (!SpeechRecognitionClass) return;

    // Stop any existing session
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        onResult?.(finalTranscript);
      }
      if (interimTranscript) {
        onInterim?.(interimTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        onError?.('请允许麦克风权限');
      } else if (event.error === 'no-speech') {
        // Ignore no-speech, just stop silently
      } else if (event.error === 'aborted') {
        // Ignore manual abort
      } else {
        onError?.('语音识别失败，请重试');
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [lang, onResult, onInterim, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return { isSupported, isListening, start, stop };
}
