import * as THREE from 'three';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;

  private compressor: DynamicsCompressorNode | null = null;
  private dryBus: GainNode | null = null;
  private wetBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      this.unlock();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.ctx && !this.compressor) {
      this.buildMasterGraph(this.ctx);
    }
    return this.ctx;
  }

  private buildMasterGraph(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(ctx.destination);
    this.compressor = compressor;

    const dryBus = ctx.createGain();
    dryBus.gain.value = 0.88;
    dryBus.connect(compressor);
    this.dryBus = dryBus;

    const wetBus = ctx.createGain();
    wetBus.gain.value = 0.34;
    const reverbFilter = ctx.createBiquadFilter();
    reverbFilter.type = 'lowpass';
    reverbFilter.frequency.value = 3400;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.createReverbIR(ctx, 0.8);
    wetBus.connect(reverbFilter);
    reverbFilter.connect(convolver);
    convolver.connect(compressor);
    this.wetBus = wetBus;

    this.noiseBuffer = this.createWhiteNoiseBuffer(ctx, 1.5);
  }

  private createReverbIR(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, 2.8);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buffer;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private routeVoice(ctx: AudioContext, sourceOut: AudioNode, wetAmount = 0.25, pan = 0): void {
    const dry = this.dryBus ?? ctx.destination;
    let target: AudioNode = sourceOut;

    if (Math.abs(pan) > 0.02 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));
      sourceOut.connect(panner);
      target = panner;
    }

    target.connect(dry);
    if (wetAmount > 0 && this.wetBus) {
      const wetSend = ctx.createGain();
      wetSend.gain.value = wetAmount;
      target.connect(wetSend);
      wetSend.connect(this.wetBus);
    }
  }

  private playNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    q: number,
    peakGain: number,
    wetAmount = 0.25,
    pan = 0
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.02);
    const offset = Math.random() * maxOffset;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.02, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    this.routeVoice(ctx, gain, wetAmount, pan);
    src.start(startTime, offset, duration + 0.02);
  }

  public playHover(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [680, 684].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f + 160, now + 0.045);

      gain.gain.setValueAtTime(idx === 0 ? 0.024 : 0.016, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.24);
      osc.start(now);
      osc.stop(now + 0.06);
    });
  }

  public playSelect(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [523.25, 659.25];
    freqs.forEach((f, idx) => {
      const t0 = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.08, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.3);
      osc.start(t0);
      osc.stop(t0 + 0.17);
    });
  }

  public playSuccess(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [587.33, 739.99, 880.0, 1174.66];
    freqs.forEach((f, idx) => {
      const t0 = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(idx === 3 ? 0.065 : 0.095, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
  }

  public playMiss(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(92, now + 0.18);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    this.routeVoice(ctx, gain, 0.18);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playSliceSwing(intensity = 0.7, pan = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.max(0.3, Math.min(1.0, intensity));
    this.playNoiseBurst(
      ctx,
      now,
      0.13,
      'bandpass',
      480 + clamped * 260,
      1450 + clamped * 650,
      2.1,
      0.065 * clamped,
      0.22,
      pan
    );
  }

  public playSliceHit(combo: number, isGold = false, pan = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
    const step = Math.min(pentatonic.length - 1, Math.max(0, combo - 1));
    const baseFreq = pentatonic[step] * (isGold ? 1.25 : 1.0);

    // 1. Sub punch for physical impact
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(155, now);
    sub.frequency.exponentialRampToValueAtTime(52, now + 0.085);
    subGain.gain.setValueAtTime(0.16, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
    sub.connect(subGain);
    this.routeVoice(ctx, subGain, 0.1, pan);
    sub.start(now);
    sub.stop(now + 0.1);

    // 2. Crisp crystalline slash tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.08);
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    osc.connect(gain);
    this.routeVoice(ctx, gain, 0.34, pan);
    osc.start(now);
    osc.stop(now + 0.18);

    // 3. High harmonic shimmer
    const overtone = ctx.createOscillator();
    const overGain = ctx.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(baseFreq * 2.0, now);
    overtone.frequency.exponentialRampToValueAtTime(baseFreq * (isGold ? 3.0 : 2.2), now + 0.13);
    overGain.gain.setValueAtTime(isGold ? 0.085 : 0.05, now);
    overGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    overtone.connect(overGain);
    this.routeVoice(ctx, overGain, 0.38, pan);
    overtone.start(now);
    overtone.stop(now + 0.17);

    // 4. Short crystalline shatter spark noise
    this.playNoiseBurst(ctx, now, 0.04, 'highpass', 2400, 3800, 1.0, 0.075, 0.25, pan);
  }

  public playBreathCue(inhale: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const startFreq = inhale ? 220 : 330;
    const endFreq = inhale ? 330 : 196;

    [1.0, 1.5].forEach((mult, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq * mult, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq * mult, now + 0.95);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.045 : 0.024, now + 0.32);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.45);
      osc.start(now);
      osc.stop(now + 1.1);
    });

    // Soft wave-like air sweep
    this.playNoiseBurst(
      ctx,
      now,
      0.95,
      'bandpass',
      inhale ? 280 : 520,
      inhale ? 560 : 240,
      1.6,
      0.016,
      0.45
    );
  }

  public playSpatialPing(
    position: THREE.Vector3,
    listenerPos: THREE.Vector3,
    listenerQuat?: THREE.Quaternion
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    const rel = position.clone().sub(listenerPos);
    if (listenerQuat) {
      rel.applyQuaternion(listenerQuat.clone().invert());
    }

    if (typeof ctx.createPanner === 'function') {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 20;
      panner.positionX.value = rel.x;
      panner.positionY.value = rel.y;
      panner.positionZ.value = rel.z;

      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this.dryBus ?? ctx.destination);
      if (this.wetBus) {
        const wetSend = ctx.createGain();
        wetSend.gain.value = 0.25;
        panner.connect(wetSend);
        wetSend.connect(this.wetBus);
      }
    } else {
      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.25, Math.max(-1, Math.min(1, rel.x / 2)));
    }

    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playUnderwaterChime(pitchIndex = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
    const root = scale[Math.abs(pitchIndex) % scale.length];
    const now = ctx.currentTime;

    [root, root * 1.5].forEach((freq, idx) => {
      const t0 = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.06, t0 + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.55);
      osc.start(t0);
      osc.stop(t0 + 1.3);
    });
  }

  public playBubbleSound(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pops = [
      { delay: 0, f0: 270, f1: 600, amp: 0.065 },
      { delay: 0.048, f0: 360, f1: 780, amp: 0.05 },
      { delay: 0.098, f0: 440, f1: 920, amp: 0.04 }
    ];
    for (const p of pops) {
      const t0 = now + p.delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.f0, t0);
      osc.frequency.exponentialRampToValueAtTime(p.f1, t0 + 0.09);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(p.amp, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.42);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    }
  }
}
