import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";
import { Suspense, lazy, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SocketProvider } from "./contexts/SocketContext";
import HowItWorks from "./pages/HowItWorks";
import Landing from "./pages/Landing";

// Dashboard pulls in three.js, mapbox and jsPDF: keep it out of the landing bundle.
const Home = lazy(() => import("./pages/Home"));

// Socket (and its notification prompt) only matters on the live console.
function CommandCenter() {
  return (
    <SocketProvider>
      <Home />
    </SocketProvider>
  );
}

function PageLoader() {
  return (
    <div
      role="status"
      className="min-h-screen flex items-center justify-center gap-3 bg-fc-bg text-slate-300"
    >
      <Loader2 className="h-5 w-5 animate-spin text-fc-cyan" aria-hidden="true" />
      <span className="fc-eyebrow">Loading console</span>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/how-it-works" component={HowItWorks} />
        <Route path="/command-center" component={CommandCenter} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
