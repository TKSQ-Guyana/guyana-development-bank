/** The sign-in round trip: portal -> Keycloak -> portal -> Frappe session.
 *
 *   beginSignIn()     build the authorize URL and leave the page
 *   completeSignIn()  redeem the code, hand the token to the backend, come back
 *
 * NOTHING HERE HARDCODES A KEYCLOAK URL. Every endpoint comes from
 * `v1_identity.sign_in_config`, for the same reason `project_overview.md` §6
 * forbids hardcoding policy figures in frontend content: the value differs per
 * environment, and a stale copy baked into a built bundle is not something
 * anyone notices until a citizen cannot sign in.
 *
 * THE TOKEN IS NOT KEPT. It is redeemed, posted to the backend once, and
 * dropped when this function returns. From that point the session is Frappe's
 * `sid` cookie and the whole permission stack — DocPerms, User Permissions,
 * `permission_query_conditions` — applies as it does to any other Frappe
 * client. See the note at the top of `api/v1_identity.py`.
 */

import { call } from '../../api';
import type { Identity } from '../rbac';
import { challengeFor, createState, createVerifier, pending } from './pkce';

export interface SignInConfig {
  configured: boolean;
  issuer: string;
  realm: string;
  client_id: string;
  authorize_url: string;
  token_url: string;
  end_session_url: string;
}

export const fetchSignInConfig = () =>
  call<SignInConfig>('gdb_bank.api.v1_identity.sign_in_config');

/** Where Keycloak sends the citizen back to. Registered on the `gdb-portal`
 *  client (see the generated realm structure); Keycloak refuses any redirect
 *  URI not on that list, which is what stops an open redirect. */
export const redirectUri = (): string => `${window.location.origin}/auth/callback`;

export class SignInError extends Error {}

/**
 * Start the Authorization Code + PKCE flow. Does not return — the browser
 * leaves this page.
 *
 * `returnTo` is remembered across the redirect so a citizen who was sent to
 * the login page from a deep link lands back on it rather than on the
 * dashboard.
 */
export async function beginSignIn(config: SignInConfig, returnTo = '/'): Promise<void> {
  if (!config.configured) {
    throw new SignInError('e-ID sign-in is not configured on this site.');
  }

  const verifier = createVerifier();
  const state = createState();
  pending.save(verifier, state, returnTo);

  const params = new URLSearchParams({
    client_id: config.client_id,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });

  // `assign`, not `replace`: Back from Keycloak should return the citizen to
  // the login page they came from, not to whatever preceded it.
  window.location.assign(`${config.authorize_url}?${params.toString()}`);
}

/**
 * Finish the flow. Returns the signed-in identity and where to send them.
 *
 * Every failure path clears the pending verifier, because a verifier is
 * single-use: leaving a spent one behind means the next attempt in this tab
 * redeems a code against the wrong challenge and fails for a second, unrelated
 * reason on top of the first.
 */
export async function completeSignIn(
  config: SignInConfig,
  search: URLSearchParams,
): Promise<{ identity: Identity; returnTo: string }> {
  const { verifier, state, returnTo } = pending.read();

  try {
    // Keycloak reports a refusal (consent denied, an account action the
    // citizen abandoned) by redirecting back with `error`, not by failing the
    // redirect. Reading it first means we report what happened rather than
    // "no authorization code".
    const error = search.get('error');
    if (error) {
      throw new SignInError(
        search.get('error_description') || 'Sign-in was not completed.',
      );
    }

    const code = search.get('code');
    if (!code) throw new SignInError('Sign-in did not complete. Please try again.');

    if (!verifier || !state) {
      throw new SignInError(
        'This sign-in could not be matched to a request from this browser. Please start again.',
      );
    }

    // The CSRF check PKCE's state parameter exists for. A mismatch means this
    // callback belongs to some other flow, so it must not be redeemed.
    if (search.get('state') !== state) {
      throw new SignInError('Sign-in could not be verified. Please start again.');
    }

    const { accessToken, idToken } = await redeem(config, code, verifier);

    // From here the backend owns the session. `exchange_token` verifies the
    // token against Keycloak's JWKS — this SPA has proved nothing by holding
    // it, and is not trusted to have.
    //
    // The id_token goes the same way and is never kept here. It carries name,
    // email and e-ID, and CLAUDE.md §1 forbids PII in any browser store; the
    // backend holds it against the session so `sign_out` can send it back as
    // `id_token_hint`.
    return {
      identity: await call<Identity>('gdb_bank.api.v1_identity.exchange_token', {
        access_token: accessToken,
        id_token: idToken,
      }),
      returnTo,
    };
  } finally {
    pending.clear();
  }
}

async function redeem(
  config: SignInConfig,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; idToken: string | null }> {
  // Cross-origin to Keycloak, which is why `gdb-portal` carries `webOrigins`.
  // A public client sends no secret: the verifier is the proof, which is the
  // whole point of PKCE.
  const response = await fetch(config.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.client_id,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    // Keycloak's `error_description` names internals (client ids, realm
    // config). It goes to the console for a developer and never to the screen.
    let detail = '';
    try {
      detail = ((await response.json()) as { error_description?: string }).error_description ?? '';
    } catch {
      /* non-JSON error body */
    }
    console.error('[gdb] token exchange failed', response.status, detail);
    throw new SignInError('Sign-in could not be completed. Please try again.');
  }

  const payload = (await response.json()) as { access_token?: string; id_token?: string };
  if (!payload.access_token) throw new SignInError('The sign-in service returned no token.');
  // `id_token` is absent only if the `openid` scope were dropped. Not fatal:
  // logout then falls back to Keycloak's confirmation page.
  return { accessToken: payload.access_token, idToken: payload.id_token ?? null };
}

/**
 * End the Keycloak session too, after the backend has ended Frappe's.
 *
 * WITHOUT THIS, LOGGING OUT DOES NOT LOOK LIKE LOGGING OUT. Frappe's logout
 * drops `sid` and nothing else; Keycloak's own session cookie survives, so the
 * next "Sign in with e-ID" returns the citizen to the portal without ever
 * asking for a credential. On a shared machine that is not a cosmetic problem.
 */
export function endKeycloakSession(
  endSessionUrl: string | null,
  clientId: string,
  idTokenHint?: string | null,
): void {
  if (!endSessionUrl) {
    window.location.assign('/login');
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
  // WITHOUT THIS, LOGGING OUT ASKS A QUESTION. Keycloak cannot tell which
  // session an unhinted logout means, so it renders "Do you want to log out?"
  // — and a citizen who closes the tab at that page is still signed in to
  // Keycloak. The hint comes from the backend, which held it for exactly this;
  // the SPA never stores it. `id_token_hint` is the OIDC RP-Initiated Logout
  // spec's own parameter, and it travels only to the issuer that minted it.
  if (idTokenHint) params.set('id_token_hint', idTokenHint);
  window.location.assign(`${endSessionUrl}?${params.toString()}`);
}
