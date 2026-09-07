/**
 * Authentication Middleware
 * Validates JWT tokens and extracts user information
 */

import { verifyToken, extractTokenFromHeader } from './jwt';
import type { SakuJWTPayload } from './jwt';
import { NextResponse } from 'next/server';

/**
 * Authentication result interface
 */
export interface AuthResult {
  valid: boolean;
  /** keccak256 of the caller's phone number. The plain number is never in the session token. */
  phoneHash?: string;
  /** `users.id`. */
  userId?: string;
  error?: string;
}

/**
 * Validate authentication from request
 * @param req - Request object
 * @returns Authentication result
 */
export async function validateAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization');

  // Check if Authorization header exists
  if (!authHeader) {
    return {
      valid: false,
      error: 'No authorization header provided'
    };
  }

  // Extract token from Bearer header
  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    return {
      valid: false,
      error: 'Invalid authorization header format. Expected: Bearer <token>'
    };
  }

  try {
    // Verify token
    const payload = await verifyToken(token);

    return {
      valid: true,
      phoneHash: payload.phoneHash,
      userId: payload.userId
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid or expired token. Please login again.'
    };
  }
}

/**
 * Express/Next.js middleware wrapper
 * Use this to protect API routes
 * @param handler - API route handler
 * @returns Protected API route handler
 */
export function withAuth<T extends any[]>(
  handler: (req: Request, auth: AuthResult & { valid: true }, ...args: T) => Promise<Response>
) {
  return async (req: Request, ...args: T): Promise<Response> => {
    const auth = await validateAuth(req);

    if (!auth.valid) {
      return NextResponse.json(
        {
          error: auth.error || 'Authentication failed',
          code: 'UNAUTHORIZED'
        },
        { status: 401 }
      );
    }

    // Type assertion since we know it's valid
    return handler(req, auth as AuthResult & { valid: true }, ...args);
  };
}

/**
 * Extract client IP address from request
 * @param req - Request object
 * @returns IP address or null
 */
export function extractClientIP(req: Request): string | null {
  // Check various headers for IP address
  const headers = req.headers;

  return (
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    null
  );
}

/**
 * Extract user agent from request
 * @param req - Request object
 * @returns User agent string or null
 */
export function extractUserAgent(req: Request): string | null {
  return req.headers.get('user-agent') || null;
}

/**
 * Create 401 Unauthorized response
 * @param message - Error message
 * @returns NextResponse with 401 status
 */
export function unauthorizedResponse(message: string = 'Authentication required') {
  return NextResponse.json(
    {
      error: message,
      code: 'UNAUTHORIZED'
    },
    { status: 401 }
  );
}

/**
 * Create 403 Forbidden response
 * @param message - Error message
 * @returns NextResponse with 403 status
 */
export function forbiddenResponse(message: string = 'Access forbidden') {
  return NextResponse.json(
    {
      error: message,
      code: 'FORBIDDEN'
    },
    { status: 403 }
  );
}
