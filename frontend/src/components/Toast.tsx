import { useToastStore } from "@/stores/toastStore";
import { X } from "lucide-react";

const bgMap = {
  error: "bg-red-600",
  success: "bg-green-600",
  info: "bg-blue-600",
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${bgMap[t.type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-2 animate-in slide-in-from-bottom-2 fade-in duration-200`}
        >
          <span className="text-sm flex-1">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 hover:opacity-70 transition"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
