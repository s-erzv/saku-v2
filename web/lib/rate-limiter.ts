/**
 * Rate Limiter Utility
 * Implements in-memory rate limiting with sliding window
 * Upgrade to Redis for production scalability
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private requests = new Map<string, RateLimitInfo>();

  /**
   * Check if request is allowed based on rate limit config
   * @param identifier - Unique identifier (phone, IP, etc.)
   * @param config - Rate limit configuration
   * @returns Rate limit status
   */
  check(identifier: string, config: RateLimitConfig): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
  } {
    const now = Date.now();
    const existing = this.requests.get(identifier);

    // If no existing record or window expired, create new
    if (!existing || now > existing.resetTime) {
      const resetTime = now + config.windowMs;
      this.requests.set(identifier, {
        count: 1,
        resetTime
      });

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetTime
      };
    }

    // Check if limit exceeded
    if (existing.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: existing.resetTime
      };
    }

    // Increment counter
    existing.count++;
    this.requests.set(identifier, existing);

    return {
      allowed: true,
      remaining: config.maxRequests - existing.count,
      resetTime: existing.resetTime
    };
  }

  /**
   * Reset rate limit for specific identifier
   * @param identifier - Unique identifier to reset
   */
  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  /**
   * Clean up expired entries (call periodically to prevent memory leak)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.requests.entries()) {
      if (now > value.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  /**
   * Get current count for identifier
   * @param identifier - Unique identifier
   * @returns Current count or 0 if not found
   */
  getCount(identifier: string): number {
    const record = this.requests.get(identifier);
    if (!record) return 0;

    // Check if expired
    if (Date.now() > record.resetTime) {
      this.requests.delete(identifier);
      return 0;
    }

    return record.count;
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Run cleanup every 10 minutes to prevent memory leak
if (typeof window === 'undefined') {
  setInterval(() => {
    rateLimiter.cleanup();
  }, 10 * 60 * 1000);
}

/**
 * Rate limit configurations
 */
export const RATE_LIMITS = {
  OTP_REQUEST: {
    maxRequests: 3,
    windowMs: 5 * 60 * 1000 // 5 minutes
  },
  OTP_VERIFY: {
    maxRequests: 3,
    windowMs: 5 * 60 * 1000 // 5 minutes
  },
  IP_BASED: {
    maxRequests: 20,
    windowMs: 60 * 1000 // 1 minute
  },
  GENERAL_API: {
    maxRequests: 100,
    windowMs: 60 * 1000 // 1 minute
  }
} as const;
