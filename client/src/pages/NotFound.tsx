import { Button } from "@/components/ui/button";
import { ArrowRight, Flame, Home } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <main className="fc-hero-bg min-h-screen w-full flex items-center justify-center bg-fc-bg px-4 text-slate-100">
      <div className="w-full max-w-lg rounded-xl border border-fc-red/30 bg-fc-panel p-8 text-center sm:p-10">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-fc-red/40 bg-fc-red/10">
          <Flame className="h-7 w-7 text-fc-red" aria-hidden="true" />
        </span>
        <p className="fc-eyebrow mt-6 text-fc-red">Error 404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">This route is off the map</h1>
        <p className="mt-3 leading-relaxed text-slate-300">
          The page you are looking for does not exist or has moved. Head back to safety, or jump straight into the console.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/">
              <Home aria-hidden="true" />
              Go home
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/command-center">
              Open console
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
