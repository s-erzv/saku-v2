import { ethers } from 'ethers';
import {SAKU_REGISTRY_ABI} from './abi';

export const SAKU_ABI = SAKU_REGISTRY_ABI;

export const hashPhone = (phone: string) => {
  const cleanPhone = phone.replace(/\D/g, '');
  return ethers.keccak256(ethers.toUtf8Bytes(cleanPhone));
};
export const getProvider = () => {
  const url = process.env.NEXT_PUBLIC_RPC_URL;
  if (!url) {
      return new ethers.JsonRpcProvider("https://sepolia.base.org");
  }
  return new ethers.JsonRpcProvider(url);
};
/**
 * Convert token amount to human readable format
 */
export const fromTokenAmount = (amount: bigint, decimals: number = 6): string => {
  return ethers.formatUnits(amount, decimals);
};

/**
 * Convert amount to token decimals
 */
export const toTokenAmount = (amount: string, decimals: number = 6): bigint => {
  return ethers.parseUnits(amount, decimals);
};

/**
 * Check if address is valid Ethereum address
 */
export const isValidAddress = (address: string): boolean => {
  return ethers.isAddress(address);
};

