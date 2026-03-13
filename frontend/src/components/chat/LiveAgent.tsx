import React, { useState, useRef } from "react";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useDashboardStore } from "@/stores/dashboardStore";

const LiveAgent: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const { addTile, addTableTile, addKpiTile, addTextTile, updateTileLayouts, removeTile } = useDashboardStore();

  const toggleLive = () => {
    if (isActive) {
      stopLive();
    } else {
      startLive();
    }
  };

  const startLive = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const socket = new WebSocket(`ws://${window.location.host}/api/agent/live`);
      
      socket.onopen = () => {
        logger("Connected to Live Agent");
        setIsActive(true);
        
        const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };
        
        mediaRecorder.start(100); // 100ms chunks
      };

      socket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data);
          if (msg.type === "tool_call") {
            handleToolCall(msg);
          }
        } else {
          // Received audio data
          playAudio(event.data);
        }
      };

      socket.onclose = () => {
        stopLive();
      };

      socketRef.current = socket;
    } catch (err) {
      console.error("Failed to start live session:", err);
    }
  };

  const stopLive = () => {
    socketRef.current?.close();
    mediaRecorderRef.current?.stop();
    setIsActive(false);
    setIsSpeaking(false);
  };

  const handleToolCall = (msg: any) => {
    const { name, args } = msg;
    console.log("[LIVE] Tool call:", name, args);
    
    switch (name) {
      case "create_visualization":
        addTile(args.tile_id || crypto.randomUUID(), args.vega_lite_spec, "Generated Chart");
        break;
      case "create_data_table":
        addTableTile(args.tile_id || crypto.randomUUID(), { columns: JSON.parse(args.columns), rows: JSON.parse(args.rows) }, args.title);
        break;
      case "create_kpi_tile":
        addKpiTile(args.tile_id || crypto.randomUUID(), { value: args.value, subtitle: args.subtitle, color: args.color, sparkline: args.sparkline_data ? JSON.parse(args.sparkline_data) : undefined }, args.title);
        break;
      case "create_text_tile":
        addTextTile(args.tile_id || crypto.randomUUID(), args.markdown, args.title);
        break;
      case "modify_dashboard":
        const mods = JSON.parse(args.modifications);
        if (mods.layout_updates) updateTileLayouts(mods.layout_updates);
        // Handle other updates if needed
        break;
      case "remove_tiles":
        args.tile_ids.forEach((id: string) => removeTile(id));
        break;
      default:
        console.warn("Unknown tool call from live agent:", name);
    }
  };

  const playAudio = async (data: Blob) => {
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const arrayBuffer = await data.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    setIsSpeaking(true);
    source.onended = () => setIsSpeaking(false);
    source.start();
  };

  const logger = (msg: string) => console.log(`[LiveAgent] ${msg}`);

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-4">
      {isActive && (
        <div className="px-6 py-3 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-blue-400 animate-pulse' : 'bg-green-400'}`} />
            <span className="text-sm font-medium text-white/90">
                {isSpeaking ? "Agent is speaking..." : "Listening..."}
            </span>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-white/70" />}
          </button>
        </div>
      )}

      <button
        onClick={toggleLive}
        className={`group relative p-4 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 ${
          isActive 
            ? 'bg-red-500 hover:bg-red-600' 
            : 'bg-gradient-to-tr from-blue-600 to-indigo-600 hover:shadow-blue-500/25'
        }`}
      >
        <div className={`absolute inset-0 rounded-full bg-inherit transition-all duration-300 group-hover:blur-md opacity-50`} />
        {isActive ? (
          <MicOff className="w-6 h-6 text-white relative z-10" />
        ) : (
          <Mic className="w-6 h-6 text-white relative z-10" />
        )}
      </button>
    </div>
  );
};

export default LiveAgent;
