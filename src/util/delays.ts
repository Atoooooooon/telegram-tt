import { randomInt } from './math';
import { pause } from './schedulers';

export function sleep(ms: number): Promise<void> {
  return pause(ms);
}

export function randomIntBetween(min: number, max: number): number {
  return randomInt(min, max);
}

export function randomDelayMs(minMs: number, maxMs: number): number {
  return randomIntBetween(minMs, maxMs);
}

export type HumanDelayOptions = {
  minMs?: number;
  maxMs?: number;
};

const DEFAULT_HUMAN_DELAY: Required<HumanDelayOptions> = {
  minMs: 250,
  maxMs: 750,
};

function resolveRange(overrides?: HumanDelayOptions): Required<HumanDelayOptions> {
  const min = overrides?.minMs ?? DEFAULT_HUMAN_DELAY.minMs;
  const max = overrides?.maxMs ?? DEFAULT_HUMAN_DELAY.maxMs;
  const normalizedMin = Math.max(0, min);
  return {
    minMs: normalizedMin,
    maxMs: Math.max(normalizedMin, max),
  };
}

export function getHumanDelayMs(overrides?: HumanDelayOptions): number {
  const { minMs, maxMs } = resolveRange(overrides);
  if (minMs <= 0 && maxMs <= 0) {
    return 0;
  }
  return randomDelayMs(minMs, maxMs);
}

export async function waitHumanLike(overrides?: HumanDelayOptions): Promise<void> {
  const delayMs = getHumanDelayMs(overrides);
  if (!delayMs) {
    return;
  }
  await sleep(delayMs);
}
