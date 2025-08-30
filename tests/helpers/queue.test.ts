import { describe, it, expect } from 'bun:test';
import { ArrayBufferedQueue } from '../../packages/schema/src/types';

describe('ArrayBufferedQueue', () => {
  it('should initialize with a capacity', () => {
    const queue = new ArrayBufferedQueue<number>(5);
    expect(queue.size()).toBe(0);
  });

  it('should add items to the queue', () => {
    const queue = new ArrayBufferedQueue<number>(5);
    queue.add(1);
    queue.add(2);
    expect(queue.size()).toBe(2);
    expect(queue.list()).toEqual([1, 2]);
  });

  it('should return the latest item', () => {
    const queue = new ArrayBufferedQueue<number>(5);
    queue.add(1);
    queue.add(2);
    expect(queue.latest()).toBe(2);
  });

  it('should overwrite the oldest item when capacity is exceeded', () => {
    const queue = new ArrayBufferedQueue<number>(3);
    queue.add(1);
    queue.add(2);
    queue.add(3);
    queue.add(4);
    expect(queue.size()).toBe(3);
    expect(queue.list()).toEqual([2, 3, 4]);
  });

  it('should clear the queue', () => {
    const queue = new ArrayBufferedQueue<number>(5);
    queue.add(1);
    queue.add(2);
    queue.clear();
    expect(queue.size()).toBe(0);
    expect(queue.list()).toEqual([]);
  });

  it('should return null for latest when queue is empty', () => {
    const queue = new ArrayBufferedQueue<number>(5);
    expect(queue.latest()).toBe(null);
  });
});
