import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import { QcError } from './contracts.js';

export interface OllamaHostResources {
  at: string;
  cpuPercent: number;
  availableRamBytes: number;
  gpus: Array<{ name: string; freeMiB: number; usedMiB: number; utilizationPercent: number }>;
  blocked?: boolean;
}

interface QueuedRun {
  start: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OllamaRuntimeOptions {
  maxQueued?: number;
  maxQueueWaitMs?: number;
  failureThreshold?: number;
  circuitCooldownMs?: number;
  minAvailableRamBytes?: number;
  /** Hard floor while a run is in progress (the model's own memory must not abort it). */
  minRuntimeRamBytes?: number;
  /** Extra headroom required to START a run when the model is already resident. */
  residentAdmissionMarginBytes?: number;
  minGpuFreeMiB?: number;
  maxIdleCpuPercent?: number;
  telemetryRequired?: boolean;
  telemetryFile?: string;
  killSwitchFile?: string;
  now?: () => number;
  readResources?: () => Promise<OllamaHostResources>;
  killSwitchActive?: () => Promise<boolean>;
}

const DEFAULT_OPTIONS: Required<Omit<OllamaRuntimeOptions, 'readResources' | 'killSwitchActive'>> = {
  maxQueued: 2,
  maxQueueWaitMs: 60_000,
  failureThreshold: 3,
  circuitCooldownMs: 30_000,
  minAvailableRamBytes: 3 * 1024 ** 3,
  minRuntimeRamBytes: 1024 ** 3,
  residentAdmissionMarginBytes: 512 * 1024 ** 2,
  minGpuFreeMiB: 2048,
  maxIdleCpuPercent: 90,
  telemetryRequired: process.env.AI_QC_RESOURCE_GUARD_REQUIRED === 'true',
  telemetryFile: process.env.AI_QC_HOST_RESOURCE_FILE || '/run/aiqc/host-resources.json',
  killSwitchFile: process.env.AI_QC_OLLAMA_KILL_SWITCH_FILE || '/run/aiqc/STOP',
  now: Date.now,
};

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
}

async function readHostResources(file: string): Promise<OllamaHostResources> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QcError('OLLAMA_RESOURCE_TELEMETRY_INVALID', 503);
  const sample = value as Partial<OllamaHostResources>;
  const ageMs = Date.now() - Date.parse(String(sample.at ?? ''));
  if (!Number.isFinite(ageMs) || ageMs < -5000 || ageMs > 15_000 || !Number.isFinite(sample.cpuPercent) ||
      !Number.isSafeInteger(sample.availableRamBytes) || !Array.isArray(sample.gpus) || !sample.gpus.length ||
      sample.gpus.some(g => !g || typeof g.name !== 'string' || !Number.isFinite(g.freeMiB) || !Number.isFinite(g.usedMiB) || !Number.isFinite(g.utilizationPercent)))
    throw new QcError('OLLAMA_RESOURCE_TELEMETRY_STALE_OR_INVALID', 503);
  return sample as OllamaHostResources;
}

export class OllamaRuntimeSafety {
  private active = false;
  private readonly queue: QueuedRun[] = [];
  private failures = 0;
  private circuitOpenUntil = 0;
  private started = 0;
  private succeeded = 0;
  private failed = 0;
  private timeouts = 0;
  private queueRejected = 0;
  private totalLatencyMs = 0;
  private readonly latencies: number[] = [];
  private lastResources: OllamaHostResources | null = null;
  private readonly options: Required<Omit<OllamaRuntimeOptions, 'readResources' | 'killSwitchActive'>> & Pick<OllamaRuntimeOptions, 'readResources' | 'killSwitchActive'>;

