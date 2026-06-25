import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Mic,
  MicOff,
  Power,
  Sparkles,
  Loader2,
  Volume2,
  ExternalLink,
  Globe,
  X,
  AlertTriangle,
  Lightbulb,
  Heart
} from "lucide-react";
import { AssistantState, ToolNotification } from "./types";
import { AudioManager } from "./lib/audioManager";
import WaveVisualizer from "./components/WaveVisualizer";

export default function App() {
  const [state, setState] = useState<AssistantState>("disconnected");
  const [notifications, setNotifications] = useState<ToolNotification[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micStateMsg, setMicStateMsg] = useState<string>("Disconnected");

  const wsRef = useRef<WebSocket | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);
  const stateRef = useRef<AssistantState>("disconnected");

  // Keep stateRef in sync with state to avoid stale closure in callbacks
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Initialize AudioManager on mount
  useEffect(() => {
    audioManagerRef.current = new AudioManager();
    return () => {
      if (audioManagerRef.current) {
        audioManagerRef.current.close();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Update State Message description based on state
  useEffect(() => {
    switch (state) {
      case "disconnected":
        setMicStateMsg("Off");
        break;
      case "connecting":
        setMicStateMsg("Initializing Voice Link...");
        break;
      case "idle":
        setMicStateMsg("Zoya Standby (Mic Paused)");
        break;
      case "listening":
        setMicStateMsg("Zoya is Listening... Speak naturally!");
        break;
      case "speaking":
        setMicStateMsg("Zoya is Speaking...");
        break;
    }
  }, [state]);

  // Self-correcting state monitor based on speaker RMS levels
  useEffect(() => {
    if (state === "disconnected" || state === "connecting") return;

    const interval = setInterval(() => {
      const am = audioManagerRef.current;
      if (!am) return;

      const levels = am.getVolumeLevels();
      const isSpeaking = levels.output > 0.005;

      if (isSpeaking) {
        if (state !== "speaking") {
          setState("speaking");
        }
      } else {
        if (am.getIsMuted()) {
          if (state !== "idle") {
            setState("idle");
          }
        } else {
          if (state !== "listening") {
            setState("listening");
          }
        }
      }
    }, 120);

    return () => clearInterval(interval);
  }, [state]);

  // Initiate / terminate connection to Zoya server
  const toggleConnection = async () => {
    const am = audioManagerRef.current;
    if (!am) return;

    if (state !== "disconnected") {
      // Shutdown
      setState("disconnected");
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      am.close();
      return;
    }

    // Connect
    setState("connecting");
    setErrorMessage(null);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws-live`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connection established with local proxy");
      };

      ws.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.type === "error") {
            setErrorMessage(parsed.message);
            setState("disconnected");
            am.close();
            ws.close();
            return;
          }

          if (parsed.type === "connected") {
            // Server connected to Gemini Live, now boot output & micro capture
            try {
              await am.startMicCapture((base64) => {
                if (ws.readyState === WebSocket.OPEN && stateRef.current !== "speaking") {
                  ws.send(JSON.stringify({ type: "audio", data: base64 }));
                }
              });
              setState("listening");
            } catch (err: any) {
              setErrorMessage("Mic access requested. Please enable permission to chat with Zoya!");
              setState("disconnected");
              ws.close();
            }
          }

          if (parsed.type === "audio" && parsed.data) {
            am.playResponseChunk(parsed.data);
          }

          if (parsed.type === "interrupted") {
            // Instant mute scheduling queues for seamless talk-over flow
            am.interrupt();
            setState("listening");
          }

          if (parsed.type === "toolCall") {
            const { name, args, id } = parsed;
            if (name === "openWebsite" && args?.url) {
              const newNotify: ToolNotification = {
                id: id || Math.random().toString(),
                url: args.url,
                siteName: args.siteName || "Portal Link",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              };

              setNotifications(prev => [newNotify, ...prev].slice(0, 4));

              // Try open window
              try {
                window.open(args.url, "_blank");
              } catch (e) {
                console.warn("Iframe blocked window popup, showing click notice.");
              }
            }
          }

        } catch (e) {
          console.error("Error processing websocket message:", e);
        }
      };

      ws.onerror = (err) => {
        console.error("WS error:", err);
        setErrorMessage("Connection link failed. Make sure the backend server is running.");
        setState("disconnected");
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        if (state !== "disconnected") {
          setState("disconnected");
        }
      };

    } catch (err: any) {
      setErrorMessage(`Failed linking voice network: ${err.message || err}`);
      setState("disconnected");
    }
  };

  // Standby toggle (Mute / Unmute mic while remaining connected)
  const toggleMute = () => {
    const am = audioManagerRef.current;
    if (!am) return;

    const newMuted = !am.getIsMuted();
    am.setMute(newMuted);
    
    // Explicit transition
    if (newMuted) {
      am.interrupt(); // stop any current speech instantly
      setState("idle");
    } else {
      setState("listening");
    }
  };

  // Handle manual notification dismissal
  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // List of playful sassy prompts the user can try
  const suggestionPrompts = [
    { text: "Who are you?", label: "Identity" },
    { text: "Open YouTube for me", label: "Open Site" },
    { text: "Are you single?", label: "Flirt" },
    { text: "Give me some sassy motivation", label: "Sass" }
  ];

  return (
    <div id="zoya-app-root" className="min-h-screen relative flex flex-col justify-between bg-slate-950 text-white font-sans overflow-hidden">
      
      {/* Dynamic Grid Overlay & Starry Glow Background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-purple-950/20 to-black z-0 pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] z-0 pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-pink-500/5 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none z-0" />

      {/* Header Bar */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between border-b border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center shadow-[0_0_15px_rgba(236,72,153,0.3)]">
            <Sparkles className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-pink-100 to-pink-300">
              ZOYA
            </h1>
            <p className="font-mono text-[9px] text-pink-400 uppercase tracking-widest leading-none">
              Voice Synapse V1.0
            </p>
          </div>
        </div>

        {/* Network State Indicator Pill */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            state === "disconnected" ? "bg-red-500" :
            state === "connecting" ? "bg-amber-500 animate-pulse" :
            "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"
          }`} />
          <span className="font-mono text-xs text-slate-300 capitalize tracking-tight font-medium">
            {state === "disconnected" ? "Offline" : state === "connecting" ? "Linking" : "Online"}
          </span>
        </div>
      </header>

      {/* Main Content Stage */}
      <main className="relative z-10 flex-1 w-full max-w-md mx-auto px-6 flex flex-col justify-center items-center gap-8 py-4">
        
        {/* State Capsule Banner */}
        <div className="w-full text-center">
          <span className="font-mono text-[10px] uppercase font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-pink-400 to-purple-400 tracking-wider">
            Voice Interface Mode
          </span>
          <h2 className="font-display text-2xl font-semibold tracking-tight mt-1 text-slate-100 h-8 flex items-center justify-center gap-2">
            {state === "connecting" && <Loader2 className="w-5 h-5 animate-spin text-amber-500" />}
            {state === "speaking" && <Volume2 className="w-5 h-5 text-pink-500 animate-bounce" />}
            {micStateMsg}
          </h2>
        </div>

        {/* Waves Visualization Canvas */}
        <div className="w-full flex justify-center py-4 relative">
          <WaveVisualizer state={state} audioManager={audioManagerRef.current} />
          
          {/* Floating Heart Graphic */}
          <AnimatePresence>
            {state === "speaking" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5, y: 15 }}
                animate={{ opacity: 0.6, scale: 1, y: -45 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                className="absolute top-1/4 right-[28%] text-pink-500 pointer-events-none"
              >
                <Heart className="w-6 h-6 fill-current" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Master Control Panel */}
        <div className="w-full flex flex-col items-center gap-5">
          
          {/* Main Action Controllers */}
          <div className="flex items-center gap-6 justify-center">
            
            {/* Standby / Mic Toggle Button */}
            <button
              onClick={toggleMute}
              disabled={state === "disconnected" || state === "connecting"}
              className={`p-3.5 rounded-full border transition-all duration-300 ${
                state === "disconnected" || state === "connecting"
                  ? "bg-slate-900 border-white/5 text-slate-600 cursor-not-allowed"
                  : audioManagerRef.current?.getIsMuted()
                  ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                  : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
              }`}
              title={audioManagerRef.current?.getIsMuted() ? "Unmute Microphone" : "Standby (Mute Microphone)"}
            >
              {state !== "disconnected" && audioManagerRef.current?.getIsMuted() ? (
                <MicOff className="w-6 h-6" />
              ) : (
                <Mic className="w-6 h-6" />
              )}
            </button>

            {/* Huge Floating Circular Power Connection Button */}
            <motion.button
              onClick={toggleConnection}
              whileTap={{ scale: 0.94 }}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl border ${
                state === "disconnected"
                  ? "bg-slate-900 border-slate-700/60 hover:border-pink-500/40 text-rose-500 hover:shadow-[0_0_30px_rgba(244,63,94,0.35)]"
                  : state === "connecting"
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-500 shadow-[0_0_35px_rgba(245,158,11,0.25)]"
                  : "bg-pink-500/15 border-pink-500/60 text-white hover:bg-pink-500/10 shadow-[0_0_40px_rgba(236,72,153,0.4)]"
              }`}
            >
              {state === "disconnected" ? (
                <Power className="w-9 h-9" />
              ) : state === "connecting" ? (
                <Loader2 className="w-9 h-9 animate-spin" />
              ) : (
                <Power className="w-9 h-9 text-pink-400 animate-pulse" />
              )}
            </motion.button>

            {/* Sassy status bulb trigger info */}
            <div className="p-3.5 rounded-full bg-slate-900 border border-white/5 text-pink-400">
              <Sparkles className="w-6 h-6" />
            </div>

          </div>

          {/* Connection prompt indicator */}
          <p className="text-xs text-slate-400 font-mono text-center max-w-xs mt-1">
            {state === "disconnected" ? (
               <span className="text-pink-400 cursor-pointer hover:underline font-bold" onClick={toggleConnection}>
                TAP CENTER TO LINK ZOYA
              </span>
            ) : audioManagerRef.current?.getIsMuted() ? (
              <span className="text-red-400 animate-pulse font-bold">
                MIC MUTED • ZOYA ON STANDBY
              </span>
            ) : (
              <span className="text-emerald-400 font-bold">
                VOICE SYLLABLE SYNC ACTIVE
              </span>
            )}
          </p>
        </div>

        {/* Suggestion Prompts Box */}
        {state === "disconnected" && (
          <div className="w-full mt-2 animate-fade-in">
            <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-pink-400" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  Sassy Prompts For Zoya
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {suggestionPrompts.map((prompt, i) => (
                  <div
                    key={i}
                    onClick={toggleConnection}
                    className="p-2.5 rounded-xl bg-slate-950/40 border border-white/5 hover:border-pink-500/30 text-left cursor-pointer transition-all duration-200 group"
                  >
                    <span className="block font-mono text-[9px] uppercase tracking-wider text-pink-400 mb-0.5 font-bold">
                      {prompt.label}
                    </span>
                    <span className="text-xs text-slate-300 group-hover:text-white transition-colors duration-200">
                      "{prompt.text}"
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error Notification Alert */}
        {errorMessage && (
          <div className="w-full bg-red-950/40 border border-red-500/30 rounded-2xl p-4 flex gap-3 items-start relative z-10">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-red-100 leading-tight">System Message</h4>
              <p className="text-xs text-red-200/90 mt-1 leading-normal font-mono">{errorMessage}</p>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-slate-400 hover:text-white p-0.5 rounded-lg hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

      </main>

      {/* Footer Area with Real-time website launcher integrations */}
      <footer className="relative z-10 w-full max-w-md mx-auto px-6 pb-6 text-center">
        
        {/* Portal launch popups (in case sandboxing blocked them) */}
        <AnimatePresence>
          {notifications.length > 0 && (
            <div className="w-full space-y-2 mb-4">
              {notifications.map((n) => (
                <motion.div
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  className="bg-gradient-to-r from-pink-950/70 to-purple-950/70 border border-pink-500/30 rounded-2xl p-3.5 flex items-center justify-between text-left shadow-[0_10px_30px_rgba(236,72,153,0.15)] backdrop-blur-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center animate-pulse">
                      <Globe className="w-5 h-5 text-pink-400" />
                    </div>
                    <div>
                      <div className="flex gap-1.5 items-center">
                        <span className="font-mono text-[9px] uppercase font-bold text-pink-400 bg-pink-500/10 px-1.5 py-0.5 rounded">
                          Portal Triggered
                        </span>
                        <span className="font-mono text-[9px] text-slate-400">{n.timestamp}</span>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-100 mt-1">
                        Zoya opened {n.siteName}
                      </h4>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-mono text-xs font-bold shadow-[0_0_10px_rgba(236,72,153,0.4)] flex items-center gap-1 transition-colors duration-200"
                    >
                      VISIT
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => dismissNotification(n.id)}
                      className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-white/5"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>

        <p className="font-mono text-[9px] text-slate-500 uppercase tracking-widest leading-none">
          ZOYA AI COMPANION • CHAT SAFELY WITH CONFIDENCE
        </p>
      </footer>

    </div>
  );
}
