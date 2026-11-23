import type { EntityId, FlagKey } from "../types";

export type FootstepSurface = "dirt" | "mud" | "wood" | "gravel";

type ActId = "ACT_1" | "ACT_2";

interface VoiceProfile {
  freq: number;
  wave: OscillatorType;
  filterHz: number;
  duration: number;
  gain: number;
  pitchEndRatio: number;
  shimmer?: boolean;
}

interface AmbienceLayer {
  id: string;
  gainNode: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  timers: number[];
}

interface ChordVoicing {
  notes: number[];
  colorNote?: number;
}

const MASTER_GAIN_DEFAULT = 0.85;
const MUSIC_BUS_GAIN = 0.52;
const AMBIENCE_BUS_GAIN = 0.9;
const SFX_BUS_GAIN = 0.95;
const BLIP_MIN_INTERVAL_MS = 45;

// Cozy nostalgic Stardew-inspired lo-fi progression (Fmaj7 -> Em7 -> Dm7 -> Cmaj7 + warm variation)
const COZY_PROGRESSION: readonly ChordVoicing[] = [
  { notes: [174.61, 220.0, 261.63, 329.63], colorNote: 392.0 }, // Fmaj7 (+G4)
  { notes: [164.81, 196.0, 246.94, 293.66], colorNote: 329.63 }, // Em7 (+E4)
  { notes: [146.83, 174.61, 220.0, 261.63], colorNote: 329.63 }, // Dm7 (+E4)
  { notes: [130.81, 164.81, 196.0, 246.94], colorNote: 293.66 }, // Cmaj7 (+D4)
  { notes: [174.61, 220.0, 261.63, 329.63], colorNote: 440.0 }, // Fmaj7 (+A4)
  { notes: [196.0, 246.94, 293.66, 329.63], colorNote: 392.0 }, // G6 (+G4)
  { notes: [220.0, 261.63, 329.63, 392.0], colorNote: 493.88 }, // Am7 (+B4)
  { notes: [130.81, 196.0, 246.94, 293.66], colorNote: 329.63 }, // Cmaj9 (+E4)
];

