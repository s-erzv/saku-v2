/**
 * Audit Logger Utility
 * Logs security events for monitoring and analysis
 */

import { createClient } from '@supabase/supabase-js';

type SecurityEventType =
  | 'otp_request'
  | 'otp_request_rate_limited'
  | 'otp_verify_success'
  | 'otp_verify_failed'
  | 'otp_verify_rate_limited'
  | 'login_success'
  | 'login_failed'
  | 'transaction_signed'
  | 'transaction_failed'
  | 'ip_rate_limited'
  | 'suspicious_activity';

export interface AuditLogEvent {
  type: SecurityEventType;
  phone?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

/**
 * Log security event to database
 * @param event - Security event to log
 */
export async function logSecurityEvent(event: AuditLogEvent): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { fetch: (...args) => fetch(...args) },
    });

    // Log to security_events table
    await supabase.from('security_events').insert({
      event_type: event.type,
      phone_number: event.phone || null,
      ip_address: event.ip || null,
      user_agent: event.userAgent || null,
      metadata: event.metadata || {},
      timestamp: event.timestamp || new Date().toISOString(),
    });
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
  }
}

/**
 * Log OTP request
 */
export async function logOTPRequest(phone: string, ip?: string, userAgent?: string): Promise<void> {
  await logSecurityEvent({
    type: 'otp_request',
    phone,
    ip,
    userAgent,
  });
}

/**
 * Log OTP rate limit exceeded
 */
export async function logOTPRateLimit(phone: string, ip?: string): Promise<void> {
  await logSecurityEvent({
    type: 'otp_request_rate_limited',
    phone,
    ip,
    metadata: {
      reason: 'Too many OTP requests',
    },
  });
}

/**
 * Log successful OTP verification
 */
export async function logOTPVerifySuccess(phone: string, ip?: string): Promise<void> {
  await logSecurityEvent({
    type: 'otp_verify_success',
    phone,
    ip,
  });
}

/**
 * Log failed OTP verification
 */
export async function logOTPVerifyFailed(phone: string, ip?: string): Promise<void> {
  await logSecurityEvent({
    type: 'otp_verify_failed',
    phone,
    ip,
  });
}

/**
 * Log transaction
 */
export async function logTransaction(
  phone: string,
  txType: string,
  txHash: string,
  amount?: string,
  ip?: string
): Promise<void> {
  await logSecurityEvent({
    type: txType === 'success' ? 'transaction_signed' : 'transaction_failed',
    phone,
    ip,
    metadata: {
      txHash,
      amount,
      txType,
    },
  });
}

/**
 * Log suspicious activity
 */
export async function logSuspiciousActivity(
  phone: string,
  reason: string,
  ip?: string,
  metadata?: Record<string, any>
): Promise<void> {
  await logSecurityEvent({
    type: 'suspicious_activity',
    phone,
    ip,
    metadata: {
      reason,
      ...metadata,
    },
  });
}
