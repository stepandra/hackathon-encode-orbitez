// @ts-nocheck

/**
 * Represents a value that can change over time, with a generator that
 * exposes changes to the value.
 *
 * Watchers are not guaranteed to see every intermediate value, but are
 * guaranteed to see the last value in a series of updates.
 */
export class ValueStream<T> {
  private wakers: Array<(closed: boolean) => void> = [];
  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(newValue: T) {
    if (this.isClosed()) {
      throw new Error('Cannot change a closed value stream');
    }
    this.value = newValue;
    const wakers = this.wakers;
    this.wakers = [];
    wakers.forEach((waker) => waker(false));
  }

  close() {
    if (this.isClosed()) {
      return;
    }
    const finalWakers = this.wakers;
    this.wakers = null;
    finalWakers.forEach((waker) => waker(true));
  }

  isClosed() {
    return this.wakers === null;
  }

  private nextChange(): Promise<boolean> {
    if (this.isClosed()) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => this.wakers.push(resolve));
  }

  async *watch(): AsyncGenerator<T, void> {
    let closed = false;
    while (!closed) {
      const nextChange = this.nextChange();
      yield this.value;
      closed = await nextChange;
    }
    yield this.value;
  }
}
