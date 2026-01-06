import { pause } from './schedulers';
import { randomInt } from './math';

export function sleep(ms: number): Promise<void> {
  return pause(ms);
}

export function randomIntBetween(min: number, max: number): number {
  return randomInt(min, max);
}

export function randomDelayMs(minMs: number, maxMs: number): number {
  return randomIntBetween(minMs, maxMs);
}

