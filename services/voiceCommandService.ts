import { Platform } from 'react-native';
import { UserRole } from '../context/IntercomContext';

export interface ParsedVoiceCommand {
  type: 'PREVIEW' | 'PROGRAM';
  cameraId: string; // e.g. 'cam1'
  cameraNumber: number; // 1 to 8
  triggerWord: string;
  rawPhrase: string;
}

export interface VoiceCommandCallbacks {
  onCommand?: (command: ParsedVoiceCommand) => void;
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onStatusChange?: (isListening: boolean, error?: string | null) => void;
  onError?: (error: string) => void;
}

/**
 * Normalizes Spanish spoken number words (uno, dos, tres...) to digits (1-8).
 */
export function normalizeSpanishTranscript(text: string): string {
  const numberWordMap: Record<string, string> = {
    uno: '1',
    una: '1',
    dos: '2',
    tres: '3',
    cuatro: '4',
    cinco: '5',
    seis: '6',
    siete: '7',
    ocho: '8',
  };

  return text.replace(
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho)\b/gi,
    (matched) => numberWordMap[matched.toLowerCase()] || matched
  );
}

/**
 * Parses spoken Spanish text for Director Tally commands:
 *
 * 1. Standby / Preview triggers:
 *    - Regex: /(preparad[oa]|previo)\s*(cámara|cam)?\s*([1-8])/i
 *    - Action: Set Preview camera
 *
 * 2. Program / Live / Cut triggers:
 *    - Regex: /(dentro|va|corte)\s*(cámara|cam)?\s*([1-8])/i
 *    - Regex: /(cámara|cam)\s*([1-8])\s*(dentro|va)/i
 *    - Action: Promote to Program (Cut)
 */
export function parseVoiceCommand(rawText: string): ParsedVoiceCommand | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const normalized = normalizeSpanishTranscript(rawText.trim());

  // Program Trigger 1: /(dentro|va|corte)\s*(c[áa]mara|cam)?\s*([1-8])/i
  const programMatch1 = normalized.match(/(dentro|va|corte)\s*(c[áa]mara|cam)?\s*([1-8])/i);
  if (programMatch1 && programMatch1[3]) {
    const num = parseInt(programMatch1[3], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PROGRAM',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: programMatch1[1].toLowerCase(),
        rawPhrase: programMatch1[0].trim(),
      };
    }
  }

  // Program Trigger 2: /(c[áa]mara|cam)\s*([1-8])\s*(dentro|va)/i
  const programMatch2 = normalized.match(/(c[áa]mara|cam)\s*([1-8])\s*(dentro|va)/i);
  if (programMatch2 && programMatch2[2]) {
    const num = parseInt(programMatch2[2], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PROGRAM',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: programMatch2[3].toLowerCase(),
        rawPhrase: programMatch2[0].trim(),
      };
    }
  }

  // Preview Trigger: /(preparad[oa]|previo)\s*(c[áa]mara|cam)?\s*([1-8])/i
  const previewMatch = normalized.match(/(preparad[oa]|previo)\s*(c[áa]mara|cam)?\s*([1-8])/i);
  if (previewMatch && previewMatch[3]) {
    const num = parseInt(previewMatch[3], 10);
    if (num >= 1 && num <= 8) {
      return {
        type: 'PREVIEW',
        cameraId: `cam${num}`,
        cameraNumber: num,
        triggerWord: previewMatch[1].toLowerCase(),
        rawPhrase: previewMatch[0].trim(),
      };
    }
  }

  return null;
}

export interface VoiceRecognitionEngine {
  isSupported(): boolean;
  start(callbacks: VoiceCommandCallbacks): Promise<boolean>;
  stop(): Promise<void>;
}

/**
 * Web Speech API Engine (SpeechRecognition / webkitSpeechRecognition)
 * Configured for continuous recognition in Spanish ('es-ES').
 */
class WebSpeechEngine implements VoiceRecognitionEngine {
  private recognition: any = null;
  private isListening = false;
  private shouldBeListening = false;
  private restartTimeout: any = null;
  private callbacks: VoiceCommandCallbacks = {};
  private lastTriggeredKey = '';
  private lastTriggeredTime = 0;

  isSupported(): boolean {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return !!SpeechRecognition;
  }

  async start(callbacks: VoiceCommandCallbacks): Promise<boolean> {
    if (!this.isSupported()) {
      callbacks.onError?.('Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.');
      callbacks.onStatusChange?.(false, 'Speech Recognition Unsupported');
      return false;
    }

    this.callbacks = callbacks;
    this.shouldBeListening = true;

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!this.recognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'es-ES';
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
          this.isListening = true;
          this.callbacks.onStatusChange?.(true);
        };

