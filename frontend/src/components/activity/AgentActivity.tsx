import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentStep, AgentRun, AgentSession } from "@/stores/agentStore";
import { cn } from "@/lib/utils";

// ─── agent dot colours (light-mode friendly) ─────────────────────────────────

const AGENT_DOT: Record<string, string> = {
  Orchestrator: "bg-blue-500",
  DataAgent:    "bg-amber-500",
  VizAgent:     "bg-purple-500",
  DashboardAgent:"bg-emerald-500",
};

const LEGEND_ITEMS = [
  { label: "Orchestrator",   dot: "bg-blue-500" },
  { label: "DataAgent",      dot: "bg-amber-500" },
  { label: "VizAgent",       dot: "bg-purple-500" },
  { label: "DashboardAgent", dot: "bg-emerald-500" },
] as const;

// ─── Step row ────────────────────────────────────────────────────────────────

function StepRow({ step }: { step: AgentStep }) {
  const dot = AGENT_DOT[step.agent] ?? "bg-gray-400";
  const isCallOrResult = step.phase === "call" || step.phase === "result";
  const hasOutput = !!step.output_summary;

  return (
    <div className="flex gap-2.5 py-1.5 px-4 group hover:bg-gray-50 transition-colors">
      {/* coloured dot */}
      <div className="pt-1.5 shrink-0">
        <div className={cn("w-1.5 h-1.5 rounded-full", dot)} />
      </div>

      {/* text content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-700 leading-relaxed flex-1">
            {/* For call/result show tool name prefix */}
            {isCallOrResult && step.tool && (
              <span className="text-gray-400 font-mono mr-1">{step.tool}</span>
            )}
            {isCallOrResult
              ? (step.input_summary ?? step.summary)
              : step.summary}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {step.elapsed_ms !== undefined && step.elapsed_ms > 0 && (
              <span className="text-[10px] text-gray-400">
                {(step.elapsed_ms / 1000).toFixed(1)}s
              </span>
            )}
            {step.status === "running" && (
              <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
            )}
            {step.status === "done" && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            )}
            {step.status === "error" && (
              <XCircle className="w-3 h-3 text-red-400" />
            )}
          </div>
        </div>

        {/* output line */}
        {isCallOrResult && hasOutput && (
          <p className="text-[11px] text-gray-400 leading-relaxed pl-2 border-l border-gray-200">
            {step.output_summary}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Run block (one per user message) ────────────────────────────────────────

// isFirst=true means this run's message is already shown as the session header,
// so we skip the redundant sub-header.
function RunBlock({ run, isFirst }: { run: AgentRun; isFirst: boolean }) {
  const [open, setOpen] = useState(true);

  const steps = (
    <div>
      {run.steps.length === 0 ? (
        <p className="px-8 py-2 text-[11px] text-gray-400 italic">
          Waiting for agent…
        </p>
      ) : (
        run.steps.map((step) => <StepRow key={step.step_id} step={step} />)
      )}
    </div>
  );

  // First run — no sub-header, steps shown directly under the session header
  if (isFirst) {
    return <div className="border-b border-gray-100 last:border-0">{steps}</div>;
  }

  // Follow-up run — show collapsible sub-header with the follow-up message
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-4 py-1.5 text-left bg-gray-50/70 hover:bg-gray-100 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
        )}
        <span className="text-[11px] text-gray-500 truncate flex-1 italic">
          {run.user_message}
        </span>
        {run.status === "running" && (
          <Loader2 className="w-3 h-3 animate-spin text-gray-400 shrink-0" />
        )}
        {run.status === "done" && (
          <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
        )}
        {run.status === "error" && (
          <XCircle className="w-3 h-3 text-red-400 shrink-0" />
        )}
      </button>
      {open && steps}
    </div>
  );
}

// ─── Session block ────────────────────────────────────────────────────────────

function SessionBlock({
  session,
  isLatest,
}: {
  session: AgentSession;
  isLatest: boolean;
}) {
  const [open, setOpen] = useState(isLatest);

  useEffect(() => {
    if (isLatest) setOpen(true);
  }, [isLatest]);

  const sessionLabel =
    session.label || (session.runs[0]?.user_message ?? "New session");

  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left bg-gray-50 hover:bg-gray-100 transition-colors sticky top-0 z-10"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        )}
        <span className="text-xs text-gray-700 font-medium truncate flex-1">
          {sessionLabel}
        </span>
        <span className="text-[10px] text-gray-400 shrink-0">
          {session.runs.length} msg{session.runs.length !== 1 ? "s" : ""}
        </span>
        {session.status === "running" && (
          <Loader2 className="w-3 h-3 animate-spin text-gray-400 shrink-0" />
        )}
      </button>

      {open && (
        <div>
          {session.runs.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-gray-400 italic">
              No activity yet…
            </p>
          ) : (
            session.runs.map((run, i) => (
              <RunBlock key={run.id} run={run} isFirst={i === 0} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AgentActivityProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function AgentActivity({ collapsed = false, onToggle }: AgentActivityProps) {
  const sessions = useAgentStore((s) => s.sessions);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, collapsed]);

  return (
    <div className="h-full flex flex-col bg-white text-gray-800 overflow-hidden border-r">
      {/* header — always visible, click to collapse/expand */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2.5 border-b bg-white hover:bg-gray-50 transition-colors w-full text-left shrink-0"
      >
        <Brain className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="text-xs font-semibold text-gray-700 tracking-wide flex-1">
          Agent Activity
        </span>
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </button>

      {/* legend — hidden when collapsed */}
      {!collapsed && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b bg-gray-50 shrink-0 flex-wrap">
          {LEGEND_ITEMS.map(({ label, dot }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={cn("w-2 h-2 rounded-full", dot)} />
              <span className="text-[10px] text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* session list — hidden when collapsed */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {sessions.every((s) => s.runs.length === 0) ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
              <Brain className="w-8 h-8 opacity-25" />
              <p className="text-xs">No activity yet</p>
              <p className="text-[10px] opacity-60">
                Send a message to watch the agent think
              </p>
            </div>
          ) : (
            sessions.map((session, i) => (
              <SessionBlock
                key={session.id}
                session={session}
                isLatest={i === sessions.length - 1}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
