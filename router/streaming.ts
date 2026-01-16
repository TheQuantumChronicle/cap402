/**
 * Streaming Response System
 * 
 * For capabilities that produce incremental results (e.g., real-time price feeds,
 * document parsing progress), support Server-Sent Events (SSE) streaming.
 * 
 * This is infrastructure-first: agents get real-time updates without polling.
 */

import { EventEmitter } from 'events';

export interface StreamEvent {
  type: 'progress' | 'data' | 'complete' | 'error';
  capability_id: string;
  request_id: string;
  data?: any;
  progress?: number; // 0-100
  timestamp: number;
}

class StreamManager extends EventEmitter {
  private activeStreams: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Create a new stream for a capability invocation
   */
  createStream(request_id: string, capability_id: string): void {
    // Emit initial event
    this.emit('stream', {
      type: 'progress',
      capability_id,
      request_id,
      progress: 0,
      timestamp: Date.now()
    });
  }

  /**
   * Send progress update
   */
  sendProgress(request_id: string, capability_id: string, progress: number, data?: any): void {
    this.emit('stream', {
      type: 'progress',
      capability_id,
      request_id,
      progress,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Send incremental data
   */
  sendData(request_id: string, capability_id: string, data: any): void {
    this.emit('stream', {
      type: 'data',
      capability_id,
      request_id,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Complete the stream
   */
  complete(request_id: string, capability_id: string, finalData: any): void {
    this.emit('stream', {
      type: 'complete',
      capability_id,
      request_id,
      data: finalData,
      progress: 100,
      timestamp: Date.now()
    });

    // Cleanup
    const timeout = this.activeStreams.get(request_id);
    if (timeout) {
      clearTimeout(timeout);
      this.activeStreams.delete(request_id);
    }
  }

  /**
   * Send error and close stream
   */
  error(request_id: string, capability_id: string, error: string): void {
    this.emit('stream', {
      type: 'error',
      capability_id,
      request_id,
      data: { error },
      timestamp: Date.now()
    });

    // Cleanup
    const timeout = this.activeStreams.get(request_id);
    if (timeout) {
      clearTimeout(timeout);
      this.activeStreams.delete(request_id);
    }
  }

  /**
   * Set timeout for stream (auto-cleanup)
   */
  setTimeout(request_id: string, ms: number): void {
    const timeout = setTimeout(() => {
      this.error(request_id, 'unknown', 'Stream timeout');
    }, ms);
    timeout.unref(); // Don't keep process alive
    this.activeStreams.set(request_id, timeout);
  }
}

export const streamManager = new StreamManager();

/**
 * Example: Streaming price updates
 * 
 * Instead of polling /invoke every second, agent subscribes to a stream
 * and receives updates as they happen.
 */
export function streamPriceUpdates(
  request_id: string,
  base_token: string,
  quote_token: string,
  duration_ms: number = 60000
): void {
  streamManager.createStream(request_id, 'cap.price.lookup.v1');
  streamManager.setTimeout(request_id, duration_ms);

  // Simulate real-time price updates (in production, this would connect to BirdEye WebSocket)
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    
    // Send price update
    streamManager.sendData(request_id, 'cap.price.lookup.v1', {
      price: 141.82 + (Math.random() - 0.5) * 2, // Simulated price movement
      timestamp: Date.now()
    });

    streamManager.sendProgress(request_id, 'cap.price.lookup.v1', progress);

    if (progress >= 100) {
      clearInterval(interval);
      streamManager.complete(request_id, 'cap.price.lookup.v1', {
        message: 'Stream complete'
      });
    }
  }, duration_ms / 10);
}
