import { useRef, useCallback } from "react";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useAgentStore } from "@/stores/agentStore";

export function useContextSync() {
  const pendingContextPayloadRef = useRef<Record<string, unknown> | null>(null);
  const pendingContextHashRef = useRef<string | null>(null);
  const lastSentContextHashRef = useRef<string | null>(null);
  const contextDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextSyncRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contextSyncAckRef = useRef(false);

  const clearContextTimer = useCallback(() => {
    if (contextDebounceTimerRef.current) {
      clearTimeout(contextDebounceTimerRef.current);
      contextDebounceTimerRef.current = null;
    }
  }, []);

  const clearContextSyncRetryTimer = useCallback(() => {
    if (contextSyncRetryTimerRef.current) {
      clearInterval(contextSyncRetryTimerRef.current);
      contextSyncRetryTimerRef.current = null;
    }
  }, []);

  const buildContextPayload = useCallback(() => {
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
            vegaSpec: t.vegaSpec ? {
              ...t.vegaSpec,
              data: (t.vegaSpec.data as any)?.values
                ? { ...t.vegaSpec.data, values: (t.vegaSpec.data as any).values.slice(0, 20) }
                : t.vegaSpec.data,
            } : undefined,
          }
          : {}),
        ...(t.type === "kpi" ? { kpiData: t.kpiData, value: t.kpiData?.value } : {}),
        ...(t.type === "table"
          ? {
            column_count: t.tableData?.columns?.length || 0,
            row_count: t.tableData?.rows?.length || 0,
            columns: t.tableData?.columns?.map((c) => c.headerName || c.field),
            rows: t.tableData?.rows?.slice(0, 20) || [],
          }
          : {}),
        ...(t.type === "text" ? { markdown: t.textData?.markdown } : {}),
      })),
    };
  }, []);

  const queueContextUpdate = useCallback(() => {
    const payload = buildContextPayload();
    const payloadHash = JSON.stringify(payload);
    if (payloadHash === lastSentContextHashRef.current || payloadHash === pendingContextHashRef.current) return;
    pendingContextPayloadRef.current = payload;
    pendingContextHashRef.current = payloadHash;
  }, [buildContextPayload]);

  const flushContextUpdateIfSafe = useCallback(async (
    isModelTurnActive: boolean,
    isActive: boolean,
    socket: WebSocket | null,
  ) => {
    if (isModelTurnActive || !isActive) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!pendingContextPayloadRef.current || !pendingContextHashRef.current) return;
    try {
      socket.send(JSON.stringify(pendingContextPayloadRef.current));
      lastSentContextHashRef.current = pendingContextHashRef.current;
      pendingContextPayloadRef.current = null;
      pendingContextHashRef.current = null;
    } catch (e) {
      console.error("[ERROR] Failed to send context_update:", e);
    }
  }, []);

  const scheduleContextFlush = useCallback((
    isModelTurnActive: boolean,
    isActive: boolean,
    socket: WebSocket | null,
  ) => {
    clearContextTimer();
    contextDebounceTimerRef.current = setTimeout(() => {
      void flushContextUpdateIfSafe(isModelTurnActive, isActive, socket);
    }, 1000);
  }, [clearContextTimer, flushContextUpdateIfSafe]);

  const resetContextState = useCallback(() => {
    pendingContextPayloadRef.current = null;
    pendingContextHashRef.current = null;
    lastSentContextHashRef.current = null;
    contextSyncAckRef.current = false;
  }, []);

  return {
    contextSyncAckRef,
    contextSyncRetryTimerRef,
    clearContextTimer,
    clearContextSyncRetryTimer,
    buildContextPayload,
    queueContextUpdate,
    flushContextUpdateIfSafe,
    scheduleContextFlush,
    resetContextState,
  };
}
