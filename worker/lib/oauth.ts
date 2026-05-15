/**
 *  OAuth 2.0 / OpenID Connect helpers for Google and GitHub.
 *
 *  Flow:
 *    1. /api/auth/oauth/<provider>/start
 *         - mints a CSRF state, stashes the post-login redirect path
 *           inside it, signs it with SESSION_SECRET, and 302s the
 *           browser to the provider's authorize endpoint.
 *    2. /api/auth/oauth/<provider>/callback
 *         - verifies the state, swaps `code` for an access token,
 *           pulls user info, then either links to the matching
 *           VisaShop account (by oauth_accounts row or by verified
 *           email) or creates a brand-new account.
 *
 *  We never store the upstream access token — once the local session
 *  cookie is set, the OAuth handshake is done.
 */
import type { AppEnv } from '../env';
import { signToken, verifyToken } from './crypto';

export type OAuthProvider = 'google' | 'github';

export interface OAuthProfile {
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  /** Extra params appended to the authorize URL. */
  extraAuthorize?: Record<string, string>;
}

function loadConfig(env: AppEnv, provider: OAuthProvider): ProviderConfig | null {
  if (provider === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile',
      extraAuthorize: { access_type: 'online', prompt: 'select_account' },
    };
  }
  if (provider === 'github') {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;
    return {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scope: 'read:user user:email',
    };
  }
  return null;
}

export function isOAuthEnabled(env: AppEnv, provider: OAuthProvider): boolean {
  return loadConfig(env, provider) !== null;
}

export function buildRedirectUri(env: AppEnv, provider: OAuthProvider): string {
  return `${env.APP_URL.replace(/\/$/, '')}/api/auth/oauth/${provider}/callback`;
}

/* ----------------------------- State token -------------------------------- */
/* Tiny signed token that ties the callback request back to the original
   /start request. We embed: random nonce + post-login redirect target +
   short expiry (5 minutes). */

export interface OAuthState {
  n: string;
  next: string;
  exp: number;
  p: OAuthProvider;
}

export async function signState(env: AppEnv, payload: OAuthState): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET not configured');
  return signToken(env.SESSION_SECRET, payload);
}

export async function verifyState(env: AppEnv, token: string): Promise<OAuthState | null> {
  if (!env.SESSION_SECRET) return null;
  const payload = await verifyToken<OAuthState>(env.SESSION_SECRET, token);
  if (!payload) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* ------------------------- Authorize URL builder -------------------------- */

export function authorizeUrl(env: AppEnv, provider: OAuthProvider, state: string): string {
  const cfg = loadConfig(env, provider);
  if (!cfg) throw new Error(`OAuth provider ${provider} is not configured`);
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', buildRedirectUri(env, provider));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', cfg.scope);
  u.searchParams.set('state', state);
  for (const [k, v] of Object.entries(cfg.extraAuthorize ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

/* -------------------------- Code → access token --------------------------- */

async function exchangeCode(
  env: AppEnv,
  provider: OAuthProvider,
  code: string,
): Promise<{ accessToken: string; tokenType: string }> {
  const cfg = loadConfig(env, provider);
  if (!cfg) throw new Error(`OAuth provider ${provider} is not configured`);
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', buildRedirectUri(env, provider));
  params.set('client_id', cfg.clientId);
  params.set('client_secret', cfg.clientSecret);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'VisaShop',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string; token_type?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`token exchange failed: ${data.error_description ?? data.error ?? 'no access_token'}`);
  }
  return { accessToken: data.access_token, tokenType: data.token_type ?? 'Bearer' };
}

/* ----------------------------- User info ---------------------------------- */

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
}

interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
}

interface GitHubEmailEntry {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

async function fetchGoogleUser(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`google userinfo failed (${res.status})`);
  const data = (await res.json()) as GoogleUserInfo;
  if (!data.sub) throw new Error('google userinfo missing sub');
  return {
    provider: 'google',
    subject: data.sub,
    email: data.email ?? null,
    emailVerified: Boolean(data.email_verified),
    name: data.name ?? data.given_name ?? null,
  };
}

async function fetchGithubUser(accessToken: string): Promise<OAuthProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VisaShop',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const userRes = await fetch('https://api.github.com/user', { headers });
  if (!userRes.ok) throw new Error(`github user failed (${userRes.status})`);
  const user = (await userRes.json()) as GitHubUserInfo;

  // GitHub may omit `email` if the user marked it private — fetch verified
  // emails explicitly so we can pick the verified primary.
  let email = user.email;
  let emailVerified = false;
  try {
    const emailRes = await fetch('https://api.github.com/user/emails', { headers });
    if (emailRes.ok) {
      const list = (await emailRes.json()) as GitHubEmailEntry[];
      const primary = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
      if (primary) {
        email = primary.email;
        emailVerified = true;
      }
    }
  } catch {
    /* ignore — fall back to whatever /user returned */
  }

  return {
    provider: 'github',
    subject: String(user.id),
    email: email ?? null,
    emailVerified,
    name: user.name ?? user.login ?? null,
  };
}

export async function exchangeAndProfile(
  env: AppEnv,
  provider: OAuthProvider,
  code: string,
): Promise<OAuthProfile> {
  const { accessToken } = await exchangeCode(env, provider, code);
  if (provider === 'google') return fetchGoogleUser(accessToken);
  return fetchGithubUser(accessToken);
}
