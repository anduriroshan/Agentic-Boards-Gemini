import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StepPhase = "thinking" | "call" | "result" | "final";
export type StepStatus = "running" | "done" | "error";

export interface AgentStep {
  step_id: string;
  phase: StepPhase;
  agent: string;
  icon: string;
  tool?: string;
  summary: string;
  input_summary?: string;
  output_summary?: string;
  status: StepStatus;
  elapsed_ms?: number;
  ts: number;
}

export interface AgentRun {
  id: string;
  user_message: string;
  steps: AgentStep[];
  status: "running" | "done" | "error";
  started_at: number;
}

export interface AgentSession {
  id: string;
  label: string;
  runs: AgentRun[];
  status: "running" | "done" | "error" | "idle";
  started_at: number;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface AgentActivityState {
  sessions: AgentSession[];
  activeConnection: "databricks" | "bigquery";
  setActiveConnection: (connection: "databricks" | "bigquery") => void;
  newSession: () => void;
  startRun: (message: string) => string;
  upsertStep: (step: AgentStep) => void;
  finishRun: (status?: "done" | "error") => void;
}

function makeSession(): AgentSession {
  return {
    id: crypto.randomUUID(),
    label: "",
    runs: [],
    status: "idle",
    started_at: Date.now(),
  };
}

export const useAgentStore = create<AgentActivityState>((set) => ({
  sessions: [makeSession()],
  activeConnection: "databricks",

  setActiveConnection: (connection) => set({ activeConnection: connection }),

  newSession: () => {
    set((s) => {
      const current = s.sessions[s.sessions.length - 1] as AgentSession;
      if (!current || current.runs.length === 0) return s;
      return { sessions: [...s.sessions, makeSession()] };
    });
  },

  startRun: (message) => {
    const id = crypto.randomUUID();
    const run: AgentRun = {
      id,
      user_message: message,
      steps: [],
      status: "running",
      started_at: Date.now(),
    };
    set((s) => {
      const sessions = [...s.sessions];
      const lastIdx = sessions.length - 1;
      const last = { ...(sessions[lastIdx] as AgentSession) };
      last.runs = [...last.runs, run];
      last.status = "running";
      if (!last.label) last.label = message;
      sessions[lastIdx] = last;
      return { sessions };
    });
    return id;
  },

  upsertStep: (step) => {
    set((s) => {
      const sessions = [...s.sessions];
      const lastSessIdx = sessions.length - 1;
      const lastSess = { ...(sessions[lastSessIdx] as AgentSession) };
      if (lastSess.runs.length === 0) return s;

      const runs = [...lastSess.runs];
      const lastRunIdx = runs.length - 1;
      const lastRun = { ...(runs[lastRunIdx] as AgentRun) };
      const steps = [...lastRun.steps];
      const idx = steps.findIndex((st) => st.step_id === step.step_id);

      if (idx >= 0) {
        const existing = steps[idx] as AgentStep;
        steps[idx] = {
          ...existing,
          ...step,
          input_summary: existing.input_summary ?? existing.summary,
          output_summary:
            step.phase === "result" ? step.summary : existing.output_summary,
        };
      } else {
        steps.push({
          ...step,
          input_summary: step.phase === "call" ? step.summary : undefined,
        });
      }

      lastRun.steps = steps;
      runs[lastRunIdx] = lastRun;
      lastSess.runs = runs;
      sessions[lastSessIdx] = lastSess;
      return { sessions };
    });
  },

  finishRun: (status = "done") => {
    set((s) => {
      const sessions = [...s.sessions];
      const lastSessIdx = sessions.length - 1;
      const lastSess = { ...(sessions[lastSessIdx] as AgentSession) };
      if (lastSess.runs.length === 0) return s;

      const runs = [...lastSess.runs];
      const lastRunIdx = runs.length - 1;
      runs[lastRunIdx] = { ...(runs[lastRunIdx] as AgentRun), status };
      lastSess.runs = runs;
      lastSess.status = status;
      sessions[lastSessIdx] = lastSess;
      return { sessions };
    });
  },
}));
