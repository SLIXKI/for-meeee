export type Tier = 0 | 1 | 2;

export interface DeviceProfile {
  tier: Tier;
  reduced: boolean;
  hover: boolean;
  coarse: boolean;
  dpr: number;
}

type ExtendedNavigator = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

export function getProfile(): DeviceProfile {
  const nav = navigator as ExtendedNavigator;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const constrained = (nav.hardwareConcurrency ?? 4) < 4
    || (nav.deviceMemory !== undefined && nav.deviceMemory <= 2)
    || !!nav.connection?.saveData;
  // Tier = QUALITY budget only. Motion itself is never stripped —
  // low tiers get lower resolution / fewer particles / cheaper shading,
  // but every animation still runs.
  const tier: Tier = constrained ? 0 : coarse ? 1 : 2;
  return { tier, reduced, hover, coarse, dpr: Math.min(devicePixelRatio || 1, tier === 2 ? 1.75 : tier === 1 ? 1.35 : 1) };
}

export interface Quality {
  /** WebGL background scale multiplier */
  shaderScale: number;
  /** WebGL pixel budget */
  shaderBudget: number;
  /** WebGL frames per second */
  shaderFps: number;
  /** FBM octaves in gold shader */
  octaves: number;
  /** Confetti pool size */
  confetti: number;
  /** Confetti burst default */
  burst: number;
  /** Dust trail pool */
  trail: number;
  /** Gallery fps */
  galleryFps: number;
  /** Max gallery blur px */
  blurMax: number;
  /** Dither wobble fps */
  ditherFps: number;
}

export const QUALITY: Record<Tier, Quality> = {
  0: { shaderScale: 0.3, shaderBudget: 160000, shaderFps: 16, octaves: 2, confetti: 90, burst: 60, trail: 60, galleryFps: 30, blurMax: 3, ditherFps: 20 },
  1: { shaderScale: 0.45, shaderBudget: 420000, shaderFps: 20, octaves: 3, confetti: 150, burst: 90, trail: 100, galleryFps: 60, blurMax: 5, ditherFps: 24 },
  2: { shaderScale: 0.55, shaderBudget: 640000, shaderFps: 24, octaves: 4, confetti: 220, burst: 120, trail: 140, galleryFps: 60, blurMax: 7, ditherFps: 30 },
};

export function getQuality(profile: DeviceProfile): Quality {
  return QUALITY[profile.tier];
}
