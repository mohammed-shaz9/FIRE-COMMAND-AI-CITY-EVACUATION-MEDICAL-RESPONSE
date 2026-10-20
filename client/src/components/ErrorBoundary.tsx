import { cn } from "@/lib/utils";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Local fallback (e.g. around a WebGL canvas). Omit for the full-page screen. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div
        role="alert"
        className="flex items-center justify-center min-h-screen p-4 sm:p-8 bg-fc-bg text-slate-100"
      >
        <div className="flex flex-col items-center w-full max-w-2xl p-4 sm:p-8 text-center">
          <AlertTriangle
            size={48}
            className="text-fc-red mb-6 flex-shrink-0"
            aria-hidden="true"
          />

          <h1 className="text-2xl font-bold mb-2 text-white">
            Console hit an unexpected error
          </h1>
          <p className="text-slate-400 mb-6">
            The incident engine is unaffected. Reload to reconnect the console.
          </p>

          {import.meta.env.DEV && (
            <div className="p-4 w-full rounded bg-white/5 overflow-auto mb-6 text-left">
              <pre className="text-xs text-slate-300 whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center justify-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground font-semibold",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reload Page
            </button>
            <a
              href="/"
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/20 text-slate-200 hover:border-fc-cyan hover:text-fc-cyan"
            >
              <Home size={16} aria-hidden="true" />
              Back to home
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
