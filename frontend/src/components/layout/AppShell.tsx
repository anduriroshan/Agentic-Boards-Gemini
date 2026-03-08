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

import { useAuth } from "@/contexts/AuthContext";

export default function AppShell() {
  const activityRef = useRef<ImperativePanelHandle>(null);
  const chatRef = useRef<ImperativePanelHandle>(null);
  const { user, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);

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
      <header className="h-14 border-b bg-card px-4 flex items-center justify-between shrink-0 sticky top-0 z-50 shadow-sm">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Agentic Boards</h1>
        <div className="flex items-center gap-4">
          <SessionsPanel />
          <DatabricksSettings />

          {user && (
            <div className="relative border-l pl-4 border-slate-200 dark:border-slate-800 ml-2 h-8 flex items-center">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                {user.picture ? (
                  <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold border border-blue-200 dark:border-blue-800">
                    {user.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
              </button>

              {showDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)}></div>
                  <div className="absolute right-0 top-[calc(100%+0.5rem)] mt-1 w-56 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{user.email}</p>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          logout();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
