import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useAgentStore } from "@/stores/agentStore";

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
  const outputAudioContextRef = useRef<AudioContext | null>(null);

  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const inputSinkGainRef = useRef<GainNode | null>(null);

  const decodeQueueRef = useRef<Array<{ data: ArrayBuffer; turnId: string | null }>>([]);
  const audioQueue = useRef<AudioBuffer[]>([]);
  const isDecodeProcessingRef = useRef(false);
  const isQueueProcessing = useRef(false);

  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentPlaybackResolveRef = useRef<(() => void) | null>(null);
  const playbackGenerationRef = useRef(0);

  const isActiveRef = useRef(false);
  const isModelTurnActiveRef = useRef(false);
  const currentTurnIdRef = useRef<string | null>(null);
  const isShuttingDownRef = useRef(false);

  const pendingContextPayloadRef = useRef<Record<string, unknown> | null>(null);
  const pendingContextHashRef = useRef<string | null>(null);
  const lastSentContextHashRef = useRef<string | null>(null);
  const contextDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedToolCallKeysRef = useRef<Set<string>>(new Set());
  const lastToolMutationAtRef = useRef(0);

  const {
    addTile,
    addTableTile,
    addKpiTile,
    addTextTile,
    updateTile,
    updateTableTile,
    updateTileTitle,
    updateTextTile,
    updateTileLayouts,
    removeTile,
  } = useDashboardStore();

  const { startRun, upsertStep, finishRun } = useAgentStore();
  const currentRunId = useRef<string | null>(null);

  const logger = (msg: string) => console.log(`[LiveAgent] ${msg}`);

  const clearContextTimer = () => {
    if (contextDebounceTimerRef.current) {
      clearTimeout(contextDebounceTimerRef.current);
      contextDebounceTimerRef.current = null;
    }
  };

  const markToolMutation = () => {
    lastToolMutationAtRef.current = Date.now();
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

  const writeString = (view: DataView, offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  const interruptAudio = () => {
    playbackGenerationRef.current += 1;

    if (currentPlaybackResolveRef.current) {
      currentPlaybackResolveRef.current();
      currentPlaybackResolveRef.current = null;
    }

    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null;
        currentSourceRef.current.stop();
      } catch {
        // noop
      }
      currentSourceRef.current = null;
    }

    decodeQueueRef.current = [];
    audioQueue.current = [];
    isQueueProcessing.current = false;
    setIsSpeaking(false);
  };

  const decodeAudioChunk = async (data: ArrayBuffer): Promise<AudioBuffer | null> => {
    try {
      if (!outputAudioContextRef.current || outputAudioContextRef.current.state === "closed") {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        logger("[AUDIO] Created output AudioContext at 24kHz");
      }

      if (outputAudioContextRef.current.state === "suspended") {
        await outputAudioContextRef.current.resume();
      }

      const wavHeader = createWavHeader(data.byteLength, 24000);
      const wavBlob = new Blob([wavHeader, data], { type: "audio/wav" });
      const wavArrayBuffer = await wavBlob.arrayBuffer();

      if (!outputAudioContextRef.current) {
        return null;
      }

      return await outputAudioContextRef.current.decodeAudioData(wavArrayBuffer);
    } catch (e) {
      console.error("[ERROR] Failed to decode audio chunk:", e);
      return null;
    }
  };

  const processQueue = async () => {
    if (isQueueProcessing.current || audioQueue.current.length === 0) {
      return;
    }

    isQueueProcessing.current = true;
    const myGeneration = playbackGenerationRef.current;

    try {
      while (audioQueue.current.length > 0) {
        if (playbackGenerationRef.current !== myGeneration) {
          break;
        }

        const audioBuffer = audioQueue.current.shift();
        if (!audioBuffer || !outputAudioContextRef.current) {
          continue;
        }

        if (currentSourceRef.current) {
          try {
            currentSourceRef.current.onended = null;
            currentSourceRef.current.stop();
          } catch {
            // noop
          }
        }

        const source = outputAudioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputAudioContextRef.current.destination);
        currentSourceRef.current = source;
        setIsSpeaking(true);

        await new Promise<void>((resolve) => {
          currentPlaybackResolveRef.current = resolve;
          source.onended = () => {
            if (currentPlaybackResolveRef.current === resolve) {
              currentPlaybackResolveRef.current = null;
            }
            if (currentSourceRef.current === source) {
              currentSourceRef.current = null;
            }
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

  const decodeAudioQueue = async () => {
    if (isDecodeProcessingRef.current) {
      return;
    }

    isDecodeProcessingRef.current = true;

    try {
      while (decodeQueueRef.current.length > 0) {
        const next = decodeQueueRef.current.shift();
        if (!next) {
          continue;
        }

        if (!next.turnId || next.turnId !== currentTurnIdRef.current) {
          logger("[AUDIO] Dropped stale chunk due to turn mismatch");
          continue;
        }

        const audioBuffer = await decodeAudioChunk(next.data);
        if (!audioBuffer) {
          continue;
        }

        if (next.turnId !== currentTurnIdRef.current) {
          logger("[AUDIO] Dropped decoded stale chunk due to turn mismatch");
          continue;
        }

        audioQueue.current.push(audioBuffer);
        void processQueue();
      }
    } finally {
      isDecodeProcessingRef.current = false;
      if (decodeQueueRef.current.length > 0) {
        void decodeAudioQueue();
      }
    }
  };

  const enqueueAudioChunk = (data: ArrayBuffer, turnId: string | null) => {
    decodeQueueRef.current.push({ data: data.slice(0), turnId });
    void decodeAudioQueue();
  };

  const buildContextPayload = () => {
    const { tiles } = useDashboardStore.getState();
    return {
      type: "context_update",
      database_provider: useAgentStore.getState().activeConnection,
      tiles: tiles.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        layout: t.layout,
        ...(t.type === "chart"
          ? {
            vegaSpec: {
              ...t.vegaSpec,
              data: t.vegaSpec?.data ? { ...t.vegaSpec.data, values: undefined } : undefined,
            },
          }
          : {}),
        ...(t.type === "kpi" ? { kpiData: t.kpiData } : {}),
        ...(t.type === "table"
          ? {
            column_count: t.tableData?.columns?.length || 0,
            row_count: t.tableData?.rows?.length || 0,
            columns: t.tableData?.columns?.map((c) => c.headerName || c.field),
          }
          : {}),
        ...(t.type === "text" ? { markdown: t.textData?.markdown } : {}),
      })),
    };
  };

  const queueContextUpdate = () => {
    const payload = buildContextPayload();
    const payloadHash = JSON.stringify(payload);

    if (payloadHash === lastSentContextHashRef.current || payloadHash === pendingContextHashRef.current) {
      return;
    }

    pendingContextPayloadRef.current = payload;
    pendingContextHashRef.current = payloadHash;
  };

  const flushContextUpdateIfSafe = async () => {
    if (isModelTurnActiveRef.current || !isActiveRef.current) {
      return;
    }

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!pendingContextPayloadRef.current || !pendingContextHashRef.current) {
      return;
    }

    try {
      socket.send(JSON.stringify(pendingContextPayloadRef.current));
      lastSentContextHashRef.current = pendingContextHashRef.current;
      pendingContextPayloadRef.current = null;
      pendingContextHashRef.current = null;
      logger("[CONTEXT] Flushed context_update at safe boundary");
    } catch (e) {
      console.error("[ERROR] Failed to send context_update:", e);
    }
  };

  const scheduleContextFlush = () => {
    clearContextTimer();
    contextDebounceTimerRef.current = setTimeout(() => {
      void flushContextUpdateIfSafe();
    }, 1000);
  };

  const shutdownLive = (reason: string, opts: { closeSocket?: boolean } = {}) => {
    if (isShuttingDownRef.current) {
      return;
    }

    isShuttingDownRef.current = true;
    const closeSocket = opts.closeSocket ?? true;
    logger(`[STOP] ${reason}`);

    clearContextTimer();

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (closeSocket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close();
        } catch {
          // noop
        }
      }
    }

    interruptAudio();

    if (inputProcessorNodeRef.current) {
      try {
        inputProcessorNodeRef.current.onaudioprocess = null;
        inputProcessorNodeRef.current.disconnect();
      } catch {
        // noop
      }
      inputProcessorNodeRef.current = null;
    }

    if (inputSourceNodeRef.current) {
      try {
        inputSourceNodeRef.current.disconnect();
      } catch {
        // noop
      }
      inputSourceNodeRef.current = null;
    }

    if (inputSinkGainRef.current) {
      try {
        inputSinkGainRef.current.disconnect();
      } catch {
        // noop
      }
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

    if (outputAudioContextRef.current) {
      void outputAudioContextRef.current.close().catch(() => undefined);
      outputAudioContextRef.current = null;
    }

    currentTurnIdRef.current = null;
    isModelTurnActiveRef.current = false;
    isActiveRef.current = false;

    pendingContextPayloadRef.current = null;
    pendingContextHashRef.current = null;
    processedToolCallKeysRef.current.clear();
    lastToolMutationAtRef.current = 0;

    setIsActive(false);
    setIsConnecting(false);
    setIsSpeaking(false);

    if (currentRunId.current) {
      finishRun();
      currentRunId.current = null;
    }

    isShuttingDownRef.current = false;
  };

  const stopLive = () => {
    shutdownLive("User requested stop", { closeSocket: true });
  };

  const tryParse = (val: any) => {
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        console.warn("[LIVE] Failed to parse JSON:", val);
        return val;
      }
    }
    return val;
  };

  const handleToolCall = (name: string, args: any, queryMeta?: any) => {
    console.log("[LIVE] Tool call:", name, args, "queryMeta:", queryMeta);

    const normalizeColumns = (cols: any) => {
      const parsed = tryParse(cols);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((c) => {
        if (typeof c === "string") return { field: c, headerName: c };
        return {
          field: c.field || c.headerName || "unknown",
          headerName: c.headerName || c.field || "Unknown",
        };
      });
    };

    switch (name) {
      case "create_visualization":
        addTile(args.tile_id || crypto.randomUUID(), tryParse(args.vega_lite_spec), "Generated Chart", queryMeta);
        markToolMutation();
        break;
      case "create_data_table":
        addTableTile(
          args.tile_id || crypto.randomUUID(),
          { columns: normalizeColumns(args.columns), rows: tryParse(args.rows) },
          args.title || "Data Table",
          queryMeta,
        );
        markToolMutation();
        break;
      case "update_data_table":
        updateTableTile(
          args.tile_id,
          { columns: normalizeColumns(args.columns), rows: tryParse(args.rows) },
          args.title,
        );
        markToolMutation();
        break;
      case "create_kpi_tile":
        addKpiTile(
          args.tile_id || crypto.randomUUID(),
          {
            value: args.value,
            subtitle: args.subtitle,
            color: args.color,
            sparkline: args.sparkline_data ? tryParse(args.sparkline_data) : undefined,
          },
          args.title || "KPI",
        );
        markToolMutation();
        break;
      case "create_text_tile":
        addTextTile(args.tile_id || crypto.randomUUID(), args.markdown, args.title || "Notes");
        markToolMutation();
        break;
      case "modify_dashboard": {
        const mods = tryParse(args.modifications);
        if (!mods || typeof mods !== "object") {
          logger("[MODIFY] Invalid modifications payload (non-object)");
          break;
        }

        const existingIds = new Set(useDashboardStore.getState().tiles.map((t) => t.id));
        let requestedOps = 0;
        let appliedOps = 0;
        const missingIds: string[] = [];

        const recordMissing = (tileId?: string) => {
          if (tileId && !missingIds.includes(tileId)) {
            missingIds.push(tileId);
          }
        };

        const layoutUpdatesRaw = Array.isArray(mods.layout_updates) ? mods.layout_updates : [];
        requestedOps += layoutUpdatesRaw.length;
        const layoutUpdates = layoutUpdatesRaw.filter((u: { tile_id?: string }) => {
          const found = !!u.tile_id && existingIds.has(u.tile_id);
          if (!found) recordMissing(u.tile_id);
          return found;
        });
        if (layoutUpdates.length > 0) {
          updateTileLayouts(layoutUpdates);
          appliedOps += layoutUpdates.length;
        }

        const titleUpdates = Array.isArray(mods.title_updates) ? mods.title_updates : [];
        requestedOps += titleUpdates.length;
        titleUpdates.forEach((u: { tile_id: string; title: string }) => {
          if (!existingIds.has(u.tile_id)) {
            recordMissing(u.tile_id);
            return;
          }
          updateTileTitle(u.tile_id, u.title);
          appliedOps += 1;
        });

        const specUpdates = Array.isArray(mods.spec_updates) ? mods.spec_updates : [];
        requestedOps += specUpdates.length;
        specUpdates.forEach((u: { tile_id: string; vega_spec: any }) => {
          if (!existingIds.has(u.tile_id)) {
            recordMissing(u.tile_id);
            return;
          }
          updateTile(u.tile_id, tryParse(u.vega_spec));
          appliedOps += 1;
        });

        const kpiUpdates = Array.isArray(mods.kpi_updates) ? mods.kpi_updates : [];
        requestedOps += kpiUpdates.length;
        kpiUpdates.forEach((u: { tile_id: string; value?: string; subtitle?: string; color?: string }) => {
          if (!existingIds.has(u.tile_id)) {
            recordMissing(u.tile_id);
            return;
          }
          addKpiTile(
            u.tile_id,
            {
              value: u.value || "",
              subtitle: u.subtitle || "",
              color: u.color || "",
            },
            "",
          );
          appliedOps += 1;
        });

        const textUpdates = Array.isArray(mods.text_updates) ? mods.text_updates : [];
        requestedOps += textUpdates.length;
        textUpdates.forEach((u: { tile_id: string; markdown: string }) => {
          if (!existingIds.has(u.tile_id)) {
            recordMissing(u.tile_id);
            return;
          }
          updateTextTile(u.tile_id, u.markdown);
          appliedOps += 1;
        });

        if (requestedOps > 0 && appliedOps === 0) {
          const missingInfo = missingIds.length > 0 ? ` Missing tile IDs: ${missingIds.join(", ")}` : "";
          logger(`[MODIFY] No dashboard updates applied.${missingInfo}`);
          upsertStep({
            step_id: crypto.randomUUID(),
            phase: "result",
            agent: "DashboardAgent",
            icon: "layout",
            summary: `No matching tiles found for modify request.${missingInfo}`.slice(0, 200),
            status: "done",
            ts: Date.now(),
          });
        } else {
          logger(`[MODIFY] Applied ${appliedOps}/${requestedOps} requested updates`);
          if (appliedOps > 0) {
            markToolMutation();
          }
        }
        break;
      }
      case "remove_tiles": {
        const tileIds = tryParse(args.tile_ids);
        let removed = 0;
        if (Array.isArray(tileIds)) {
          tileIds.forEach((id: string) => {
            removeTile(id);
            removed += 1;
          });
        } else if (typeof tileIds === "string") {
          removeTile(tileIds);
          removed += 1;
        }
        if (removed > 0) {
          markToolMutation();
        }
        break;
      }
      default:
        console.warn("Unknown tool call from live agent:", name);
    }
  };

  const shouldApplyToolCall = (msg: ToolCallMessage) => {
    const turnId = msg.turn_id || currentTurnIdRef.current || "turn_unknown";
    if (msg.turn_id && currentTurnIdRef.current && msg.turn_id !== currentTurnIdRef.current) {
      logger(`[TOOL] Ignored stale tool_call for ${msg.turn_id}; current turn is ${currentTurnIdRef.current}`);
      return false;
    }

    const identity =
      msg.tool_call_key
      || msg.tool_call_id
      || `${msg.name}:${JSON.stringify(msg.args ?? {})}`;
    const dedupeKey = `${turnId}:${identity}`;

    if (processedToolCallKeysRef.current.has(dedupeKey)) {
      logger(`[TOOL] Skipped duplicate tool_call ${dedupeKey}`);
      return false;
    }

    processedToolCallKeysRef.current.add(dedupeKey);
    if (processedToolCallKeysRef.current.size > 2000) {
      processedToolCallKeysRef.current.clear();
    }
    return true;
  };

  const handleTurnState = (msg: TurnStateMessage) => {
    const incomingTurnId = typeof msg.turn_id === "string" ? msg.turn_id : null;

    switch (msg.state) {
      case "model_start": {
        if (incomingTurnId && incomingTurnId !== currentTurnIdRef.current) {
          interruptAudio();
          logger(`[TURN] model_start ${incomingTurnId} (barge-in interrupt)`);
          processedToolCallKeysRef.current.clear();
        }
        if (incomingTurnId) {
          currentTurnIdRef.current = incomingTurnId;
        }
        isModelTurnActiveRef.current = true;
        break;
      }
      case "model_end": {
        if (!incomingTurnId || !currentTurnIdRef.current || incomingTurnId === currentTurnIdRef.current) {
          isModelTurnActiveRef.current = false;
          if (audioQueue.current.length === 0 && decodeQueueRef.current.length === 0) {
            setIsSpeaking(false);
          }
          void flushContextUpdateIfSafe();
        }
        logger(`[TURN] model_end ${incomingTurnId || "unknown"}`);
        break;
      }
      case "interrupted": {
        if (!incomingTurnId || !currentTurnIdRef.current || incomingTurnId === currentTurnIdRef.current) {
          interruptAudio();
          isModelTurnActiveRef.current = false;
          void flushContextUpdateIfSafe();
        }
        logger(`[TURN] interrupted ${incomingTurnId || "unknown"}`);
        break;
      }
      case "tool_start":
      case "tool_end": {
        logger(`[TURN] ${msg.state} ${incomingTurnId || "unknown"} ${msg.tool || ""}`);
        break;
      }
      default:
        break;
    }
  };

  const startLive = async () => {
    if (isConnecting || isActiveRef.current) {
      return;
    }

    setError(null);
    setIsConnecting(true);

    try {
      logger("Starting live session...");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not supported on this origin or browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputStreamRef.current = stream;
      logger("Microphone access granted");

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
        if (!isActiveRef.current || !socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        const input = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, input[i] || 0)) * 0x7fff;
        }

        socket.send(pcmData.buffer);
      };

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/agent/live`;
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        logger("Connected to Live Agent");
        socketRef.current = socket;
        setIsActive(true);
        isActiveRef.current = true;
        setIsConnecting(false);
        currentRunId.current = startRun("Live Voice Session");

        queueContextUpdate();
        void flushContextUpdateIfSafe();
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "tool_call") {
              const toolCall = msg as ToolCallMessage;
              if (shouldApplyToolCall(toolCall)) {
                handleToolCall(toolCall.name, toolCall.args, toolCall.query_meta);
              }
              return;
            }

            if (msg.type === "text") {
              setTranscript(msg.content);
              return;
            }

            if (msg.type === "agent_activity") {
              if (msg.step) upsertStep(msg.step);
              return;
            }

            if (msg.type === "turn_state") {
              handleTurnState(msg as TurnStateMessage);
            }
          } catch (e) {
            console.error("[ERROR] Failed to parse websocket message:", e);
          }
          return;
        }

        if (!isModelTurnActiveRef.current || !currentTurnIdRef.current) {
          logger("[AUDIO] Dropped chunk without active model turn");
          return;
        }

        enqueueAudioChunk(event.data as ArrayBuffer, currentTurnIdRef.current);
      };

      socket.onerror = () => {
        logger("WebSocket error encountered");
        setError("Connection error. Check server status.");
        shutdownLive("WebSocket error", { closeSocket: true });
      };

      socket.onclose = () => {
        logger("WebSocket closed");
        shutdownLive("WebSocket closed by server", { closeSocket: false });
      };

      socketRef.current = socket;
    } catch (err: any) {
      logger(`Failed to start: ${err.message}`);
      setError(err.message || "Failed to start live session");
      shutdownLive("Startup failure cleanup", { closeSocket: true });
    }
  };

  const toggleLive = () => {
    if (isActive) {
      stopLive();
    } else {
      void startLive();
    }
  };

  const tilesSnapshot = useDashboardStore((s) => s.tiles);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const msSinceToolMutation = Date.now() - lastToolMutationAtRef.current;
    if (msSinceToolMutation >= 0 && msSinceToolMutation < 4000) {
      logger(`[CONTEXT] Suppressed auto context_update after tool mutation (${msSinceToolMutation}ms)`);
      return;
    }

    queueContextUpdate();
    scheduleContextFlush();

    return () => {
      clearContextTimer();
    };
  }, [tilesSnapshot, isActive]);

  useEffect(() => {
    return () => {
      shutdownLive("Component unmounted", { closeSocket: true });
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-8 h-full bg-gradient-to-b from-transparent to-muted/20 rounded-xl">
      <div className="relative flex flex-col items-center gap-6">
        {isActive && (
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className={`absolute w-32 h-32 rounded-full border-2 animate-ping [animation-duration:3s] ${isSpeaking ? "border-blue-500/30" : "border-blue-500/20"}`} />
            <div className={`absolute w-40 h-40 rounded-full border-2 animate-ping [animation-duration:4s] ${isSpeaking ? "border-blue-400/20" : "border-blue-400/10"}`} />
          </div>
        )}

        <button
          onClick={toggleLive}
          disabled={isConnecting}
          className={`group relative p-8 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 z-10 ${
            isActive
              ? (isSpeaking ? "bg-blue-600 animate-pulse shadow-blue-500/50" : "bg-red-500 hover:bg-red-600")
              : (isConnecting ? "bg-muted scale-95 opacity-50" : "bg-gradient-to-tr from-blue-600 to-indigo-600 hover:shadow-blue-500/25")
          }`}
        >
          <div className="absolute inset-0 rounded-full bg-inherit transition-all duration-300 group-hover:blur-xl opacity-50" />
          {isActive ? (
            <MicOff className="w-10 h-10 text-white relative z-10" />
          ) : (
            <Mic className={`w-10 h-10 text-white relative z-10 ${isConnecting ? "animate-spin" : ""}`} />
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
