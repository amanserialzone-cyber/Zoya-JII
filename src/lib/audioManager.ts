export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function base64ToPCM16(base64: string): Int16Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768.0;
  }
  return float32;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export class AudioManager {
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;

  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private isMuted = false;

  constructor() {}

  async startMicCapture(onAudioData: (base64: string) => void): Promise<void> {
    this.cleanupInput();

    // 1. Get user mic stream
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    // 2. Setup 16kHz capture context
    this.inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000
    });

    this.inputSource = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);

    // 3. Create Analyser for input visuals
    this.inputAnalyser = this.inputAudioCtx.createAnalyser();
    this.inputAnalyser.fftSize = 256;

    // 4. Create ScriptProcessor to capture audio buffer ticks
    this.scriptProcessor = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);

    this.scriptProcessor.onaudioprocess = (e) => {
      if (this.isMuted) return;
      // Prevent feedback loop: If Zoya is actively playing output, do not send user input
      if (this.activeSources.length > 0) return;

      const channelData = e.inputBuffer.getChannelData(0);
      const pcmBuffer = floatTo16BitPCM(channelData);
      const base64 = arrayBufferToBase64(pcmBuffer);
      onAudioData(base64);
    };

    // Connect nodes
    this.inputSource.connect(this.inputAnalyser);
    this.inputAnalyser.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.inputAudioCtx.destination);

    if (this.inputAudioCtx.state === "suspended") {
      await this.inputAudioCtx.resume();
    }
  }

  stopMicCapture(): void {
    this.cleanupInput();
  }

  private cleanupInput(): void {
    try {
      if (this.scriptProcessor) {
        this.scriptProcessor.disconnect();
        this.scriptProcessor.onaudioprocess = null;
        this.scriptProcessor = null;
      }
      if (this.inputSource) {
        this.inputSource.disconnect();
        this.inputSource = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      if (this.inputAudioCtx) {
        this.inputAudioCtx.close();
        this.inputAudioCtx = null;
      }
      this.inputAnalyser = null;
    } catch (e) {
      console.error("Cleanup input failed:", e);
    }
  }

  private initOutput(): void {
    if (!this.outputAudioCtx) {
      this.outputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000
      });
      this.outputAnalyser = this.outputAudioCtx.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.connect(this.outputAudioCtx.destination);
    }
  }

  playResponseChunk(base64: string): void {
    this.initOutput();
    const ctx = this.outputAudioCtx!;

    try {
      const pcm16 = base64ToPCM16(base64);
      const float32 = pcm16ToFloat32(pcm16);

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Route through the output visualiser analyser
      source.connect(this.outputAnalyser!);

      const now = ctx.currentTime;
      if (this.nextStartTime < now) {
        this.nextStartTime = now + 0.05; // 50ms security gap
      }

      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const index = this.activeSources.indexOf(source);
        if (index > -1) {
          this.activeSources.splice(index, 1);
        }
      };
    } catch (e) {
      console.error("Failed to schedule audio output playback:", e);
    }
  }

  interrupt(): void {
    console.log("Interrupting output playback: stopping", this.activeSources.length, "sources.");
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source not started or already stopped
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
  }

  setMute(muted: boolean): void {
    this.isMuted = muted;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  getVolumeLevels(): { input: number; output: number } {
    return {
      input: this.calculateVolume(this.inputAnalyser),
      output: this.calculateVolume(this.outputAnalyser)
    };
  }

  getWaveformData(): { input: Uint8Array; output: Uint8Array } {
    const inputArr = new Uint8Array(this.inputAnalyser ? this.inputAnalyser.frequencyBinCount : 0);
    const outputArr = new Uint8Array(this.outputAnalyser ? this.outputAnalyser.frequencyBinCount : 0);

    if (this.inputAnalyser) {
      this.inputAnalyser.getByteFrequencyData(inputArr);
    }
    if (this.outputAnalyser) {
      this.outputAnalyser.getByteFrequencyData(outputArr);
    }

    return { input: inputArr, output: outputArr };
  }

  private calculateVolume(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / bufferLength);
    // Amplify slightly for visualization sensitivity
    return Math.min(1.0, rms * 4.0);
  }

  close(): void {
    this.cleanupInput();
    this.interrupt();
    if (this.outputAudioCtx) {
      this.outputAudioCtx.close();
      this.outputAudioCtx = null;
    }
    this.outputAnalyser = null;
  }
}
