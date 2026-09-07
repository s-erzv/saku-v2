import { ethers } from 'ethers';

const IDRX_DECIMALS = 18;

/**
 * Format IDRX amount untuk display
 */
export function formatIDRX(amount: bigint): string {
  return ethers.formatUnits(amount, IDRX_DECIMALS);
}

/**
 * Parse IDRX amount dari user input
 */
export function parseIDRX(amount: string): bigint {
  return ethers.parseUnits(amount, IDRX_DECIMALS);
}

/**
 * Format wallet address (truncate)
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format timestamp to date
 */
export function formatDate(timestamp: bigint | number): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}