  constructor(options: OllamaRuntimeOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Non-blocking pre-check used before a preview token is consumed. Never throws. */
  async admission(resident = false): Promise<{ ok: true; freeRamBytes: number } | { ok: false; code: string; freeRamBytes: number | null }> {
    if (this.options.now() < this.circuitOpenUntil) return { ok: false, code: 'OLLAMA_CIRCUIT_OPEN', freeRamBytes: null };
    if (this.active && this.queue.length >= this.options.maxQueued) return { ok: false, code: 'OLLAMA_QUEUE_FULL', freeRamBytes: null };
    try { const s = await this.assertSafe('admission', resident); return { ok: true, freeRamBytes: s.availableRamBytes }; }
    catch (error) { return { ok: false, code: errorCode(error) || 'OLLAMA_RESOURCE_GUARD_FAILED', freeRamBytes: this.lastResources?.availableRamBytes ?? null }; }
  }

  async run<T>(operation: (assertSafe: () => Promise<OllamaHostResources>) => Promise<T>, opts: { resident?: boolean } = {}): Promise<T> {
    const release = await this.acquire();
    const startedAt = this.options.now();
    this.started++;
    try {
      await this.assertSafe('admission', !!opts.resident);
      const value = await operation(() => this.assertSafe('runtime'));
      this.failures = 0;
      this.succeeded++;
      return value;
    } catch (error) {
      this.failed++;
      if (errorCode(error) === 'OLLAMA_TIMEOUT') this.timeouts++;
      if (!['OLLAMA_QUEUE_FULL', 'OLLAMA_QUEUE_TIMEOUT', 'OLLAMA_CIRCUIT_OPEN', 'OLLAMA_RESOURCE_KILL_SWITCH',
        'OLLAMA_RESOURCE_TELEMETRY_REQUIRED', 'OLLAMA_RESOURCE_TELEMETRY_INVALID', 'OLLAMA_RESOURCE_TELEMETRY_STALE_OR_INVALID',
        'OLLAMA_RESOURCE_LIMIT'].includes(errorCode(error))) {
        this.failures++;
        if (this.failures >= this.options.failureThreshold) this.circuitOpenUntil = this.options.now() + this.options.circuitCooldownMs;
      }
      throw error;
    } finally {
      const elapsed = Math.max(0, this.options.now() - startedAt);
      this.totalLatencyMs += elapsed;
      this.latencies.push(elapsed);
      if (this.latencies.length > 256) this.latencies.shift();
      release();
    }
  }

  private acquire(): Promise<() => void> {
    if (this.options.now() < this.circuitOpenUntil) throw new QcError('OLLAMA_CIRCUIT_OPEN', 503);
    if (!this.active) {
      this.active = true;
      return Promise.resolve(() => this.releaseNext());
    }
    if (this.queue.length >= this.options.maxQueued) {
      this.queueRejected++;
      throw new QcError('OLLAMA_QUEUE_FULL', 429);
    }
    return new Promise((resolve, reject) => {
      const item: QueuedRun = {
        start: release => resolve(release),
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(item);
          if (index >= 0) this.queue.splice(index, 1);
          this.queueRejected++;
          reject(new QcError('OLLAMA_QUEUE_TIMEOUT', 429));
        }, this.options.maxQueueWaitMs),
      };
      item.timer.unref?.();
      this.queue.push(item);
    });
  }

  private releaseNext() {
    while (this.queue.length) {
      const next = this.queue.shift()!;
      clearTimeout(next.timer);
      next.start(() => this.releaseNext());
      return;
    }
    this.active = false;
  }

  private async assertSafe(phase: 'admission' | 'runtime' = 'runtime', resident = false): Promise<OllamaHostResources> {
    const killSwitch = this.options.killSwitchActive ?? (async () => {
      try { await access(this.options.killSwitchFile); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    });
    if (await killSwitch()) throw new QcError('OLLAMA_RESOURCE_KILL_SWITCH', 503);

    let sample: OllamaHostResources;
    if (this.options.readResources) sample = await this.options.readResources();
    else if (this.options.telemetryRequired) {
      try { sample = await readHostResources(this.options.telemetryFile); }
      catch (error) {
        if (error instanceof QcError) throw error;
        throw new QcError('OLLAMA_RESOURCE_TELEMETRY_REQUIRED', 503);
      }
    } else sample = { at: new Date().toISOString(), cpuPercent: 0, availableRamBytes: os.freemem(), gpus: [] };

    this.lastResources = sample;
    const ramFloor = phase === 'runtime' ? this.options.minRuntimeRamBytes
      : resident ? this.options.minRuntimeRamBytes + this.options.residentAdmissionMarginBytes : this.options.minAvailableRamBytes;
    const gpuFloor = phase === 'runtime' ? Math.floor(this.options.minGpuFreeMiB / 2) : this.options.minGpuFreeMiB;
    if (sample.blocked || sample.availableRamBytes < ramFloor || (phase === 'admission' && sample.cpuPercent >= this.options.maxIdleCpuPercent) ||
        sample.gpus.some(gpu => gpu.freeMiB < gpuFloor)) throw new QcError('OLLAMA_RESOURCE_LIMIT', 503);
    if (this.options.telemetryRequired && !sample.gpus.length) throw new QcError('OLLAMA_RESOURCE_TELEMETRY_REQUIRED', 503);
    return sample;
  }

  metrics() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]! : null;
    return {
      concurrencyLimit: 1 as const, active: this.active ? 1 : 0, queueDepth: this.queue.length, maxQueued: this.options.maxQueued,
      started: this.started, succeeded: this.succeeded, failed: this.failed, timeouts: this.timeouts, queueRejected: this.queueRejected,
      averageLatencyMs: this.started ? Math.round(this.totalLatencyMs / this.started) : null, p95LatencyMs: percentile(.95),
      circuit: this.options.now() < this.circuitOpenUntil ? 'OPEN' : 'CLOSED', circuitOpenUntil: this.circuitOpenUntil || null,
      resources: this.lastResources ? { at: this.lastResources.at, cpuPercent: this.lastResources.cpuPercent,
        availableRamBytes: this.lastResources.availableRamBytes,
        gpu: this.lastResources.gpus.map(g => ({ name: g.name, usedMiB: g.usedMiB, freeMiB: g.freeMiB, utilizationPercent: g.utilizationPercent })) } : null,
    };
  }
}

export const ollamaRuntimeSafety = new OllamaRuntimeSafety();
export function ollamaResourceGuardConfigured(env: NodeJS.ProcessEnv = process.env) {
  return env.AI_QC_RESOURCE_GUARD_REQUIRED === 'true' && !!env.AI_QC_HOST_RESOURCE_FILE && !!env.AI_QC_OLLAMA_KILL_SWITCH_FILE;
}
