import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic, MicOff, Loader2, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function EmergencyReport() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [location, setLocation] = useState<string>("Detecting...");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const uploadAudioMutation = trpc.emergency.uploadAudio.useMutation();
  const reportVoiceIncidentMutation = trpc.emergency.reportVoiceIncident.useMutation();
  const utils = trpc.useUtils();

  // Auto-detect location on mount
  useEffect(() => {
    detectLocation();
  }, []);

  // Release the microphone if the component unmounts mid-recording.
  useEffect(
    () => () => {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      rec?.stream.getTracks().forEach(t => t.stop());
    },
    []
  );

  const detectLocation = () => {
    setLocation("Detecting...");
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          // Coordinates only: no building lookup exists, so do not claim one.
          setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        },
        (error) => {
          console.error("Location error:", error);
          setLocation("Unavailable");
        },
        { timeout: 10000 }
      );
    } else {
      setLocation("Unsupported");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Mic error:", error);
      toast.error("Could not access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all tracks
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  };

  const processAudio = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      // 1. Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onerror = () => reject(reader.error);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
      });
      const base64 = await base64Promise;

      // 2. Upload to storage
      const { url } = await uploadAudioMutation.mutateAsync({
        audioBase64: base64,
        fileName: `report-${Date.now()}.webm`,
      });

      // 3. Call transcription and classification
      const result = await reportVoiceIncidentMutation.mutateAsync({
        audioUrl: url,
        language: "en",
      });

      toast.success("Emergency Reported", {
        description: result.transcription,
      });

      utils.emergency.getActiveIncidents.invalidate();
    } catch (error) {
      console.error("Report error:", error);
      toast.error("Failed to process voice report");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="bg-gray-900 border-gray-800 p-4">
      <h2 className="text-xl font-bold mb-4 text-white">Report Emergency</h2>

      <div className="flex flex-col gap-4">
        {/* Location Display */}
        <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-800 p-2 rounded">
          <MapPin size={16} className="text-red-600" />
          <span>Location: {location}</span>
          <Button variant="ghost" size="sm" className="ml-auto text-xs h-6 px-2" onClick={detectLocation} aria-label="Refresh location">
            Refresh
          </Button>
        </div>

        {/* Voice Control */}
        <div className="flex flex-col items-center gap-3 py-4">
          <Button
            size="lg"
            variant={isRecording ? "destructive" : "default"}
            className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-all",
              isRecording ? "animate-pulse shadow-[0_0_20px_rgba(220,38,38,0.5)]" : "bg-red-600 hover:bg-red-700"
            )}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            aria-label={isProcessing ? "Analyzing voice report" : isRecording ? "Stop recording and send report" : "Start voice report"}
          >
            {isProcessing ? (
              <Loader2 className="animate-spin" size={32} />
            ) : isRecording ? (
              <MicOff size={32} />
            ) : (
              <Mic size={32} />
            )}
          </Button>
          <span className="text-sm font-medium text-gray-300" role="status">
            {isProcessing ? "Analyzing Voice..." : isRecording ? "Stop & Report" : "Press to Speak"}
          </span>
        </div>

      </div>
    </Card>
  );
}

