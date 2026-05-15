import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';

interface OAuthProviders {
  google: boolean;
  github: boolean;
}

function useOAuthProviders(): OAuthProviders {
  const [p, setP] = useState<OAuthProviders>({ google: false, github: false });
  useEffect(() => {
    let cancelled = false;
    void api
      .get<OAuthProviders>('/api/auth/oauth/providers')
      .then((res) => {
        if (!cancelled) setP(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return p;
}

function OAuthButtons({ next }: { next?: string }) {
  const providers = useOAuthProviders();
  const enabled = providers.google || providers.github;
  if (!enabled) return null;
  const nextParam = next ? `?next=${encodeURIComponent(next)}` : '';
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {providers.google && (
          <a
            href={`/api/auth/oauth/google/start${nextParam}`}
            className="btn-secondary w-full justify-center gap-2.5"
            aria-label="Continue with Google"
          >
            <GoogleIcon />
            <span>Continue with Google</span>
          </a>
        )}
        {providers.github && (
          <a
            href={`/api/auth/oauth/github/start${nextParam}`}
            className="btn-secondary w-full justify-center gap-2.5"
            aria-label="Continue with GitHub"
          >
            <GitHubIcon />
            <span>Continue with GitHub</span>
          </a>
        )}
      </div>
      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <span className="w-full border-t border-(--color-border)" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider">
          <span className="bg-(--color-card) px-2 text-(--color-muted)">or</span>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.339-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  );
}

function OAuthError() {
  const [params] = useSearchParams();
  const error = params.get('oauth_error');
  if (!error) return null;
  return (
    <div className="rounded-md border border-(--color-danger)/40 bg-(--color-danger)/10 px-3 py-2 text-sm text-(--color-danger) mb-4">
      {error}
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const next = (loc.state as { from?: string } | null)?.from ?? '/account';

  return (
    <AuthFrame title="Welcome back" sub={<>New here? <Link to="/register" className="text-(--color-accent)">Create an account</Link></>}>
      <OAuthError />
      <OAuthButtons next={next} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await login(email, password);
            navigate(next, { replace: true });
          } catch (err) {
            toast.push((err as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <label className="block text-sm">Email
          <input type="email" required autoComplete="email" className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">Password
          <input type="password" required autoComplete="current-password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="text-xs text-center text-(--color-muted)">
          <Link to="/forgot" className="hover:text-(--color-accent)">Forgot password?</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Create your account" sub={<>Already have one? <Link to="/login" className="text-(--color-accent)">Sign in</Link></>}>
      <OAuthError />
      <OAuthButtons />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await register(email, password, name || undefined);
            navigate('/account', { replace: true });
          } catch (err) {
            toast.push((err as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <label className="block text-sm">Name (optional)
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">Email
          <input type="email" required autoComplete="email" className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">Password
          <input type="password" required minLength={8} autoComplete="new-password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="text-xs text-(--color-muted) mt-1 block">At least 8 characters.</span>
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Reset your password" sub="Enter your email and we'll send you a reset link.">
      {sent ? (
        <p className="text-sm">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.post('/api/auth/password/request', { email });
              setSent(true);
            } catch (err) {
              toast.push((err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-3"
        >
          <label className="block text-sm">Email
            <input type="email" required className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const toast = useToast();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Set a new password" sub="Use a strong password you don't reuse anywhere else.">
      {done ? (
        <p className="text-sm">
          Password updated. <Link to="/login" className="text-(--color-accent)">Sign in</Link>.
        </p>
      ) : !token ? (
        <p className="text-sm text-(--color-danger)">
          This reset link is invalid. <Link to="/forgot" className="text-(--color-accent)">Request a new one</Link>.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.post('/api/auth/password/reset', { token, password });
              setDone(true);
            } catch (err) {
              toast.push((err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-3"
        >
          <label className="block text-sm">
            New password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

function AuthFrame({ title, sub, children }: { title: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-7">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-(--color-muted) text-sm mt-1">{sub}</p>
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}
