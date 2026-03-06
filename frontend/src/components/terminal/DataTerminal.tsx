export default function DataTerminal() {
  return (
    <div className="h-full flex flex-col bg-card">
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-medium text-muted-foreground">
          Data Terminal
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-center text-muted-foreground text-sm mt-8">
          <p>Query results and generated SQL will appear here.</p>
          <p className="mt-2 text-xs">
            Submit a query through the chat to see data flow.
          </p>
        </div>
      </div>
    </div>
  );
}
