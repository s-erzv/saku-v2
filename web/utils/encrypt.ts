import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.ENCRYPTION_KEY || '';

/**
 * Encryption result interface
 */
export interface EncryptedData {
  encryptedData: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt text using AES-256-GCM
 * @param text - Plain text to encrypt (e.g., private key)
 * @returns Object containing encrypted data, IV, and auth tag
 * 
 * @example
 * const encrypted = encrypt('0x1234...privatekey');
 * // Store encrypted.encryptedData, encrypted.iv, encrypted.authTag in database
 */
export function encrypt(text: string): EncryptedData {
  if (!MASTER_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // Generate random 12-byte IV for GCM mode
  const iv = crypto.randomBytes(12);
  
  // Create cipher with master key and IV
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(MASTER_KEY, 'hex'),
    iv
  );

  // Encrypt the text
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get authentication tag (GCM mode)
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag,
  };
}

/**
 * Decrypt text using AES-256-GCM
 * @param encryptedData - Encrypted text (hex string)
 * @param iv - Initialization vector (hex string)
 * @param authTag - Authentication tag (hex string)
 * @returns Decrypted plain text
 * 
 * @example
 * const decrypted = decrypt(data.encryptedData, data.iv, data.authTag);
 * // Use decrypted private key
 */
export function decrypt(
  encryptedData: string,
  iv: string,
  authTag: string
): string {
  if (!MASTER_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // Create decipher
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(MASTER_KEY, 'hex'),
    Buffer.from(iv, 'hex')
  );

  // Set authentication tag
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  // Decrypt the data
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a new master key for encryption
 * @returns 32-byte hex string (64 characters)
 * 
 * @example
 * const masterKey = generateMasterKey();
 * // Store in .env as ENCRYPTION_KEY=<masterKey>
 */
export function generateMasterKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate master key format
 * @param key - Master key to validate
 * @returns true if valid (32 bytes / 64 hex chars)
 */
export function isValidMasterKey(key: string): boolean {
  // Must be 64 hex characters (32 bytes)
  return /^[0-9a-fA-F]{64}$/.test(key);
}

/**
 * Encrypt private key specifically (with validation)
 * @param privateKey - Ethereum private key (with or without 0x prefix)
 * @returns Encrypted data object
 */
export function encryptPrivateKey(privateKey: string): EncryptedData {
  // Validate private key format (64 hex chars with optional 0x prefix)
  const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  
  if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    throw new Error('Invalid private key format');
  }

  return encrypt(privateKey);
}

/**
 * Decrypt and validate private key
 * @param encryptedData - Encrypted private key data
 * @param iv - Initialization vector
 * @param authTag - Authentication tag
 * @returns Decrypted private key
 */
export function decryptPrivateKey(
  encryptedData: string,
  iv: string,
  authTag: string
): string {
  const decrypted = decrypt(encryptedData, iv, authTag);

  // Validate decrypted private key
  const cleanKey = decrypted.startsWith('0x') ? decrypted.slice(2) : decrypted;
  
  if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    throw new Error('Decrypted data is not a valid private key');
  }

  return decrypted;
}