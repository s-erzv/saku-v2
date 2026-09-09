/**
 * The one place the length of a verification code is decided.
 *
 * It lives apart from `lib/otp.ts` because that module imports Node's `crypto`, which cannot be
 * pulled into a client bundle — so the login screen used to keep its own copy of this number.
 * Two copies of "how many digits" is a bug waiting for someone to change one of them: the screen
 * would collect four digits, the server would reject anything that is not six, and nobody could
 * sign in. One constant, imported by both.
 */
export const OTP_LENGTH = 6;
