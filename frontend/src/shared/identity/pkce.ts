/** PKCE (RFC 7636) — the four primitives, and nothing else.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN `oidc-client-ts`.
 *
 * We discard the Keycloak token the moment `exchange_token` hands back a
 * Frappe `sid`. Silent renew, token storage, refresh rotation and session
 * monitoring — the reasons that library is worth its weight — are all dead
 * weight here. Worse, its token-store abstraction is a standing invitation to
 * persist a token in `localStorage`, which CLAUDE.md §1 forbids outright. What
 * is actually needed is a random verifier, its S256 challenge, and two opaque
 * strings; that is this file.
 *
 * WHAT GOES IN `sessionStorage`, AND WHY THAT IS NOT THE THING CLAUDE.md BANS.
 * The verifier and state live there for the duration of one redirect. They are
 * not PII and not credentials: the verifier is single-use and worthless once
 * redeemed, and the state is a nonce. They cannot be held in memory because
 * the redirect destroys the page. `sessionStorage` rather than `localStorage`
 * so a second tab cannot redeem the first tab's flow, and the callback clears
 * them in a `finally` whether or not the exchange succeeded.
 */

const VERIFIER_KEY = 'gdb.pkce.verifier';
const STATE_KEY = 'gdb.pkce.state';
const RETURN_TO_KEY = 'gdb.pkce.return_to';

/** base64url — RFC 4648 §5. The '+/=' of standard base64 are not URL-safe and
 *  Keycloak rejects a challenge containing them. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** A code verifier: 43–128 characters of unreserved alphabet. 32 random bytes
 *  base64url-encode to 43, the minimum the spec allows and ample entropy. */
export function createVerifier(): string {
  return randomString(32);
}

export function createState(): string {
  return randomString(16);
}

export async function challengeFor(verifier: string): Promise<string> {
  // `crypto.subtle` is unavailable on an insecure origin other than localhost.
  // That is a deployment error rather than something to work around: falling
  // back to `plain` would silently drop the protection PKCE exists to give.
  if (!crypto.subtle) {
    throw new Error('Secure sign-in needs HTTPS. This page was not served securely.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const pending = {
  save(verifier: string, state: string, returnTo: string): void {
    try {
      sessionStorage.setItem(VERIFIER_KEY, verifier);
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    } catch {
      // Private browsing, or storage disabled. Let the redirect proceed: the
      // callback will find no verifier and say so plainly, which is a better
      // outcome than refusing to start for a reason the citizen cannot act on.
    }
  },

  read(): { verifier: string | null; state: string | null; returnTo: string } {
    try {
      return {
        verifier: sessionStorage.getItem(VERIFIER_KEY),
        state: sessionStorage.getItem(STATE_KEY),
        returnTo: sessionStorage.getItem(RETURN_TO_KEY) || '/',
      };
    } catch {
      return { verifier: null, state: null, returnTo: '/' };
    }
  },

  clear(): void {
    try {
      sessionStorage.removeItem(VERIFIER_KEY);
      sessionStorage.removeItem(STATE_KEY);
      sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};
