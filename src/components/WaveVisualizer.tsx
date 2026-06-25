import { useEffect, useRef } from "react";
import { AssistantState } from "../types";
import { AudioManager } from "../lib/audioManager";

interface WaveVisualizerProps {
  state: AssistantState;
  audioManager: AudioManager | null;
}

export default function WaveVisualizer({ state, audioManager }: WaveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const rotationRef = useRef<number>(0);
  const pulseRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize handler to maintain sharp graphics
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Main render loop
    const render = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      const centerX = w / 2;
      const centerY = h / 2;
      const baseRadius = Math.min(w, h) * 0.22;

      ctx.clearRect(0, 0, w, h);

      // Fetch volume levels from audioManager
      let micVol = 0;
      let speakerVol = 0;
      let inputWaves = new Uint8Array(0);
      let outputWaves = new Uint8Array(0);

      if (audioManager && state !== "disconnected") {
        const vols = audioManager.getVolumeLevels();
        micVol = vols.input;
        speakerVol = vols.output;

        const waves = audioManager.getWaveformData();
        inputWaves = waves.input;
        outputWaves = waves.output;
      }

      // Update basic helpers
      rotationRef.current += 0.015;
      pulseRef.current += 0.05;

      // 1. Draw glowing background aura
      const radialGlow = ctx.createRadialGradient(
        centerX, centerY, baseRadius * 0.5,
        centerX, centerY, baseRadius * 2.2
      );

      if (state === "disconnected") {
        radialGlow.addColorStop(0, "rgba(239, 68, 68, 0.08)"); // Subtle red
        radialGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else if (state === "connecting") {
        radialGlow.addColorStop(0, "rgba(245, 158, 11, 0.1)"); // Warm amber
        radialGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else if (state === "idle") {
        radialGlow.addColorStop(0, "rgba(139, 92, 246, 0.08)"); // Soft purple
        radialGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else if (state === "listening") {
        const micBoost = Math.max(0, micVol * 0.4);
        radialGlow.addColorStop(0, `rgba(6, 182, 212, ${0.12 + micBoost})`); // Sassy Cyan aura
        radialGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else if (state === "speaking") {
        const talkBoost = Math.max(0, speakerVol * 0.6);
        radialGlow.addColorStop(0, `rgba(236, 72, 153, ${0.15 + talkBoost})`); // Vibrant Hot Pink / Magenta aura
        radialGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      }

      ctx.fillStyle = radialGlow;
      ctx.fillRect(0, 0, w, h);

      // State Specific Rendering
      if (state === "disconnected") {
        // Red Pulsating Rest Ring
        const loopRadius = baseRadius + Math.sin(pulseRef.current) * 4;
        ctx.beginPath();
        ctx.arc(centerX, centerY, loopRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, loopRadius - 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(239, 68, 68, 0.05)";
        ctx.fill();

      } else if (state === "connecting") {
        // Multiple Amber/Orange Rotating Halo Arcs
        const arcCount = 3;
        for (let i = 0; i < arcCount; i++) {
          const rotationOffset = (i * Math.PI * 2) / arcCount;
          const currentRotation = rotationRef.current * (i % 2 === 0 ? 1 : -1) + rotationOffset;

          ctx.beginPath();
          ctx.arc(
            centerX,
            centerY,
            baseRadius + i * 10,
            currentRotation,
            currentRotation + Math.PI * 0.7
          );
          ctx.strokeStyle = `rgba(245, 158, 11, ${0.6 - i * 0.15})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Inner soft amber core
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 15, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 158, 11, 0.03)";
        ctx.fill();

      } else if (state === "idle") {
        // Soft Purple organic liquid-looking wavy circle
        ctx.beginPath();
        const points = 36;
        for (let i = 0; i < points; i++) {
          const angle = (i * Math.PI * 2) / points;
          const wobble = Math.sin(pulseRef.current + i * 1.5) * 6;
          const r = baseRadius + wobble;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.strokeStyle = "rgba(139, 92, 246, 0.6)";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(139, 92, 246, 0.05)";
        ctx.fill();

      } else if (state === "listening") {
        // Cyan Voice Resonance Ring
        // Oscillate concentric rings based on real micVolume
        const ringVolume = Math.max(0, micVol * 30);

        ctx.shadowBlur = 10 + ringVolume * 0.5;
        ctx.shadowColor = "rgba(6, 182, 212, 0.5)";

        // Outer Ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius + 15 + ringVolume, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Waveform nodes on the circular perimeter
        ctx.beginPath();
        const numPoints = 80;
        for (let i = 0; i <= numPoints; i++) {
          const angle = (i * Math.PI * 2) / numPoints;
          // Pull actual frequency data index if available
          let waveScale = 0;
          if (inputWaves.length > 0) {
            const idx = Math.floor((i / numPoints) * inputWaves.length * 0.5);
            waveScale = (inputWaves[idx] / 255) * 35;
          } else {
            // Fallback to organic wobble
            waveScale = Math.sin(pulseRef.current * 2 + i * 0.3) * (5 + micVol * 15);
          }

          const r = baseRadius + waveScale;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.strokeStyle = "rgba(6, 182, 212, 0.85)";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Pulsating inner solid core
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 10 - ringVolume * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(6, 182, 212, 0.1)";
        ctx.fill();

        // Clear shadow parameters
        ctx.shadowBlur = 0;

      } else if (state === "speaking") {
        // Vibrant Magenta / Fuchsia Sound Visualizer spikes
        const ringVolume = Math.max(0, speakerVol * 45);

        ctx.shadowBlur = 15 + ringVolume * 0.5;
        ctx.shadowColor = "rgba(236, 72, 153, 0.6)";

        // Circular waveform lines shooting outward
        const barCount = 120;
        for (let i = 0; i < barCount; i++) {
          const angle = (i * Math.PI * 2) / barCount;
          
          let amplitude = 0;
          if (outputWaves.length > 0) {
            // Read from outputs frequency bin
            const idx = Math.floor((i / barCount) * outputWaves.length * 0.4);
            amplitude = (outputWaves[idx] / 255.0) * 55;
          } else {
            // Simulated voice wave if sound is processing
            amplitude = Math.abs(Math.sin((i / barCount) * Math.PI * 6 + pulseRef.current * 3.5)) * (20 + speakerVol * 25);
          }

          // Inner start point
          const startR = baseRadius - 5 - (ringVolume * 0.1);
          const endR = startR + amplitude + (speakerVol * 20);

          const startX = centerX + Math.cos(angle) * startR;
          const startY = centerY + Math.sin(angle) * startR;
          const endX = centerX + Math.cos(angle) * endR;
          const endY = centerY + Math.sin(angle) * endR;

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          // Interpolate neon color
          ctx.strokeStyle = i % 2 === 0 ? "rgba(236, 72, 153, 0.85)" : "rgba(168, 85, 247, 0.75)";
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Concentric Core Ripple
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 15 - ringVolume * 0.15, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(236, 72, 153, 0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 30, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(236, 72, 153, 0.08)";
        ctx.fill();

        ctx.shadowBlur = 0;
      }

      // Draw shiny core center sphere (Glassmorphism look)
      const shineGrad = ctx.createRadialGradient(
        centerX - baseRadius * 0.2, centerY - baseRadius * 0.2, 0,
        centerX, centerY, baseRadius * 0.6
      );
      shineGrad.addColorStop(0, "rgba(255, 255, 255, 0.15)");
      shineGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.02)");
      shineGrad.addColorStop(1, "rgba(0, 0, 0, 0.4)");

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius - 20, 0, Math.PI * 2);
      ctx.fillStyle = shineGrad;
      ctx.fill();

      // Core border
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius - 20, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.stroke();

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state, audioManager]);

  return (
    <div className="relative w-72 h-72 md:w-96 md:h-96 mx-auto flex items-center justify-center pointer-events-none">
      {/* Canvas layer */}
      <canvas ref={canvasRef} className="absolute w-full h-full inset-0 rounded-full" />
    </div>
  );
}
