import { useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import ChatPanel from "@/components/chat/ChatPanel";
import DashboardCanvas from "@/components/dashboard/DashboardCanvas";
import AgentActivity from "@/components/activity/AgentActivity";
import DatabricksSettings from "@/components/databricks/DatabricksSettings";
import SessionsPanel from "@/components/sessions/SessionsPanel";

export default function AppShell() {
  const activityRef = useRef<ImperativePanelHandle>(null);
  const chatRef = useRef<ImperativePanelHandle>(null);

  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  function toggleActivity() {
    if (activityCollapsed) {
      activityRef.current?.expand();
    } else {
      activityRef.current?.collapse();
    }
  }

  function toggleChat() {
    if (chatCollapsed) {
      chatRef.current?.expand();
    } else {
      chatRef.current?.collapse();
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="h-12 border-b bg-card px-4 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Agentic Boards</h1>
        <div className="flex items-center gap-2">
          <SessionsPanel />
          <DatabricksSettings />
        </div>
      </header>

      <PanelGroup direction="horizontal" className="flex-1">
        {/* Left column: Agent Activity + Chat stacked vertically */}
        <Panel defaultSize={28} minSize={12} maxSize={45}>
          <PanelGroup direction="vertical">
            <Panel
              ref={activityRef}
              collapsible
              collapsedSize={6}
              defaultSize={50}
              minSize={15}
              onCollapse={() => setActivityCollapsed(true)}
              onExpand={() => setActivityCollapsed(false)}
            >
              <AgentActivity
                collapsed={activityCollapsed}
                onToggle={toggleActivity}
              />
            </Panel>

            <PanelResizeHandle className="h-1.5 bg-border hover:bg-primary/20 transition-colors cursor-row-resize" />

            <Panel
              ref={chatRef}
              collapsible
              collapsedSize={6}
              defaultSize={50}
              minSize={15}
              onCollapse={() => setChatCollapsed(true)}
              onExpand={() => setChatCollapsed(false)}
            >
              <ChatPanel
                collapsed={chatCollapsed}
                onToggle={toggleChat}
              />
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/20 transition-colors" />

        {/* Main dashboard area */}
        <Panel defaultSize={72} minSize={40}>
          <div className="flex flex-col h-full">
            <DashboardCanvas />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
