import { useRef, useCallback } from "react";

export function useAudioPlayback() {
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const decodeQueueRef = useRef<Array<{ data: ArrayBuffer; turnId: string | null }>>([]);
  const audioQueue = useRef<AudioBuffer[]>([]);
  const isDecodeProcessingRef = useRef(false);
  const isQueueProcessing = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentPlaybackResolveRef = useRef<(() => void) | null>(null);
  const playbackGenerationRef = useRef(0);
  const isModelTurnActiveRef = useRef(false);
  const currentTurnIdRef = useRef<string | null>(null);

  const writeString = (view: DataView, offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  const createWavHeader = (dataLength: number, sampleRate: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);
    return header;
  };

  const interruptAudio = useCallback(() => {
    playbackGenerationRef.current += 1;
    if (currentPlaybackResolveRef.current) {
      currentPlaybackResolveRef.current();
      currentPlaybackResolveRef.current = null;
    }
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null;
        currentSourceRef.current.stop();
      } catch { /* noop */ }
      currentSourceRef.current = null;
    }
    decodeQueueRef.current = [];
    audioQueue.current = [];
    isQueueProcessing.current = false;
  }, []);

  const decodeAudioChunk = async (data: ArrayBuffer): Promise<AudioBuffer | null> => {
    try {
      if (!outputAudioContextRef.current || outputAudioContextRef.current.state === "closed") {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (outputAudioContextRef.current.state === "suspended") {
        await outputAudioContextRef.current.resume();
      }
      const wavHeader = createWavHeader(data.byteLength, 24000);
      const wavBlob = new Blob([wavHeader, data], { type: "audio/wav" });
      const wavArrayBuffer = await wavBlob.arrayBuffer();
      if (!outputAudioContextRef.current) return null;
      return await outputAudioContextRef.current.decodeAudioData(wavArrayBuffer);
    } catch (e) {
      console.error("[ERROR] Failed to decode audio chunk:", e);
      return null;
    }
  };

  const processQueue = async (setIsSpeaking: (v: boolean) => void) => {
    if (isQueueProcessing.current || audioQueue.current.length === 0) return;
    isQueueProcessing.current = true;
    const myGeneration = playbackGenerationRef.current;
    try {
      while (audioQueue.current.length > 0) {
        if (playbackGenerationRef.current !== myGeneration) break;
        const audioBuffer = audioQueue.current.shift();
        if (!audioBuffer || !outputAudioContextRef.current) continue;
        if (currentSourceRef.current) {
          try {
            currentSourceRef.current.onended = null;
            currentSourceRef.current.stop();
          } catch { /* noop */ }
        }
        const source = outputAudioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputAudioContextRef.current.destination);
        currentSourceRef.current = source;
        setIsSpeaking(true);
        await new Promise<void>((resolve) => {
          currentPlaybackResolveRef.current = resolve;
          source.onended = () => {
            if (currentPlaybackResolveRef.current === resolve) currentPlaybackResolveRef.current = null;
            if (currentSourceRef.current === source) currentSourceRef.current = null;
            resolve();
          };
          source.start();
        });
      }
    } finally {
      isQueueProcessing.current = false;
      if (
        playbackGenerationRef.current === myGeneration
        && audioQueue.current.length === 0
        && decodeQueueRef.current.length === 0
        && !isModelTurnActiveRef.current
      ) {
        setIsSpeaking(false);
      }
    }
  };

  const decodeAudioQueue = async (setIsSpeaking: (v: boolean) => void) => {
    if (isDecodeProcessingRef.current) return;
    isDecodeProcessingRef.current = true;
    try {
      while (decodeQueueRef.current.length > 0) {
        const next = decodeQueueRef.current.shift();
        if (!next) continue;
        if (!next.turnId || next.turnId !== currentTurnIdRef.current) continue;
        const audioBuffer = await decodeAudioChunk(next.data);
        if (!audioBuffer) continue;
        if (next.turnId !== currentTurnIdRef.current) continue;
        audioQueue.current.push(audioBuffer);
        void processQueue(setIsSpeaking);
      }
    } finally {
      isDecodeProcessingRef.current = false;
      if (decodeQueueRef.current.length > 0) void decodeAudioQueue(setIsSpeaking);
    }
  };

  const enqueueAudioChunk = useCallback((data: ArrayBuffer, turnId: string | null, setIsSpeaking: (v: boolean) => void) => {
    decodeQueueRef.current.push({ data: data.slice(0), turnId });
    void decodeAudioQueue(setIsSpeaking);
  }, []);

  const closeOutputContext = useCallback(() => {
    if (outputAudioContextRef.current) {
      void outputAudioContextRef.current.close().catch(() => undefined);
      outputAudioContextRef.current = null;
    }
  }, []);

  return {
    interruptAudio,
    enqueueAudioChunk,
    closeOutputContext,
    isModelTurnActiveRef,
    currentTurnIdRef,
    audioQueue,
    decodeQueueRef,
  };
}
