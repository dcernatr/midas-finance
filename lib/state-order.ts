// Shared by the UI and race-condition tests. A read never replaces a pending write.
export class StateOrder {
  private version = 0;
  private writes = 0;
  private tail: Promise<unknown> = Promise.resolve();
  invalidate() { this.version++; }
  beginRead() { return this.writes ? null : ++this.version; }
  accepts(token: number) { return token === this.version && this.writes === 0; }
  get pending() { return this.writes > 0; }
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.writes++; this.invalidate();
    const task = this.tail.then(work);
    this.tail = task.catch(() => undefined);
    return task.finally(() => { this.writes--; this.invalidate(); });
  }
}
