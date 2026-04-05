/**
 * Token Bucket Rate Limiter
 * 
 * Simple in-memory rate limiter for API requests.
 * For production, consider Redis-backed distributed rate limiting.
 */

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private config: {
      capacity: number;      // Maximum tokens (burst capacity)
      refillRate: number;    // Tokens per second
    }
  ) {
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }

  async consume(tokens: number = 1): Promise<void> {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Calculate wait time
    const tokensNeeded = tokens - this.tokens;
    const waitMs = (tokensNeeded / this.config.refillRate) * 1000;
    
    await sleep(waitMs);
    return this.consume(tokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const tokensToAdd = (elapsedMs / 1000) * this.config.refillRate;
    
    this.tokens = Math.min(this.config.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