const VOICE_PROFILES: Record<EntityId, VoiceProfile> = {
  TEREZA: {
    freq: 390,
    wave: "sine",
    filterHz: 940,
    duration: 0.036,
    gain: 0.055,
    pitchEndRatio: 0.96,
  },
  AMARINA: {
    freq: 420,
    wave: "sine",
    filterHz: 1020,
    duration: 0.038,
    gain: 0.052,
    pitchEndRatio: 0.98,
  },
  DILAN: {
    freq: 230,
    wave: "triangle",
    filterHz: 660,
    duration: 0.036,
    gain: 0.06,
    pitchEndRatio: 0.92,
  },
  ODELIA: {
    freq: 540,
    wave: "sine",
    filterHz: 1350,
    duration: 0.04,
    gain: 0.044,
    pitchEndRatio: 1.03,
    shimmer: true,
  },
  JADEN: {
    freq: 300,
    wave: "triangle",
    filterHz: 900,
    duration: 0.034,
    gain: 0.054,
    pitchEndRatio: 0.89,
  },
  MARK: {
    freq: 200,
    wave: "triangle",
    filterHz: 560,
    duration: 0.038,
    gain: 0.062,
    pitchEndRatio: 0.88,
  },
  ROMENO: {
    freq: 255,
    wave: "sine",
    filterHz: 720,
    duration: 0.042,
    gain: 0.058,
    pitchEndRatio: 0.94,
  },
  CALEB: {
    freq: 275,
    wave: "sine",
    filterHz: 760,
    duration: 0.036,
    gain: 0.054,
    pitchEndRatio: 0.95,
  },
  JOSEPH: {
    freq: 580,
    wave: "sine",
    filterHz: 1420,
    duration: 0.032,
    gain: 0.042,
    pitchEndRatio: 1.02,
  },
  SFX: {
    freq: 320,
    wave: "triangle",
    filterHz: 680,
    duration: 0.022,
    gain: 0.036,
    pitchEndRatio: 0.82,
  },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;

  private pinkNoiseBuffer: AudioBuffer | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private currentAmbientId: string | null = null;
  private currentAct: ActId = "ACT_1";
  private currentFlags: Partial<Record<FlagKey, boolean>> = {};

  private activeAmbience: AmbienceLayer | null = null;
  private fadingLayers = new Set<AmbienceLayer>();
  private cleanupTimers = new Set<number>();

  private musicRunning = false;
  private musicAbruptlyCut = false;
  private wasCutByFlags = false;
  private musicTimer: number | null = null;
  private chordIndex = 0;
  private activeMusicSources = new Set<OscillatorNode>();

  private lastBlipMs = 0;

  public unlock(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;

      if (ctx.state === "suspended") {
        void ctx
          .resume()
          .then(() => {
            this.syncAllPlayback();
          })
          .catch(() => {
            // Autoplay blocked or unavailable; ignore silently.
          });
      } else if (ctx.state === "running") {
        this.syncAllPlayback();
      }
    } catch {
      // Never throw or log console errors.
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    try {
      this.muted = Boolean(muted);
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const target = this.muted ? 0 : MASTER_GAIN_DEFAULT;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(target, now, 0.03);
    } catch {
      // Ignore audio errors silently.
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setRoomAudio(
    ambientLoopId: string,
    act: "ACT_1" | "ACT_2",
    flags: Partial<Record<FlagKey, boolean>>
  ): void {
    try {
      this.currentAmbientId = ambientLoopId;
      this.currentAct = act;
      this.currentFlags = { ...flags };

      const tense = this.hasTensionCutoff(this.currentFlags);
      if (tense) {
        this.wasCutByFlags = true;
        this.cutMusicAbruptly();
      } else {
        // Fresh Act I or clean Act II state allows lo-fi music when appropriate.
        this.musicAbruptlyCut = false;
        this.wasCutByFlags = false;
      }

      if (!this.ctx || this.ctx.state !== "running") return;

      this.transitionAmbience(ambientLoopId);
      this.evaluateMusicState();
    } catch {
      // Ignore audio errors silently.
    }
  }

  public syncNarrativeTension(flags: Partial<Record<FlagKey, boolean>>): void {
    try {
      this.currentFlags = { ...flags };
      if (this.hasTensionCutoff(this.currentFlags)) {
        this.wasCutByFlags = true;
        this.cutMusicAbruptly();
        return;
      }

      if (this.wasCutByFlags) {
        this.wasCutByFlags = false;
        this.musicAbruptlyCut = false;
      }

      if (!this.ctx || this.ctx.state !== "running") return;
      this.evaluateMusicState();
    } catch {
      // Ignore audio errors silently.
    }
  }

  public cutMusicAbruptly(): void {
    try {
      this.musicAbruptlyCut = true;
      this.musicRunning = false;

      if (this.musicTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(this.musicTimer);
        this.musicTimer = null;
      }

      if (this.ctx && this.musicBus) {
        const now = this.ctx.currentTime;
        // Immediate hard cut to uncanny silence.
        this.musicBus.gain.cancelScheduledValues(now);
        this.musicBus.gain.setValueAtTime(0, now);

        for (const osc of this.activeMusicSources) {
          try {
            osc.stop(now + 0.003);
            osc.disconnect();
          } catch {
            // Oscillator may already be stopped.
          }
        }
        this.activeMusicSources.clear();
      }
    } catch {
      // Ignore audio errors silently.
    }
  }

  public playFootstep(surface: FootstepSurface): void {
    try {
      const ctx = this.getReadyContext();
      if (!ctx || !this.sfxBus) return;

      const now = ctx.currentTime;
      const pitchJitter = 0.92 + Math.random() * 0.16;
      const gainJitter = 0.86 + Math.random() * 0.26;

      switch (surface) {
        case "dirt": {
          // Soft dry earthy crunch + subtle heel thump
          this.playFilteredNoise(ctx, this.sfxBus, {
            buffer: this.pinkNoiseBuffer,
            startTime: now,
            duration: 0.06,
            filterType: "bandpass",
            freqStart: 920 * pitchJitter,
            freqEnd: 540 * pitchJitter,
            q: 1.2,
            gainPeak: 0.065 * gainJitter,
            attack: 0.006,
          });
          this.playSoftTone(ctx, this.sfxBus, {
            startTime: now,
            duration: 0.045,
            wave: "sine",
            freqStart: 112 * pitchJitter,
            freqEnd: 52,
            gainPeak: 0.036 * gainJitter,
            attack: 0.004,
            lowpassHz: 320,
          });
          break;
        }
        case "mud": {
          // Damp low squelch with downward resonant suction sweep
          this.playFilteredNoise(ctx, this.sfxBus, {
            buffer: this.pinkNoiseBuffer,
            startTime: now,
            duration: 0.09,
            filterType: "bandpass",
            freqStart: 640 * pitchJitter,
            freqEnd: 240 * pitchJitter,
            q: 3.1,
            gainPeak: 0.075 * gainJitter,
            attack: 0.012,
          });
          this.playSoftTone(ctx, this.sfxBus, {
            startTime: now + 0.008,
            duration: 0.075,
            wave: "sine",
            freqStart: 96 * pitchJitter,
            freqEnd: 46,
            gainPeak: 0.05 * gainJitter,
            attack: 0.008,
            lowpassHz: 260,
          });
          break;
        }
        case "wood": {
          // Warm hollow wooden floorboard knock
          this.playSoftTone(ctx, this.sfxBus, {
            startTime: now,
            duration: 0.068,
            wave: "triangle",
            freqStart: 195 * pitchJitter,
            freqEnd: 92 * pitchJitter,
            gainPeak: 0.058 * gainJitter,
            attack: 0.003,
            lowpassHz: 780,
          });
          this.playSoftTone(ctx, this.sfxBus, {
            startTime: now,
            duration: 0.045,
            wave: "sine",
            freqStart: 340 * pitchJitter,
            freqEnd: 175 * pitchJitter,
            gainPeak: 0.03 * gainJitter,
            attack: 0.002,
            lowpassHz: 900,
          });
          this.playFilteredNoise(ctx, this.sfxBus, {
            buffer: this.pinkNoiseBuffer,
            startTime: now,
            duration: 0.024,
            filterType: "bandpass",
            freqStart: 1200 * pitchJitter,
            freqEnd: 700 * pitchJitter,
            q: 1.5,
            gainPeak: 0.022 * gainJitter,
            attack: 0.002,
          });
          break;
        }
        case "gravel": {
          // Crisp granular micro-taps on sun-baked gravel
          const grainOffsets = [0, 0.015, 0.031];
          for (let i = 0; i < grainOffsets.length; i++) {
            const offset = grainOffsets[i] + Math.random() * 0.006;
            const grainPitch = (0.85 + Math.random() * 0.35) * pitchJitter;
            this.playFilteredNoise(ctx, this.sfxBus, {
              buffer: this.whiteNoiseBuffer,
              startTime: now + offset,
              duration: 0.022 + Math.random() * 0.012,
              filterType: "bandpass",
              freqStart: (2100 + i * 280) * grainPitch,
              freqEnd: 1500 * grainPitch,
              q: 1.9,
              gainPeak: (0.042 - i * 0.007) * gainJitter,
              attack: 0.002,
            });
          }
          this.playSoftTone(ctx, this.sfxBus, {
            startTime: now,
            duration: 0.04,
            wave: "sine",
            freqStart: 132 * pitchJitter,
            freqEnd: 68,
            gainPeak: 0.03 * gainJitter,
            attack: 0.003,
            lowpassHz: 360,
          });
          break;
        }
      }
    } catch {
      // Ignore audio errors silently.
    }
  }

  public playUiClick(): void {
    try {
      const ctx = this.getReadyContext();
      if (!ctx || !this.sfxBus) return;

      const now = ctx.currentTime;
      const jitter = 0.96 + Math.random() * 0.08;
      // Soft tactile Stardew-style wooden tick
      this.playSoftTone(ctx, this.sfxBus, {
        startTime: now,
        duration: 0.026,
        wave: "triangle",
        freqStart: 540 * jitter,
        freqEnd: 245 * jitter,
        gainPeak: 0.065,
        attack: 0.002,
        lowpassHz: 1400,
      });
      this.playFilteredNoise(ctx, this.sfxBus, {
        buffer: this.pinkNoiseBuffer,
        startTime: now,
        duration: 0.014,
        filterType: "bandpass",
        freqStart: 1750 * jitter,
        freqEnd: 1100 * jitter,
        q: 1.8,
        gainPeak: 0.022,
        attack: 0.001,
      });
    } catch {
      // Ignore audio errors silently.
    }
  }

  public playJournalPaper(opening: boolean): void {
    try {
      const ctx = this.getReadyContext();
      if (!ctx || !this.sfxBus) return;

      const now = ctx.currentTime;
      if (opening) {
        // Aged notebook page turn / gentle unfold brush
        this.playFilteredNoise(ctx, this.sfxBus, {
          buffer: this.whiteNoiseBuffer,
          startTime: now,
          duration: 0.19,
          filterType: "bandpass",
          freqStart: 1150,
          freqEnd: 2350,
          q: 1.4,
          gainPeak: 0.055,
          attack: 0.028,
        });
        this.playFilteredNoise(ctx, this.sfxBus, {
          buffer: this.pinkNoiseBuffer,
          startTime: now + 0.065,
          duration: 0.13,
          filterType: "bandpass",
          freqStart: 1850,
          freqEnd: 1200,
          q: 1.8,
          gainPeak: 0.036,
          attack: 0.02,
        });
      } else {
        // Soft downward brush + muted notebook cover close
        this.playFilteredNoise(ctx, this.sfxBus, {
          buffer: this.whiteNoiseBuffer,
          startTime: now,
          duration: 0.14,
          filterType: "bandpass",
          freqStart: 2050,
          freqEnd: 920,
          q: 1.5,
          gainPeak: 0.048,
          attack: 0.018,
        });
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now + 0.055,
          duration: 0.055,
          wave: "sine",
          freqStart: 148,
          freqEnd: 74,
          gainPeak: 0.045,
          attack: 0.004,
          lowpassHz: 340,
        });
      }
    } catch {
      // Ignore audio errors silently.
    }
  }

  public playTextBlip(speaker: EntityId): void {
    try {
      const nowMs = Date.now();
      if (nowMs - this.lastBlipMs < BLIP_MIN_INTERVAL_MS) return;
      this.lastBlipMs = nowMs;

      const ctx = this.getReadyContext();
      if (!ctx || !this.sfxBus) return;

      const profile = VOICE_PROFILES[speaker] ?? VOICE_PROFILES.TEREZA;
      const now = ctx.currentTime;
      const pitchJitter = 0.95 + Math.random() * 0.1;
      const startFreq = profile.freq * pitchJitter;
      const endFreq = startFreq * profile.pitchEndRatio;

      this.playSoftTone(ctx, this.sfxBus, {
        startTime: now,
        duration: profile.duration,
        wave: profile.wave,
        freqStart: startFreq,
        freqEnd: endFreq,
        gainPeak: profile.gain,
        attack: 0.005,
        lowpassHz: profile.filterHz,
      });

      if (profile.shimmer) {
        // Subtle delicate glassy overtone for Odélia's overly sweet tone
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now,
          duration: profile.duration * 0.85,
          wave: "sine",
          freqStart: startFreq * 2,
          freqEnd: endFreq * 2,
          gainPeak: profile.gain * 0.22,
          attack: 0.004,
          lowpassHz: profile.filterHz * 1.4,
        });
      }
    } catch {
      // Ignore audio errors silently.
    }
  }

  public playCue(sfxId?: string): void {
    try {
      if (!sfxId) return;
      const ctx = this.getReadyContext();
      if (!ctx || !this.sfxBus) return;

      const now = ctx.currentTime;

      if (sfxId === "SFX_BRANCH_SNAP") {
        // Crisp dry twig crack + dual descending woody transients
        this.playFilteredNoise(ctx, this.sfxBus, {
          buffer: this.whiteNoiseBuffer,
          startTime: now,
          duration: 0.032,
          filterType: "bandpass",
          freqStart: 1900,
          freqEnd: 950,
          q: 1.3,
          gainPeak: 0.22,
          attack: 0.001,
        });
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now,
          duration: 0.06,
          wave: "triangle",
          freqStart: 560,
          freqEnd: 135,
          gainPeak: 0.15,
          attack: 0.001,
          lowpassHz: 1800,
        });
        this.playFilteredNoise(ctx, this.sfxBus, {
          buffer: this.whiteNoiseBuffer,
          startTime: now + 0.036,
          duration: 0.042,
          filterType: "bandpass",
          freqStart: 2450,
          freqEnd: 1100,
          q: 1.6,
          gainPeak: 0.16,
          attack: 0.001,
        });
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now + 0.04,
          duration: 0.075,
          wave: "triangle",
          freqStart: 370,
          freqEnd: 110,
          gainPeak: 0.13,
          attack: 0.002,
          lowpassHz: 1400,
        });
        return;
      }

      if (sfxId === "SFX_GEIGER_SPIKE") {
        // Authentic irregular Geiger-Müller crackling spike (~1.1s) + subtle warning beep
        let cursor = 0.0;
        let step = 0;
        while (cursor < 1.06) {
          const densityFactor = cursor > 0.15 && cursor < 0.78 ? 0.55 : 1.0;
          const gap = (0.022 + Math.random() * 0.048) * densityFactor;
          const clickTime = now + cursor;
          const clickFreq = 2200 + Math.random() * 1500;
          const clickGain = 0.075 + Math.random() * 0.065;

          this.playFilteredNoise(ctx, this.sfxBus, {
            buffer: this.whiteNoiseBuffer,
            startTime: clickTime,
            duration: 0.007,
            filterType: "bandpass",
            freqStart: clickFreq,
            freqEnd: clickFreq * 0.8,
            q: 2.2,
            gainPeak: clickGain,
            attack: 0.0006,
          });
          if (step % 2 === 0) {
            this.playSoftTone(ctx, this.sfxBus, {
              startTime: clickTime,
              duration: 0.006,
              wave: "square",
              freqStart: 2800 + Math.random() * 800,
              freqEnd: 1400,
              gainPeak: 0.035,
              attack: 0.0005,
              lowpassHz: 4200,
            });
          }

          cursor += gap;
          step += 1;
        }

        // Subtle Geiger alert beep at the climax of the burst
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now + 0.78,
          duration: 0.13,
          wave: "sine",
          freqStart: 1840,
          freqEnd: 1825,
          gainPeak: 0.055,
          attack: 0.006,
          lowpassHz: 2600,
        });
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now + 0.95,
          duration: 0.14,
          wave: "sine",
          freqStart: 1840,
          freqEnd: 1820,
          gainPeak: 0.048,
          attack: 0.006,
          lowpassHz: 2600,
        });
        return;
      }

      if (sfxId === "SFX_DOOR_SLAM_LOCK") {
        // Weighty heavy wooden door slam followed by metallic bolt lock
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now,
          duration: 0.24,
          wave: "sine",
          freqStart: 102,
          freqEnd: 34,
          gainPeak: 0.28,
          attack: 0.003,
          lowpassHz: 220,
        });
        this.playFilteredNoise(ctx, this.sfxBus, {
          buffer: this.pinkNoiseBuffer,
          startTime: now,
          duration: 0.19,
          filterType: "lowpass",
          freqStart: 420,
          freqEnd: 120,
          q: 0.9,
          gainPeak: 0.22,
          attack: 0.003,
        });
        // Heavy iron deadbolt sliding & clacking shut
        this.playMetallicClack(ctx, this.sfxBus, now + 0.21, 1.0);
        this.playMetallicClack(ctx, this.sfxBus, now + 0.34, 0.85);
        return;
      }

      if (sfxId === "SFX_HEAVY_LOCK_RATTLE") {
        // Heavy door shudder + double metallic latch/lock rattle
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now,
          duration: 0.16,
          wave: "sine",
          freqStart: 112,
          freqEnd: 46,
          gainPeak: 0.2,
          attack: 0.004,
          lowpassHz: 260,
        });
        this.playMetallicClack(ctx, this.sfxBus, now + 0.015, 0.95);
        this.playMetallicClack(ctx, this.sfxBus, now + 0.15, 1.05);
        this.playSoftTone(ctx, this.sfxBus, {
          startTime: now + 0.16,
          duration: 0.14,
          wave: "sine",
          freqStart: 94,
          freqEnd: 42,
          gainPeak: 0.15,
          attack: 0.004,
          lowpassHz: 220,
        });
        return;
      }

      // Gentle fallback cue for any unrecognized sfxId
      this.playSoftTone(ctx, this.sfxBus, {
        startTime: now,
        duration: 0.06,
        wave: "triangle",
        freqStart: 310,
        freqEnd: 165,
        gainPeak: 0.06,
        attack: 0.004,
        lowpassHz: 900,
      });
    } catch {
      // Ignore audio errors silently.
    }
  }

  public stopAll(): void {
    try {
      this.currentAmbientId = null;
      this.musicAbruptlyCut = false;
      this.wasCutByFlags = false;
      this.stopMusicPlayback(true);

      if (this.activeAmbience) {
        this.disposeAmbienceLayer(this.activeAmbience);
        this.activeAmbience = null;
      }
      for (const layer of this.fadingLayers) {
        this.disposeAmbienceLayer(layer);
      }
      this.fadingLayers.clear();

      if (typeof window !== "undefined") {
        for (const id of this.cleanupTimers) {
          window.clearTimeout(id);
        }
      }
      this.cleanupTimers.clear();
    } catch {
      // Ignore audio errors silently.
    }
  }

  // ---------- Internal Audio Graph Setup ----------

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Gentle warm mastering chain: buses -> DynamicsCompressor -> masterGain -> destination
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(3.5, ctx.currentTime);
    compressor.attack.setValueAtTime(0.008, ctx.currentTime);
    compressor.release.setValueAtTime(0.18, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.muted ? 0 : MASTER_GAIN_DEFAULT, ctx.currentTime);

    const ambienceBus = ctx.createGain();
    ambienceBus.gain.setValueAtTime(AMBIENCE_BUS_GAIN, ctx.currentTime);

    const musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.setValueAtTime(920, ctx.currentTime);
    musicFilter.Q.setValueAtTime(0.65, ctx.currentTime);

    const musicBus = ctx.createGain();
    musicBus.gain.setValueAtTime(
      this.musicAbruptlyCut ? 0 : MUSIC_BUS_GAIN,
      ctx.currentTime
    );

    const sfxBus = ctx.createGain();
    sfxBus.gain.setValueAtTime(SFX_BUS_GAIN, ctx.currentTime);

    ambienceBus.connect(compressor);
    musicFilter.connect(musicBus);
    musicBus.connect(compressor);
    sfxBus.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.masterGain = masterGain;
    this.ambienceBus = ambienceBus;
    this.musicFilter = musicFilter;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;

    this.pinkNoiseBuffer = this.createPinkNoiseBuffer(ctx, 4.0);
    this.whiteNoiseBuffer = this.createWhiteNoiseBuffer(ctx, 1.5);

    return ctx;
  }

  private getReadyContext(): AudioContext | null {
    if (!this.ctx || this.ctx.state !== "running") return null;
    return this.ctx;
  }

  private syncAllPlayback(): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    if (this.currentAmbientId) {
      this.transitionAmbience(this.currentAmbientId);
    }
    this.evaluateMusicState();
  }

  private hasTensionCutoff(flags: Partial<Record<FlagKey, boolean>>): boolean {
    return Boolean(flags.FLAG_JADEN_VISTO || flags.FLAG_PORTA_TRANCADA);
  }

  // ---------- Noise Buffer Generators (Generated Once) ----------

  private createPinkNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const warmup = Math.floor(sampleRate * 0.25);
    const total = length + warmup;
    const raw = new Float32Array(total);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < total; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.max(-0.9, Math.min(0.9, raw[i + warmup]));
    }

    // Equal-power seam crossfade so looped ambience has zero boundary click
    const fadeSamples = Math.min(Math.floor(sampleRate * 0.12), Math.floor(length * 0.1));
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      const head = data[i];
      const tail = data[length - fadeSamples + i];
      data[length - fadeSamples + i] = tail * (1 - t) + head * t;
    }

    return buffer;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ---------- Sparse Cozy Lo-Fi Soundtrack (Act II) ----------

  private evaluateMusicState(): void {
    const shouldPlay =
      this.currentAct === "ACT_2" &&
      !this.hasTensionCutoff(this.currentFlags) &&
      !this.musicAbruptlyCut;

    if (shouldPlay) {
      this.startMusicPlayback();
    } else if (this.hasTensionCutoff(this.currentFlags) || this.musicAbruptlyCut) {
      this.cutMusicAbruptly();
    } else {
      // Gentle fade out when leaving Act II to Act I
      this.stopMusicPlayback(false);
    }
  }

  private startMusicPlayback(): void {
    if (this.musicRunning || !this.ctx || !this.musicBus || !this.musicFilter) return;

    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(Math.max(0.0001, this.musicBus.gain.value), now);
    this.musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_GAIN, now + 0.9);

    this.musicRunning = true;
    this.scheduleNextChord(550);
  }

  private stopMusicPlayback(immediate: boolean): void {
    this.musicRunning = false;
    if (this.musicTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }

    if (!this.ctx || !this.musicBus) return;
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);

    if (immediate) {
      this.musicBus.gain.setValueAtTime(0, now);
      for (const osc of this.activeMusicSources) {
        try {
          osc.stop(now + 0.005);
          osc.disconnect();
        } catch {
          // Ignore already stopped oscillators.
        }
      }
      this.activeMusicSources.clear();
    } else {
      this.musicBus.gain.setTargetAtTime(0, now, 0.25);
    }
  }

  private scheduleNextChord(delayMs: number): void {
    if (typeof window === "undefined") return;
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
    }
    this.musicTimer = window.setTimeout(() => {
      this.musicTimer = null;
      if (!this.musicRunning || this.musicAbruptlyCut) return;
      if (!this.ctx || this.ctx.state !== "running") return;

      const chord = COZY_PROGRESSION[this.chordIndex % COZY_PROGRESSION.length];
      this.chordIndex = (this.chordIndex + 1) % COZY_PROGRESSION.length;
      this.playCozyChordArpeggio(chord);

      // Sparse nostalgic pacing (~4.0s to 4.8s per bar with breathing room)
      const nextDelay = 4000 + Math.floor(Math.random() * 800);
      this.scheduleNextChord(nextDelay);
    }, delayMs);
  }

  private playCozyChordArpeggio(chord: ChordVoicing): void {
    if (!this.ctx || !this.musicFilter) return;
    const now = this.ctx.currentTime;
    const stepBase = 0.24 + Math.random() * 0.08;

    chord.notes.forEach((freq, idx) => {
      const startTime = now + idx * stepBase + Math.random() * 0.03;
      const isBass = idx === 0;
      this.playElectricPianoNote(
        freq,
        startTime,
        isBass ? 2.8 : 2.1,
        isBass ? 0.068 : 0.048
      );
    });

    // Occasional delicate sparse melody sparkle half a bar later
    if (chord.colorNote && Math.random() < 0.72) {
      const sparkleTime = now + 1.85 + Math.random() * 0.45;
      this.playElectricPianoNote(chord.colorNote, sparkleTime, 1.8, 0.034);
    }
  }

  private playElectricPianoNote(
    freq: number,
    startTime: number,
    duration: number,
    gainPeak: number
  ): void {
    if (!this.ctx || !this.musicFilter) return;
    const ctx = this.ctx;

    const noteFilter = ctx.createBiquadFilter();
    noteFilter.type = "lowpass";
    noteFilter.frequency.setValueAtTime(1180, startTime);
    noteFilter.frequency.exponentialRampToValueAtTime(640, startTime + duration);
    noteFilter.Q.setValueAtTime(0.6, startTime);

    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0.0001, startTime);
    noteGain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.035);
    noteGain.gain.exponentialRampToValueAtTime(gainPeak * 0.45, startTime + duration * 0.42);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    // Primary warm triangle voice with subtle lo-fi detune
    const mainOsc = ctx.createOscillator();
    mainOsc.type = "triangle";
    mainOsc.frequency.setValueAtTime(freq, startTime);
    mainOsc.detune.setValueAtTime((Math.random() - 0.5) * 5, startTime);

    // Gentle sine body for Rhodes / nylon warmth
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = "sine";
    bodyOsc.frequency.setValueAtTime(freq, startTime);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.45, startTime);

    mainOsc.connect(noteFilter);
    bodyOsc.connect(bodyGain);
    bodyGain.connect(noteFilter);
    noteFilter.connect(noteGain);
    noteGain.connect(this.musicFilter);

    this.activeMusicSources.add(mainOsc);
    this.activeMusicSources.add(bodyOsc);

    const stopAt = startTime + duration + 0.05;
    mainOsc.onended = () => {
      this.activeMusicSources.delete(mainOsc);
      try {
        mainOsc.disconnect();
        noteFilter.disconnect();
        noteGain.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    };
    bodyOsc.onended = () => {
      this.activeMusicSources.delete(bodyOsc);
      try {
        bodyOsc.disconnect();
        bodyGain.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    };

    mainOsc.start(startTime);
    bodyOsc.start(startTime);
    mainOsc.stop(stopAt);
    bodyOsc.stop(stopAt);
  }

  // ---------- ASMR Room Ambience ----------

  private transitionAmbience(ambientLoopId: string): void {
    if (!this.ctx || !this.ambienceBus || !this.pinkNoiseBuffer) return;
    if (this.activeAmbience && this.activeAmbience.id === ambientLoopId) return;

    const now = this.ctx.currentTime;
    const fadeSec = 0.85;

    // Smoothly crossfade out previous ambience layer
    if (this.activeAmbience) {
      const oldLayer = this.activeAmbience;
      this.activeAmbience = null;
      this.clearLayerTimers(oldLayer);
      this.fadingLayers.add(oldLayer);

      oldLayer.gainNode.gain.cancelScheduledValues(now);
      oldLayer.gainNode.gain.setValueAtTime(
        Math.max(0.0001, oldLayer.gainNode.gain.value),
        now
      );
      oldLayer.gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeSec);

      if (typeof window !== "undefined") {
        const timerId = window.setTimeout(() => {
          this.cleanupTimers.delete(timerId);
          this.fadingLayers.delete(oldLayer);
          this.disposeAmbienceLayer(oldLayer);
        }, Math.ceil((fadeSec + 0.12) * 1000));
        this.cleanupTimers.add(timerId);
      }
    }

    const newLayer = this.buildAmbienceLayer(ambientLoopId);
    if (!newLayer) return;

    this.activeAmbience = newLayer;
    newLayer.gainNode.gain.setValueAtTime(0.0001, now);
    newLayer.gainNode.gain.linearRampToValueAtTime(1.0, now + fadeSec);
  }

  private buildAmbienceLayer(ambientLoopId: string): AmbienceLayer | null {
    if (!this.ctx || !this.ambienceBus || !this.pinkNoiseBuffer) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const layerGain = ctx.createGain();
    layerGain.gain.setValueAtTime(0.0001, now);
    layerGain.connect(this.ambienceBus);

    const layer: AmbienceLayer = {
      id: ambientLoopId,
      gainNode: layerGain,
      sources: [],
      nodes: [layerGain],
      timers: [],
    };

    const addLoopedNoise = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.pinkNoiseBuffer;
      src.loop = true;
      const offset = Math.random() * 2.5;
      src.start(now, offset);
      layer.sources.push(src);
      layer.nodes.push(src);
      return src;
    };

    const addLfo = (
      rateHz: number,
      depth: number,
      target: AudioParam
    ): void => {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(rateHz, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(depth, now);
      lfo.connect(lfoGain);
      lfoGain.connect(target);
      lfo.start(now);
      layer.sources.push(lfo);
      layer.nodes.push(lfo, lfoGain);
    };

    switch (ambientLoopId) {
      case "SFX_AMB_WIND_CANVAS": {
        // R01: Warm low-mid wind brushing tent canvas with slow LFO gusting
        const mainNoise = addLoopedNoise();
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(320, now);
        bp.Q.setValueAtTime(1.15, now);

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(1050, now);

        const bedGain = ctx.createGain();
        bedGain.gain.setValueAtTime(0.11, now);

        mainNoise.connect(bp);
        bp.connect(lp);
        lp.connect(bedGain);
        bedGain.connect(layerGain);
        layer.nodes.push(bp, lp, bedGain);

        addLfo(0.13, 95, bp.frequency);
        addLfo(0.08, 0.026, bedGain.gain);

        // Soft dry canvas flutter texture
        const rustleNoise = addLoopedNoise();
        const rustleBp = ctx.createBiquadFilter();
        rustleBp.type = "bandpass";
        rustleBp.frequency.setValueAtTime(760, now);
        rustleBp.Q.setValueAtTime(2.0, now);

        const rustleGain = ctx.createGain();
        rustleGain.gain.setValueAtTime(0.028, now);

        rustleNoise.connect(rustleBp);
        rustleBp.connect(rustleGain);
        rustleGain.connect(layerGain);
        layer.nodes.push(rustleBp, rustleGain);

        addLfo(0.22, 0.014, rustleGain.gain);
        break;
      }

      case "SFX_AMB_VALE_COLD_WIND": {
        // R02: Eerier hollow bandpass breeze with slow pitch drift across open wasteland
        const hollowNoise = addLoopedNoise();
        const hollowBp = ctx.createBiquadFilter();
        hollowBp.type = "bandpass";
        hollowBp.frequency.setValueAtTime(440, now);
        hollowBp.Q.setValueAtTime(2.8, now);

        const hollowGain = ctx.createGain();
        hollowGain.gain.setValueAtTime(0.095, now);

        hollowNoise.connect(hollowBp);
        hollowBp.connect(hollowGain);
        hollowGain.connect(layerGain);
        layer.nodes.push(hollowBp, hollowGain);

        addLfo(0.09, 125, hollowBp.frequency);
        addLfo(0.06, 0.022, hollowGain.gain);

        // Subtle ghostly airy harmonic drift
        const airNoise = addLoopedNoise();
        const airBp = ctx.createBiquadFilter();
        airBp.type = "bandpass";
        airBp.frequency.setValueAtTime(790, now);
        airBp.Q.setValueAtTime(5.2, now);

        const airGain = ctx.createGain();
        airGain.gain.setValueAtTime(0.018, now);

        airNoise.connect(airBp);
        airBp.connect(airGain);
        airGain.connect(layerGain);
        layer.nodes.push(airBp, airGain);

        addLfo(0.055, 110, airBp.frequency);
        break;
      }

      case "SFX_AMB_CABIN_SILENCE":
      case "SFX_AMB_HALL_CREAK": {
        // R03 & R05: Quiet warm timber room tone + sparse subtle floorboard creaks every 5–11s
        const isHall = ambientLoopId === "SFX_AMB_HALL_CREAK";
        const roomNoise = addLoopedNoise();
        const roomLp = ctx.createBiquadFilter();
        roomLp.type = "lowpass";
        roomLp.frequency.setValueAtTime(isHall ? 260 : 300, now);
        roomLp.Q.setValueAtTime(0.6, now);

        const roomGain = ctx.createGain();
        roomGain.gain.setValueAtTime(isHall ? 0.052 : 0.045, now);

        roomNoise.connect(roomLp);
        roomLp.connect(roomGain);
        roomGain.connect(layerGain);
        layer.nodes.push(roomLp, roomGain);

        this.scheduleFloorboardCreak(layer, isHall);
        break;
      }

      case "SFX_AMB_MANOR_QUIET": {
        // R04: Calm cozy morning stillness with soft gentle sunlit air
        const calmNoise = addLoopedNoise();
        const calmLp = ctx.createBiquadFilter();
        calmLp.type = "lowpass";
        calmLp.frequency.setValueAtTime(420, now);
        calmLp.Q.setValueAtTime(0.55, now);

        const calmGain = ctx.createGain();
        calmGain.gain.setValueAtTime(0.044, now);

        calmNoise.connect(calmLp);
        calmLp.connect(calmGain);
        calmGain.connect(layerGain);
        layer.nodes.push(calmLp, calmGain);

        addLfo(0.07, 0.01, calmGain.gain);
        break;
      }

      case "SFX_AMB_FARM_HEAT_CICADAS": {
        // R06: Warm summer breeze + soft high-passed rhythmic cicada shimmer pulses (never piercing)
        const breezeNoise = addLoopedNoise();
        const breezeBp = ctx.createBiquadFilter();
        breezeBp.type = "bandpass";
        breezeBp.frequency.setValueAtTime(360, now);
        breezeBp.Q.setValueAtTime(0.9, now);

        const breezeGain = ctx.createGain();
        breezeGain.gain.setValueAtTime(0.072, now);

        breezeNoise.connect(breezeBp);
        breezeBp.connect(breezeGain);
        breezeGain.connect(layerGain);
        layer.nodes.push(breezeBp, breezeGain);

        addLfo(0.11, 75, breezeBp.frequency);

        // Soft ASMR cicada chorus (bandpass + strict lowpass ceiling so zero ear fatigue)
        const cicadaNoise = addLoopedNoise();
        const cicadaHp = ctx.createBiquadFilter();
        cicadaHp.type = "highpass";
        cicadaHp.frequency.setValueAtTime(2900, now);

        const cicadaBp = ctx.createBiquadFilter();
        cicadaBp.type = "bandpass";
        cicadaBp.frequency.setValueAtTime(3850, now);
        cicadaBp.Q.setValueAtTime(3.2, now);

        const cicadaCeiling = ctx.createBiquadFilter();
        cicadaCeiling.type = "lowpass";
        cicadaCeiling.frequency.setValueAtTime(4900, now);

        // Outer slow breathing chorus swell
        const swellGain = ctx.createGain();
        swellGain.gain.setValueAtTime(0.022, now);

        // Inner gentle rhythmic shimmer pulse
        const shimmerGain = ctx.createGain();
        shimmerGain.gain.setValueAtTime(0.75, now);

        cicadaNoise.connect(cicadaHp);
        cicadaHp.connect(cicadaBp);
        cicadaBp.connect(cicadaCeiling);
        cicadaCeiling.connect(shimmerGain);
        shimmerGain.connect(swellGain);
        swellGain.connect(layerGain);
        layer.nodes.push(
          cicadaHp,
          cicadaBp,
          cicadaCeiling,
          shimmerGain,
          swellGain
        );

        addLfo(0.21, 0.011, swellGain.gain);
        addLfo(10.5, 0.22, shimmerGain.gain);
        break;
      }

      default: {
        // Gentle warm room tone fallback
        const fallbackNoise = addLoopedNoise();
        const fallbackLp = ctx.createBiquadFilter();
        fallbackLp.type = "lowpass";
        fallbackLp.frequency.setValueAtTime(340, now);

        const fallbackGain = ctx.createGain();
        fallbackGain.gain.setValueAtTime(0.042, now);

        fallbackNoise.connect(fallbackLp);
        fallbackLp.connect(fallbackGain);
        fallbackGain.connect(layerGain);
        layer.nodes.push(fallbackLp, fallbackGain);
        break;
      }
    }

    return layer;
  }

  private scheduleFloorboardCreak(layer: AmbienceLayer, isHall: boolean): void {
    if (typeof window === "undefined") return;
    // Sparse subtle wooden creaks every 5 to 11 seconds
    const delayMs = 5000 + Math.floor(Math.random() * 6000);
    const timerId = window.setTimeout(() => {
      const idx = layer.timers.indexOf(timerId);
      if (idx !== -1) layer.timers.splice(idx, 1);

      if (this.activeAmbience !== layer) return;
      if (!this.ctx || this.ctx.state !== "running") return;

      this.playWoodenCreak(this.ctx, layer.gainNode, isHall);
      this.scheduleFloorboardCreak(layer, isHall);
    }, delayMs);

    layer.timers.push(timerId);
  }

  private playWoodenCreak(
    ctx: AudioContext,
    destination: AudioNode,
    isHall: boolean
  ): void {
    try {
      const now = ctx.currentTime;
      const duration = isHall
        ? 0.34 + Math.random() * 0.22
        : 0.22 + Math.random() * 0.16;
      const baseFreq = isHall
        ? 125 + Math.random() * 55
        : 160 + Math.random() * 65;

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, now + duration * 0.65);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.84, now + duration);

      // Subtle micro-flutter gives authentic stressed timber texture
      const wobble = ctx.createOscillator();
      wobble.type = "sine";
      wobble.frequency.setValueAtTime(19 + Math.random() * 14, now);
      const wobbleGain = ctx.createGain();
      wobbleGain.gain.setValueAtTime(8, now);
      wobble.connect(wobbleGain);
      wobbleGain.connect(osc.frequency);

      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(isHall ? 420 : 540, now);
      bp.Q.setValueAtTime(3.0, now);

      const gain = ctx.createGain();
      const peak = 0.02 + Math.random() * 0.014;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + duration * 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(bp);
      bp.connect(gain);
      gain.connect(destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          wobble.disconnect();
          wobbleGain.disconnect();
          bp.disconnect();
          gain.disconnect();
        } catch {
          // Ignore cleanup errors.
        }
      };

      osc.start(now);
      wobble.start(now);
      osc.stop(now + duration + 0.02);
      wobble.stop(now + duration + 0.02);
    } catch {
      // Ignore audio errors silently.
    }
  }

  private clearLayerTimers(layer: AmbienceLayer): void {
    if (typeof window !== "undefined") {
      for (const timerId of layer.timers) {
        window.clearTimeout(timerId);
      }
    }
    layer.timers.length = 0;
  }

  private disposeAmbienceLayer(layer: AmbienceLayer): void {
    this.clearLayerTimers(layer);
    for (const src of layer.sources) {
      try {
        src.stop();
      } catch {
        // Source may already be stopped.
      }
    }
    for (const node of layer.nodes) {
      try {
        node.disconnect();
      } catch {
        // Node may already be disconnected.
      }
    }
    layer.sources.length = 0;
    layer.nodes.length = 0;
  }

  // ---------- Synthesis Primitives ----------

  private playSoftTone(
    ctx: AudioContext,
    destination: AudioNode,
    opts: {
      startTime: number;
      duration: number;
      wave: OscillatorType;
      freqStart: number;
      freqEnd: number;
      gainPeak: number;
      attack: number;
      lowpassHz: number;
    }
  ): void {
    const osc = ctx.createOscillator();
    osc.type = opts.wave;
    osc.frequency.setValueAtTime(Math.max(20, opts.freqStart), opts.startTime);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, opts.freqEnd),
      opts.startTime + opts.duration
    );

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(opts.lowpassHz, opts.startTime);
    filter.Q.setValueAtTime(0.7, opts.startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, opts.startTime);
    gain.gain.linearRampToValueAtTime(
      Math.max(0.0002, opts.gainPeak),
      opts.startTime + opts.attack
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.startTime + opts.duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    };

    osc.start(opts.startTime);
    osc.stop(opts.startTime + opts.duration + 0.015);
  }

  private playFilteredNoise(
    ctx: AudioContext,
    destination: AudioNode,
    opts: {
      buffer: AudioBuffer | null;
      startTime: number;
      duration: number;
      filterType: BiquadFilterType;
      freqStart: number;
      freqEnd: number;
      q: number;
      gainPeak: number;
      attack: number;
    }
  ): void {
    if (!opts.buffer) return;

    const src = ctx.createBufferSource();
    src.buffer = opts.buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(Math.max(40, opts.freqStart), opts.startTime);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.freqEnd),
      opts.startTime + opts.duration
    );
    filter.Q.setValueAtTime(opts.q, opts.startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, opts.startTime);
    gain.gain.linearRampToValueAtTime(
      Math.max(0.0002, opts.gainPeak),
      opts.startTime + opts.attack
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.startTime + opts.duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    };

    const offset = Math.random() * Math.max(0.01, opts.buffer.duration - 0.1);
    src.start(opts.startTime, offset);
    src.stop(opts.startTime + opts.duration + 0.015);
  }

  private playMetallicClack(
    ctx: AudioContext,
    destination: AudioNode,
    startTime: number,
    intensity: number
  ): void {
    // Inharmonic metallic partials + sharp bolt impact transient
    const partials = [
      { f0: 710, f1: 640, dur: 0.095, g: 0.075 },
      { f0: 1380, f1: 1290, dur: 0.075, g: 0.055 },
      { f0: 2180, f1: 2040, dur: 0.055, g: 0.035 },
    ];
    for (const p of partials) {
      this.playSoftTone(ctx, destination, {
        startTime,
        duration: p.dur,
        wave: "triangle",
        freqStart: p.f0,
        freqEnd: p.f1,
        gainPeak: p.g * intensity,
        attack: 0.002,
        lowpassHz: 3400,
      });
    }
    this.playFilteredNoise(ctx, destination, {
      buffer: this.whiteNoiseBuffer,
      startTime,
      duration: 0.032,
      filterType: "bandpass",
      freqStart: 2600,
      freqEnd: 1400,
      q: 2.2,
      gainPeak: 0.11 * intensity,
      attack: 0.001,
    });
  }
}

export const audioEngine = new AudioEngine();
