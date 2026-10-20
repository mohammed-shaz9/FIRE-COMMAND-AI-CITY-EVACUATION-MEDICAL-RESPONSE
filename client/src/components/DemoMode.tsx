import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, Pause, RotateCcw, Volume2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function DemoMode() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [narration, setNarration] = useState("");
  
  const createIncidentMutation = trpc.emergency.createIncident.useMutation();
  const clearAllIncidentsMutation = trpc.emergency.clearAllIncidents.useMutation();
  const utils = trpc.useUtils();

  const demoSteps = [
    {
      action: async () => {
        setNarration("Starting Flood Scenario: Heavy rainfall detected near the Library.");
        await createIncidentMutation.mutateAsync({
          type: "flood",
          severity: "warning",
          locationX: 50,
          locationY: 0,
          locationZ: 80,
          buildingName: "Library",
          description: "Water level rising due to heavy rain.",
        });
        utils.emergency.getActiveIncidents.invalidate();
      },
      delay: 5000,
    },
    {
      action: async () => {
        setNarration("Situation Escalating: Flood spreading to Science Block. Evacuation required.");
        await createIncidentMutation.mutateAsync({
          type: "flood",
          severity: "critical",
          locationX: 100,
          locationY: 0,
          locationZ: 0,
          buildingName: "Science Block",
          description: "Flash flood reaching ground floor.",
        });
        utils.emergency.getActiveIncidents.invalidate();
      },
      delay: 5000,
    },
    {
      action: async () => {
        setNarration("AI Dispatcher: Calculating safest routes to elevated ground.");
        // Simulated pathfinding delay
      },
      delay: 3000,
    },
    {
      action: async () => {
        setNarration("Demo Complete: All zones monitored. Emergency services notified.");
      },
      delay: 2000,
    },
  ];

   const executedStepRef = useRef(-1);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isPlaying && step < demoSteps.length) {
      const currentStep = demoSteps[step];
      
      if (executedStepRef.current !== step) {
        executedStepRef.current = step;
        currentStep.action().catch((err: unknown) => {
          console.error("[Demo] step failed", err);
          toast.error("Demo step failed. Check the server connection.");
          setIsPlaying(false);
          executedStepRef.current = -1;
        });
      }
      
      timer = setTimeout(() => {
        setStep(prev => prev + 1);
      }, currentStep.delay);
    } else if (isPlaying && step >= demoSteps.length) {
      setIsPlaying(false);
      executedStepRef.current = -1;
    }
    return () => clearTimeout(timer);
    // demoSteps is rebuilt every render; step/isPlaying are the real triggers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, step]);

  const handleStart = () => {
    setStep(0);
    setIsPlaying(true);
  };

  const handleReset = async () => {
    setIsPlaying(false);
    setStep(0);
    executedStepRef.current = -1;
    window.speechSynthesis?.cancel();
    setNarration("Demo reset.");
    try {
      await clearAllIncidentsMutation.mutateAsync();
      utils.emergency.getActiveIncidents.invalidate();
    } catch {
      toast.error("Could not clear incidents");
    }
  };

  // Simple text-to-speech for narration
  useEffect(() => {
    if (!narration || !isPlaying || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(narration));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration]);

  // Stop speaking on pause or unmount.
  useEffect(() => {
    if (!isPlaying) window.speechSynthesis?.cancel();
    return () => window.speechSynthesis?.cancel();
  }, [isPlaying]);

  return (
    <Card className="bg-gray-900 border-red-900/50 p-4 border-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Play className="text-red-600" size={20} />
          Presentation Mode
        </h2>
        <div className="flex gap-2">
          {!isPlaying ? (
            <Button size="sm" onClick={handleStart} className="bg-red-600 hover:bg-red-700">
              <Play size={16} className="mr-1" /> Start
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIsPlaying(false)} variant="outline" className="border-red-600 text-red-600">
              <Pause size={16} className="mr-1" /> Pause
            </Button>
          )}
          <Button size="sm" onClick={handleReset} variant="ghost" className="text-gray-400 hover:text-white">
            <RotateCcw size={16} className="mr-1" /> Reset
          </Button>
        </div>
      </div>

      <div className="bg-black/50 rounded-lg p-4 min-h-[80px] border border-gray-800 flex items-start gap-3">
        <Volume2 className={cn("text-red-500 mt-1", isPlaying && "animate-bounce")} size={20} />
        <p className="text-gray-200 text-sm leading-relaxed italic">
          {narration || "Ready to start the demo presentation. Press Start to begin."}
        </p>
      </div>

      {isPlaying && (
        <div className="mt-4 flex gap-1">
          {demoSteps.map((_, i) => (
            <div 
              key={i} 
              className={cn(
                "h-1 flex-1 rounded-full transition-all duration-500",
                i < step ? "bg-red-600" : i === step ? "bg-red-400 animate-pulse" : "bg-gray-800"
              )} 
            />
          ))}
        </div>
      )}
    </Card>
  );
}

