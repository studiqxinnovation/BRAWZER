/**
 * How long a sign-in lasts.
 *
 * Shared-computer mode is the default because Brawzer is built for computers
 * people don't own: the cookie ends with the browser, and the session ends
 * after 30 idle minutes even if the browser stays open. "Keep me signed in on
 * this device" is an explicit choice for a person's own computer.
 */
export interface SessionLifetime {
  /** Ends after this long without activity. */
  idleSeconds: number;
  /** Ends this long after sign-in, whatever the activity. */
  absoluteSeconds: number;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SHARED_COMPUTER_SESSION: SessionLifetime = {
  idleSeconds: 30 * MINUTE,
  absoluteSeconds: 12 * HOUR,
};

export const KEEP_SIGNED_IN_SESSION: SessionLifetime = {
  idleSeconds: 14 * DAY,
  absoluteSeconds: 30 * DAY,
};

export function sessionLifetime(persistent: boolean): SessionLifetime {
  return persistent ? KEEP_SIGNED_IN_SESSION : SHARED_COMPUTER_SESSION;
}

/** Activity is written at most this often, so reads don't each cause a write. */
export const ACTIVITY_WRITE_INTERVAL_SECONDS = MINUTE;

/** After a token is rotated, the previous one keeps working this long for requests already in flight. */
export const ROTATION_GRACE_SECONDS = MINUTE;

/** Email links: confirming an address, and resetting a password. */
export const EMAIL_LINK_LIFETIME_SECONDS = {
  verify_email: DAY,
  reset_password: 30 * MINUTE,
} as const;
