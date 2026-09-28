import { restoreGeometries } from './mesh-snapshot.js';

export class MeshWorkerPool {
  constructor(atlas, count = 2) {
    this.layout = { tiles: [...atlas.tiles], width: atlas.canvas.width, height: atlas.canvas.height };
    this.workers = []; this.queue = []; this.nextId = 1;
    this.stats = { workers: 0, completed: 0, workerMilliseconds: 0, failures: 0 }; this.failed = false;
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' }), slot = { worker, job: null };
        worker.onmessage = event => {
          const job = slot.job; if (!job || event.data.id !== job.id) return;
          slot.job = null;
          if (event.data.error) { job.reject(new Error(event.data.error)); this.fail(new Error(event.data.error)); return; }
          this.stats.completed++; this.stats.workerMilliseconds += event.data.elapsedMs;
          try { job.resolve(restoreGeometries(event.data.result)); } catch (error) { job.reject(error); this.fail(error); }
          this.pump();
        };
        worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'Mesh worker failed')); };
        this.workers.push(slot);
      }
      this.stats.workers = this.workers.length;
    } catch (error) { this.fail(error); }
  }
  run(neighbors, key, smooth) {
    if (this.failed) return Promise.reject(new Error('Mesh workers unavailable'));
    return new Promise((resolve, reject) => { this.queue.push({ id: this.nextId++, neighbors, key, smooth, resolve, reject }); this.pump(); });
  }
  pump() {
    if (this.failed) return;
    for (const slot of this.workers) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift(); slot.job = job;
      const transfers = job.neighbors.flatMap(chunk => [chunk.data.buffer, chunk.state.buffer, chunk.sky.buffer, chunk.glow.buffer]);
      try { slot.worker.postMessage({ id: job.id, neighbors: job.neighbors, key: job.key, smooth: job.smooth, atlas: this.layout }, transfers); }
      catch (error) { this.fail(error); }
    }
  }
  fail(error) {
    if (this.failed) return;
    this.failed = true; this.stats.failures++; this.stats.workers = 0;
    for (const slot of this.workers) { slot.worker.terminate(); slot.job?.reject(error); slot.job = null; }
    for (const job of this.queue.splice(0)) job.reject(error);
    console.warn('Mesh workers unavailable; using synchronous meshing:', error.message);
  }
}
