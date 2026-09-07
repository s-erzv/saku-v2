import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm'; 
const MASTER_KEY = process.env.ENCRYPTION_KEY || ''; 

export function encrypt(text: string) {
  const iv = crypto.randomBytes(12);  
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(MASTER_KEY, 'hex'), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

export function decrypt(encryptedData: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM, 
    Buffer.from(MASTER_KEY, 'hex'), 
    Buffer.from(iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}