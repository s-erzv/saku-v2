import { ethers } from 'ethers';

/**
 * Hash phone number using keccak256
 * @param phoneNumber - Phone number in any format
 * @returns bytes32 hash suitable for smart contract storage
 * 
 * @example
 * hashPhoneNumber('+62812-3456-7890') 
 * // returns '0x...' (32 bytes hash)
 */
export function hashPhoneNumber(phoneNumber: string): string {
  // Normalize phone number to match registration format
  // Remove all non-digits to match verify-otp normalizePhone function
  let normalized = phoneNumber.replace(/\D/g, '');

  // Convert 0xxx to 62xxx (Indonesia format)
  if (normalized.startsWith('0')) {
    normalized = '62' + normalized.substring(1);
  }

  // Hash using keccak256 (same as Solidity's keccak256)
  const hash = ethers.keccak256(ethers.toUtf8Bytes(normalized));

  return hash;
}

/**
 * Normalize phone number to consistent format
 * @param phoneNumber - Phone number in any format
 * @returns Normalized phone number (digits only)
 * 
 * @example
 * normalizePhoneNumber('+62 812-3456-7890')
 * // returns '+6281234567890'
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/[\s\-\(\)]/g, '');
}

/**
 * Validate phone number format
 * @param phoneNumber - Phone number to validate
 * @returns true if valid format
 * 
 * Basic validation: starts with + and contains 10-15 digits
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  const normalized = normalizePhoneNumber(phoneNumber);
  
  // Check if starts with + and has 10-15 digits
  const regex = /^\+\d{10,15}$/;
  return regex.test(normalized);
}

/**
 * Format phone number for display (Indonesia format)
 * @param phoneNumber - Phone number to format
 * @returns Formatted phone number
 * 
 * @example
 * formatPhoneNumber('+628123456789')
 * // returns '+62 812-3456-789'
 */
export function formatPhoneNumber(phoneNumber: string): string {
  const normalized = normalizePhoneNumber(phoneNumber);
  
  // Indonesian phone number format: +62 XXX-XXXX-XXXX
  if (normalized.startsWith('+62')) {
    const digits = normalized.slice(3);
    if (digits.length >= 9) {
      return `+62 ${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
  }
  
  return phoneNumber;
}