        this.recognition.onresult = (event: any) => {
          let latestTranscript = '';
          let isFinal = false;

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            latestTranscript = transcript;
            if (event.results[i].isFinal) {
              isFinal = true;
            }
          }

          if (!latestTranscript) return;

          this.callbacks.onTranscript?.(latestTranscript, isFinal);

          // Evaluate command
          const command = parseVoiceCommand(latestTranscript);
          if (command) {
            const commandKey = `${command.type}_${command.cameraId}`;
            const now = Date.now();

            // Deduplicate triggers within 1200ms
            if (
              commandKey !== this.lastTriggeredKey ||
              now - this.lastTriggeredTime > 1200
            ) {
              this.lastTriggeredKey = commandKey;
              this.lastTriggeredTime = now;
              this.callbacks.onCommand?.(command);
            }
          }
        };

        this.recognition.onerror = (event: any) => {
          if (event.error === 'no-speech') {
            // Normal silence timeout; ignore and keep listening
            return;
          }

          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            this.shouldBeListening = false;
            this.isListening = false;
            this.callbacks.onStatusChange?.(false, 'Microphone permission denied');
            this.callbacks.onError?.('Permiso de micrófono denegado para reconocimiento de voz.');
            return;
          }

          console.warn('[WebSpeechEngine] Speech recognition error:', event.error);
        };

        this.recognition.onend = () => {
          this.isListening = false;
          if (this.shouldBeListening) {
            // Hands-free continuous auto-restart
            if (this.restartTimeout) clearTimeout(this.restartTimeout);
            this.restartTimeout = setTimeout(() => {
              if (this.shouldBeListening) {
                try {
                  this.recognition.start();
                } catch {
                  // Ignore if already active
                }
              }
            }, 250);
          } else {
            this.callbacks.onStatusChange?.(false);
          }
        };
      }

      this.recognition.start();
      return true;
    } catch (err: any) {
      console.warn('[WebSpeechEngine] Start error:', err);
      // If already started, mark listening
      if (err.name === 'InvalidStateError') {
        this.isListening = true;
        this.callbacks.onStatusChange?.(true);
        return true;
      }
      this.callbacks.onError?.(`Error al iniciar reconocimiento: ${err.message || err}`);
      return false;
    }
  }

  async stop(): Promise<void> {
    this.shouldBeListening = false;
    this.isListening = false;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Safe ignore
      }
    }
    this.callbacks.onStatusChange?.(false);
  }
}

/**
 * Native Voice Recognition Engine Stub
 * Ready for @react-native-voice/voice integration on iOS and Android builds.
 */
class NativeVoiceEngine implements VoiceRecognitionEngine {
  isSupported(): boolean {
    return false; // Ready for react-native-voice on native builds
  }

  async start(callbacks: VoiceCommandCallbacks): Promise<boolean> {
    callbacks.onError?.(
      'Reconocimiento nativo: requiere módulo react-native-voice configurado en el build de producción.'
    );
    return false;
  }

  async stop(): Promise<void> {
    // Native stop placeholder
  }
}

/**
 * Dedicated Voice Command Service for the Director role.
 * Strictly isolates command execution to the Director role.
 */
export class VoiceCommandService {
  private engine: VoiceRecognitionEngine;
  private isListeningActive = false;

  constructor() {
    if (Platform.OS === 'web') {
      this.engine = new WebSpeechEngine();
    } else {
      this.engine = new NativeVoiceEngine();
    }
  }

  public isSupported(): boolean {
    return this.engine.isSupported();
  }

  public isListening(): boolean {
    return this.isListeningActive;
  }

  /**
   * Starts hands-free voice command recognition.
   * STRICT SECURITY: Only participants with role === 'director' are permitted.
   */
  public async startListening(
    role: UserRole | undefined,
    callbacks: VoiceCommandCallbacks
  ): Promise<boolean> {
    if (role !== 'director') {
      const err = '[VoiceCommandService] Security violation: Voice commands are strictly restricted to the Director.';
      console.warn(err);
      callbacks.onError?.(err);
      callbacks.onStatusChange?.(false, 'Unauthorized: Director role required');
      return false;
    }

    const wrappedCallbacks: VoiceCommandCallbacks = {
      ...callbacks,
      onStatusChange: (listening, error) => {
        this.isListeningActive = listening;
        callbacks.onStatusChange?.(listening, error);
      },
    };

    const success = await this.engine.start(wrappedCallbacks);
    if (success) {
      this.isListeningActive = true;
    }
    return success;
  }

  /**
   * Stops voice command recognition.
   */
  public async stopListening(): Promise<void> {
    this.isListeningActive = false;
    await this.engine.stop();
  }
}

export const voiceCommandService = new VoiceCommandService();
