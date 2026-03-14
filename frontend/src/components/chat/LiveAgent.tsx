import React, { useState, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useAgentStore } from "@/stores/agentStore";

const LiveAgent: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueue = useRef<AudioBuffer[]>([]);
  const isQueueProcessing = useRef(false);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  
  const { 
    addTile, addTableTile, addKpiTile, addTextTile, 
    updateTile, updateTableTile, updateTileTitle, updateTextTile, updateTileLayouts, 
    removeTile 
  } = useDashboardStore();
  const { startRun, upsertStep, finishRun } = useAgentStore();
  const currentRunId = useRef<string | null>(null);
  const isActiveRef = useRef(false);
  const isAgentProcessingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackGenerationRef = useRef(0); // monotonic counter — incremented on each interrupt

  const toggleLive = () => {
    if (isActive) {
      stopLive();
    } else {
      startLive();
    }
  };

  const startLive = async () => {
    setError(null);
    setIsConnecting(true);
    try {
      logger("Starting live session...");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not supported on this origin or browser.");
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        logger("Microphone access granted");
      } catch (e: any) {
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          throw new Error("Microphone permission denied. Please allow access in browser settings.");
        } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
          throw new Error("No microphone found. Please connect a recording device.");
        } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
          throw new Error("Could not start audio source. Your microphone might be in use by another app.");
        }
        throw e;
      }
      
      let audioContext: AudioContext;
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        logger("Created AudioContext at 16kHz");
      } catch (e) {
        logger("Failed to create AudioContext at 16kHz, falling back to default...");
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        logger(`Created fallback AudioContext at ${audioContext.sampleRate}Hz`);
      }
      
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      processor.onaudioprocess = (e) => {
        if (!isActiveRef.current || socketRef.current?.readyState !== WebSocket.OPEN) return;
        const pcmData = new Int16Array(e.inputBuffer.getChannelData(0).length);
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, input[i] || 0)) * 0x7FFF;
        }
        socketRef.current.send(pcmData.buffer);
      };
      
      if (audioContext.state === 'suspended') {
        logger("Resuming AudioContext...");
        await audioContext.resume();
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/agent/live`;
      logger(`Connecting to WebSocket: ${wsUrl}`);
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      
      socket.onopen = () => {
        logger("Connected to Live Agent");
        setIsActive(true);
        isActiveRef.current = true;
        setIsConnecting(false);
        currentRunId.current = startRun("Live Voice Session");
        // We skip the initial context send here because the useEffect below 
        // will trigger it immediately upon isActive becoming true.
      };

      socket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data);
          if (msg.type === "tool_call") {
            handleToolCall(msg.name, msg.args, msg.query_meta);
          } else if (msg.type === "text") {
            setTranscript(msg.content);
          } else if (msg.type === "agent_activity") {
            if (msg.step) upsertStep(msg.step);
          }
        } else {
          // Interrupt any currently playing audio before queuing new response
          if (isAgentProcessingRef.current && audioQueue.current.length > 2) {
            interruptAudio();
          }
          isAgentProcessingRef.current = true;
          playAudio(event.data);
        }
      };

      socket.onerror = (_err) => {
        logger(`WebSocket error encountered`);
        setError("Connection error. Check server status.");
        stopLive();
      };

      socket.onclose = () => {
        logger("WebSocket closed");
        stopLive();
      };

      socketRef.current = socket;
    } catch (err: any) {
      logger(`Failed to start: ${err.message}`);
      setError(err.message || "Failed to start live session");
      setIsConnecting(false);
      stopLive();
    }
  };

  // Sync dashboard context whenever tiles change (debounced, suppressed while agent is speaking)
  const tilesSnapshot = useDashboardStore((s) => s.tiles);
  React.useEffect(() => {
    if (!isActive || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

    const timer = setTimeout(() => {
      // Don't interrupt the agent mid-response — skip if it's currently speaking
      if (isAgentProcessingRef.current) return;
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      const { tiles } = useDashboardStore.getState();
      const context = {
        type: "context_update",
        database_provider: useAgentStore.getState().activeConnection,
        tiles: tiles.map(t => ({
          id: t.id,
          title: t.title,
          type: t.type,
          layout: t.layout,
          ...(t.type === 'chart' ? { 
            vegaSpec: { 
              ...t.vegaSpec, 
              data: t.vegaSpec?.data ? { ...t.vegaSpec.data, values: undefined } : undefined 
            } 
          } : {}),
          ...(t.type === 'kpi' ? { kpiData: t.kpiData } : {}),
          ...(t.type === 'table' ? { 
            column_count: t.tableData?.columns?.length || 0,
            row_count: t.tableData?.rows?.length || 0,
            columns: t.tableData?.columns?.map(c => c.headerName || c.field)
          } : {}),
          ...(t.type === 'text' ? { markdown: t.textData?.markdown } : {})
        }))
      };
      socketRef.current.send(JSON.stringify(context));
    }, 2000); // 2s debounce — collapses rapid tile additions, never fires mid-response

    return () => clearTimeout(timer);
  }, [tilesSnapshot, isActive]);

  const stopLive = () => {
    socketRef.current?.close();
    audioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    outputAudioContextRef.current = null;
    audioQueue.current = [];
    isQueueProcessing.current = false;
    setIsActive(false);
    isActiveRef.current = false;
    setIsConnecting(false);
    if (currentRunId.current) {
      finishRun();
      currentRunId.current = null;
    }
  };

  const tryParse = (val: any) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch (e) {
        console.warn("[LIVE] Failed to parse JSON:", val);
        return val;
      }
    }
    return val;
  };

  const handleToolCall = (name: string, args: any, queryMeta?: any) => {
    console.log("[LIVE] Tool call:", name, args, "queryMeta:", queryMeta);

    // Helper to ensure columns are in { field, headerName } format
    const normalizeColumns = (cols: any) => {
      const parsed = tryParse(cols);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(c => {
        if (typeof c === 'string') return { field: c, headerName: c };
        return {
          field: c.field || c.headerName || 'unknown',
          headerName: c.headerName || c.field || 'Unknown'
        };
      });
    };
    
    switch (name) {
      case "create_visualization":
        addTile(args.tile_id || crypto.randomUUID(), tryParse(args.vega_lite_spec), "Generated Chart", queryMeta);
        break;
      case "create_data_table":
        console.log("[LIVE] Creating table:", args.title);
        addTableTile(
          args.tile_id || crypto.randomUUID(), 
          { columns: normalizeColumns(args.columns), rows: tryParse(args.rows) }, 
          args.title || "Data Table",
          queryMeta
        );
        break;
      case "update_data_table":
        console.log("[LIVE] Updating table:", args.tile_id);
        updateTableTile(
          args.tile_id,
          { columns: normalizeColumns(args.columns), rows: tryParse(args.rows) },
          args.title
        );
        break;
      case "create_kpi_tile":
        addKpiTile(args.tile_id || crypto.randomUUID(), { value: args.value, subtitle: args.subtitle, color: args.color, sparkline: args.sparkline_data ? tryParse(args.sparkline_data) : undefined }, args.title || "KPI");
        break;
      case "create_text_tile":
        addTextTile(args.tile_id || crypto.randomUUID(), args.markdown, args.title || "Notes");
        break;
      case "modify_dashboard":
        const mods = tryParse(args.modifications);
        console.log("[LIVE] Modifying dashboard:", mods);
        if (mods.layout_updates) updateTileLayouts(mods.layout_updates);
        if (mods.title_updates) {
          mods.title_updates.forEach((u: { tile_id: string, title: string }) => updateTileTitle(u.tile_id, u.title));
        }
        if (mods.spec_updates) {
          mods.spec_updates.forEach((u: { tile_id: string, vega_spec: any }) => updateTile(u.tile_id, tryParse(u.vega_spec)));
        }
        if (mods.kpi_updates) {
          mods.kpi_updates.forEach((u: { tile_id: string, value?: string, subtitle?: string, color?: string }) => {
            // Use specialized KPI update in store if available, or just addKpiTile with existing ID
            addKpiTile(u.tile_id, { 
              value: u.value || "", 
              subtitle: u.subtitle || "", 
              color: u.color || "" 
            }, ""); // Title "" will be ignored if existing
          });
        }
        if (mods.text_updates) {
          mods.text_updates.forEach((u: { tile_id: string, markdown: string }) => updateTextTile(u.tile_id, u.markdown));
        }
        break;
      case "remove_tiles":
        const tileIds = tryParse(args.tile_ids);
        console.log("[LIVE] Removing tiles:", tileIds);
        if (Array.isArray(tileIds)) {
          tileIds.forEach((id: string) => removeTile(id));
        } else if (typeof tileIds === 'string') {
          removeTile(tileIds);
        }
        break;
      default:
        console.warn("Unknown tool call from live agent:", name);
    }
  };

  const playAudio = async (data: ArrayBuffer) => {
    // Use a dedicated output AudioContext at 24kHz (model output rate)
    // This is separate from the 16kHz input context used for mic recording.
    if (!outputAudioContextRef.current || outputAudioContextRef.current.state === 'closed') {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (outputAudioContextRef.current.state === 'suspended') {
      await outputAudioContextRef.current.resume();
    }
    
    // The Gemini Live API sends 24kHz Mono PCM
    const wavHeader = createWavHeader(data.byteLength, 24000);
    const wavBlob = new Blob([wavHeader, data], { type: "audio/wav" });
    const wavArrayBuffer = await wavBlob.arrayBuffer();

    try {
      if (!outputAudioContextRef.current) return;
      const audioBuffer = await outputAudioContextRef.current.decodeAudioData(wavArrayBuffer);
      audioQueue.current.push(audioBuffer);
      processQueue();
    } catch (e) {
      console.error("Failed to decode audio data:", e);
    }
  };

  const interruptAudio = () => {
    playbackGenerationRef.current++; // invalidates any currently running processQueue loop
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null;
        currentSourceRef.current.stop();
      } catch (_) { /* already stopped */ }
      currentSourceRef.current = null;
    }
    audioQueue.current = [];
    isQueueProcessing.current = false;
    setIsSpeaking(false);
  };

  const processQueue = async () => {
    if (isQueueProcessing.current || audioQueue.current.length === 0) return;
    isQueueProcessing.current = true;
    
    // Capture the generation at start — if it changes, this loop is stale and must exit
    const myGeneration = playbackGenerationRef.current;
    
    while (audioQueue.current.length > 0) {
      if (playbackGenerationRef.current !== myGeneration) break; // interrupted — exit
      
      const audioBuffer = audioQueue.current.shift();
      if (!audioBuffer || !outputAudioContextRef.current) continue;

      const source = outputAudioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputAudioContextRef.current.destination);
      currentSourceRef.current = source;
      setIsSpeaking(true);
      
      await new Promise<void>((resolve) => {
        source.onended = () => {
          if (playbackGenerationRef.current === myGeneration) {
            currentSourceRef.current = null;
            setIsSpeaking(false);
          }
          resolve();
        };
        source.start();
      });
    }
    
    // Only update state if this loop is still the current one
    if (playbackGenerationRef.current === myGeneration) {
      isQueueProcessing.current = false;
      isAgentProcessingRef.current = false;
    }
  };

  const createWavHeader = (dataLength: number, sampleRate: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // file length
    view.setUint32(4, 36 + dataLength, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (1 is PCM)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, dataLength, true);
    
    return header;
  };

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const logger = (msg: string) => console.log(`[LiveAgent] ${msg}`);

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-8 h-full bg-gradient-to-b from-transparent to-muted/20 rounded-xl">
      <div className="relative flex flex-col items-center gap-6">
        {/* Animated Rings when active */}
        {isActive && (
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className={`absolute w-32 h-32 rounded-full border-2 animate-ping [animation-duration:3s] ${isSpeaking ? 'border-blue-500/30' : 'border-blue-500/20'}`} />
            <div className={`absolute w-40 h-40 rounded-full border-2 animate-ping [animation-duration:4s] ${isSpeaking ? 'border-blue-400/20' : 'border-blue-400/10'}`} />
          </div>
        )}

        <button
          onClick={toggleLive}
          disabled={isConnecting}
          className={`group relative p-8 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 z-10 ${
            isActive 
              ? (isSpeaking ? 'bg-blue-600 animate-pulse shadow-blue-500/50' : 'bg-red-500 hover:bg-red-600') 
              : (isConnecting ? 'bg-muted scale-95 opacity-50' : 'bg-gradient-to-tr from-blue-600 to-indigo-600 hover:shadow-blue-500/25')
          }`}
        >
          <div className={`absolute inset-0 rounded-full bg-inherit transition-all duration-300 group-hover:blur-xl opacity-50`} />
          {isActive ? (
            <MicOff className="w-10 h-10 text-white relative z-10" />
          ) : (
            <Mic className={`w-10 h-10 text-white relative z-10 ${isConnecting ? 'animate-spin' : ''}`} />
          )}
        </button>

        <div className="flex flex-col items-center gap-2">
           <h3 className={`text-lg font-bold ${error ? 'text-red-500' : 'text-foreground'}`}>
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
           <p className="text-sm text-foreground font-medium text-center italic">
             {transcript}
           </p>
        </div>
      )}
    </div>
  );
};

export default LiveAgent;
