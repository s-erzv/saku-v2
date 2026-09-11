/**
 * Sending mail over SMTP, configured entirely from the environment.
 *
 * The sending address lives on a domain Saku controls rather than on a Gmail account. That is
 * what makes a message deliverable at all at volume: a domain can publish SPF, DKIM and DMARC
 * records that vouch for the server sending as it, and nobody can do that for gmail.com. Which
 * host does the sending is a deployment detail — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and
 * `SMTP_PASSWORD` — so changing provider changes the environment and not this file.
 */

import nodemailer, { type Transporter } from 'nodemailer';

let cached: Transporter | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new EmailNotConfiguredError(name);
  return value;
}

function smtpHost(): string {
  return process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
}

/**
 * The password exactly as configured, with one exception.
 *
 * Google shows an app password as four groups of four — "abcd efgh ijkl mnop" — and people paste
 * it that way. Gmail accepts it either way, so for Gmail the spaces come out. For any other host
 * this is an ordinary mailbox password, where a space is a real character and stripping it would
 * turn a correct password into a failed login.
 */
function smtpPassword(): string {
  const password = required('SMTP_PASSWORD');
  return smtpHost() === 'smtp.gmail.com' ? password.replace(/\s+/g, '') : password;
}

/**
 * Separate from a generic failure so routes can tell the difference between "this deployment has
 * no mail set up" and "the message did not go out". The first is a deployment problem the user
 * cannot act on, and telling them to check their inbox would be a lie.
 */
export class EmailNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`${missing} is not set`);
    this.name = 'EmailNotConfiguredError';
  }
}

function transporter(): Transporter {
  if (cached) return cached;

  const port = Number(process.env.SMTP_PORT ?? 465);

  cached = nodemailer.createTransport({
    host: smtpHost(),
    port,
    // Port 465 is implicit TLS. Anything else would be STARTTLS, which begins in plaintext.
    secure: port === 465,
    auth: { user: required('SMTP_USER'), pass: smtpPassword() },
  });

  return cached;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Plain text only. A recovery mail has nothing to say that needs markup, and a text-only
   *  message is both harder to spoof convincingly and less likely to be filtered. */
  text: string;
}

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const from = required('EMAIL_FROM_ADDRESS');
  const name = process.env.EMAIL_FROM_NAME?.trim() || 'Saku';

  try {
    await transporter().sendMail({
      from: `"${name}" <${from}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } catch (error) {
    // A rejected login (`535`) is a configuration error rather than a send failure, because
    // nobody's inbox is at fault. On Gmail it almost always means an account password where a
    // 16-character app password belongs; elsewhere, a wrong mailbox user or password.
    if (/\b535\b|BadCredentials|Invalid login/i.test(String((error as Error)?.message))) {
      throw new EmailNotConfiguredError(
        smtpHost() === 'smtp.gmail.com'
          ? 'SMTP_PASSWORD (Gmail rejected it — use a 16-character Google app password, not the account password)'
          : `SMTP_USER / SMTP_PASSWORD (${smtpHost()} rejected the login)`
      );
    }
    throw error;
  }
}

/** True when this deployment can actually send. Lets a screen hide what it cannot deliver. */
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASSWORD?.trim() &&
      process.env.EMAIL_FROM_ADDRESS?.trim()
  );
}
