import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useAgentStore } from "@/stores/agentStore";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { useContextSync } from "./hooks/useContextSync";
import { useToolHandler } from "./hooks/useToolHandler";

type LiveTurnState = "model_start" | "model_end" | "tool_start" | "tool_end" | "interrupted";

type TurnStateMessage = {
  type: "turn_state";
  state: LiveTurnState;
  turn_id?: string;
  tool?: string;
};

type ToolCallMessage = {
  type: "tool_call";
  name: string;
  args: any;
  query_meta?: any;
  turn_id?: string;
  tool_call_id?: string;
  tool_call_key?: string;
};

const LiveAgent: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const inputSinkGainRef = useRef<GainNode | null>(null);

  const isActiveRef = useRef(false);
  const isShuttingDownRef = useRef(false);
  const hasSentSpeechStartRef = useRef(false);
  const speechFrameStreakRef = useRef(0);

  const { startRun, upsertStep, finishRun } = useAgentStore();
  const currentRunId = useRef<string | null>(null);

  const logger = (msg: string) => console.log(`[LiveAgent] ${msg}`);

  // Extracted hooks
  const {
    interruptAudio, enqueueAudioChunk, closeOutputContext,
    isModelTurnActiveRef, currentTurnIdRef, audioQueue, decodeQueueRef,
  } = useAudioPlayback();

  const {
    contextSyncAckRef, clearContextTimer, clearContextSyncRetryTimer,
    queueContextUpdate, flushContextUpdateIfSafe, scheduleContextFlush,
    resetContextState, contextSyncRetryTimerRef,
  } = useContextSync();

  const {
    handleToolCall, shouldApplyToolCall, lastToolMutationAtRef, clearProcessedKeys,
  } = useToolHandler();

  // --- Turn state handler ---
  const handleTurnState = (msg: TurnStateMessage) => {
    const incomingTurnId = typeof msg.turn_id === "string" ? msg.turn_id : null;
    switch (msg.state) {
      case "model_start": {
        if (incomingTurnId && incomingTurnId !== currentTurnIdRef.current) {
          interruptAudio();
          setIsSpeaking(false);
          clearProcessedKeys();
        }
        if (incomingTurnId) currentTurnIdRef.current = incomingTurnId;
        isModelTurnActiveRef.current = true;
        break;
      }
      case "model_end": {
        if (!incomingTurnId || !currentTurnIdRef.current || incomingTurnId === currentTurnIdRef.current) {
          isModelTurnActiveRef.current = false;
          if (audioQueue.current.length === 0 && decodeQueueRef.current.length === 0) setIsSpeaking(false);
          void flushContextUpdateIfSafe(false, isActiveRef.current, socketRef.current);
        }
        break;
      }
      case "interrupted": {
        if (!incomingTurnId || !currentTurnIdRef.current || incomingTurnId === currentTurnIdRef.current) {
          interruptAudio();
          setIsSpeaking(false);
          isModelTurnActiveRef.current = false;
          void flushContextUpdateIfSafe(false, isActiveRef.current, socketRef.current);
        }
        break;
      }
      default:
        break;
    }
  };

  // --- Shutdown ---
  const shutdownLive = (reason: string, opts: { closeSocket?: boolean } = {}) => {
    if (isShuttingDownRef.current) return;
    isShuttingDownRef.current = true;
    const closeSocket = opts.closeSocket ?? true;
    logger(`[STOP] ${reason}`);

    clearContextTimer();
    clearContextSyncRetryTimer();

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (closeSocket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try { socket.close(); } catch { /* noop */ }
      }
    }

    interruptAudio();
    setIsSpeaking(false);

    if (inputProcessorNodeRef.current) {
      try { inputProcessorNodeRef.current.onaudioprocess = null; inputProcessorNodeRef.current.disconnect(); } catch { /* noop */ }
      inputProcessorNodeRef.current = null;
    }
    if (inputSourceNodeRef.current) {
      try { inputSourceNodeRef.current.disconnect(); } catch { /* noop */ }
      inputSourceNodeRef.current = null;
    }
    if (inputSinkGainRef.current) {
      try { inputSinkGainRef.current.disconnect(); } catch { /* noop */ }
      inputSinkGainRef.current = null;
    }
    if (inputStreamRef.current) {
      inputStreamRef.current.getTracks().forEach((track) => track.stop());
      inputStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    closeOutputContext();

    currentTurnIdRef.current = null;
    isModelTurnActiveRef.current = false;
    isActiveRef.current = false;
    hasSentSpeechStartRef.current = false;
    speechFrameStreakRef.current = 0;
    resetContextState();
    clearProcessedKeys();
    lastToolMutationAtRef.current = 0;

    setIsActive(false);
    setIsConnecting(false);

    if (currentRunId.current) {
      finishRun();
      currentRunId.current = null;
    }
    isShuttingDownRef.current = false;
  };

  // --- Start live ---
  const startLive = async () => {
    if (isConnecting || isActiveRef.current) return;
    setError(null);
    setIsConnecting(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not supported on this origin or browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputStreamRef.current = stream;

      let audioContext: AudioContext;
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      } catch {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const sinkGain = audioContext.createGain();
      sinkGain.gain.value = 0;

      inputSourceNodeRef.current = source;
      inputProcessorNodeRef.current = processor;
      inputSinkGainRef.current = sinkGain;

      source.connect(processor);
      processor.connect(sinkGain);
      sinkGain.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        const socket = socketRef.current;
        if (!isActiveRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
        if (!contextSyncAckRef.current) return;

        const input = e.inputBuffer.getChannelData(0);

        if (!hasSentSpeechStartRef.current) {
          let energy = 0;
          for (let i = 0; i < input.length; i++) { const s = input[i] || 0; energy += s * s; }
          const rms = Math.sqrt(energy / Math.max(input.length, 1));
          if (rms >= 0.02) speechFrameStreakRef.current += 1;
          else speechFrameStreakRef.current = Math.max(0, speechFrameStreakRef.current - 1);
          if (speechFrameStreakRef.current < 2) return;

          try {
            socket.send(JSON.stringify({ type: "user_speech_start" }));
            hasSentSpeechStartRef.current = true;
          } catch { return; }
        }

        const pcmData = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, input[i] || 0)) * 0x7fff;
        }
        socket.send(pcmData.buffer);
      };

      if (audioContext.state === "suspended") await audioContext.resume();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/agent/live`;
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        socketRef.current = socket;
        setIsActive(true);
        isActiveRef.current = true;
        setIsConnecting(false);
        currentRunId.current = startRun("Live Voice Session");
        contextSyncAckRef.current = false;
        hasSentSpeechStartRef.current = false;
        speechFrameStreakRef.current = 0;
        clearContextSyncRetryTimer();

        queueContextUpdate();
        void flushContextUpdateIfSafe(isModelTurnActiveRef.current, true, socket);

        const retryStartTs = Date.now();
        contextSyncRetryTimerRef.current = setInterval(() => {
          if (!isActiveRef.current || contextSyncAckRef.current) {
            clearContextSyncRetryTimer();
            return;
          }
          if (Date.now() - retryStartTs > 8000) {
            contextSyncAckRef.current = true;
            clearContextSyncRetryTimer();
            return;
          }
          queueContextUpdate();
          void flushContextUpdateIfSafe(isModelTurnActiveRef.current, true, socket);
        }, 800);
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "tool_call") {
              const toolCall = msg as ToolCallMessage;
              if (shouldApplyToolCall(toolCall, currentTurnIdRef.current)) {
                handleToolCall(toolCall.name, toolCall.args, toolCall.query_meta);
              }
              return;
            }
            if (msg.type === "text") { setTranscript(msg.content); return; }
            if (msg.type === "agent_activity") { if (msg.step) upsertStep(msg.step); return; }
            if (msg.type === "turn_state") { handleTurnState(msg as TurnStateMessage); return; }
            if (msg.type === "context_sync") {
              contextSyncAckRef.current = true;
              clearContextSyncRetryTimer();
              return;
            }
          } catch (e) {
            console.error("[ERROR] Failed to parse websocket message:", e);
          }
          return;
        }

        if (!isModelTurnActiveRef.current || !currentTurnIdRef.current) return;
        enqueueAudioChunk(event.data as ArrayBuffer, currentTurnIdRef.current, setIsSpeaking);
      };

      socket.onerror = () => {
        setError("Connection error. Check server status.");
        shutdownLive("WebSocket error", { closeSocket: true });
      };

      socket.onclose = () => {
        shutdownLive("WebSocket closed by server", { closeSocket: false });
      };

      socketRef.current = socket;
    } catch (err: any) {
      setError(err.message || "Failed to start live session");
      shutdownLive("Startup failure cleanup", { closeSocket: true });
    }
  };

  const toggleLive = () => {
    if (isActive) shutdownLive("User requested stop", { closeSocket: true });
    else void startLive();
  };

  // --- Effects ---
  const tilesSnapshot = useDashboardStore((s) => s.tiles);

  useEffect(() => {
    if (!isActive) return;
    const msSinceToolMutation = Date.now() - lastToolMutationAtRef.current;
    if (msSinceToolMutation >= 0 && msSinceToolMutation < 4000) {
      clearContextTimer();
      return;
    }
    queueContextUpdate();
    scheduleContextFlush(isModelTurnActiveRef.current, isActiveRef.current, socketRef.current);
    return () => { clearContextTimer(); };
  }, [tilesSnapshot, isActive]);

  useEffect(() => {
    return () => { shutdownLive("Component unmounted", { closeSocket: true }); };
  }, []);

  // --- Render ---
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-8 h-full bg-gradient-to-b from-transparent to-muted/20 rounded-xl">
      <div className="relative flex flex-col items-center gap-6">
        <button
          onClick={toggleLive}
          disabled={isConnecting}
          aria-label={isActive ? "Stop voice agent" : "Start voice agent"}
          className={`group relative p-8 rounded-full shadow-lg border transition-colors duration-200 z-10 ${
            isActive
              ? (isSpeaking ? "bg-blue-600 border-blue-600" : "bg-red-500 border-red-500 hover:bg-red-600")
              : (isConnecting ? "bg-muted border-muted-foreground/20 opacity-80" : "bg-blue-600 border-blue-600 hover:bg-blue-700")
          }`}
        >
          {isActive ? (
            <MicOff className="w-10 h-10 text-white relative z-10" />
          ) : (
            <Mic className="w-10 h-10 text-white relative z-10" />
          )}
        </button>

        <div className="flex flex-col items-center gap-2">
          <h3 className={`text-lg font-bold ${error ? "text-red-500" : "text-foreground"}`}>
            {isActive
              ? (isSpeaking ? "Agent Speaking" : "Listening...")
              : (isConnecting ? "Connecting..." : (error ? "Startup Failed" : "Start Voice Agent"))}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-[200px]">
            {error
              ? error
              : (isActive
                ? (isSpeaking ? "Model is responding to your query" : "Talk naturally to explore your data")
                : (isConnecting ? "Initializing microphone and session" : "Real-time voice interaction for BI insights"))}
          </p>
          {isConnecting && (
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
          )}
        </div>
      </div>

      {isActive && transcript && (
        <div className="w-full max-w-sm p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl animate-in fade-in slide-in-from-bottom-4">
          <p className="text-sm text-foreground font-medium text-center italic">{transcript}</p>
        </div>
      )}
    </div>
  );
};

export default LiveAgent;
