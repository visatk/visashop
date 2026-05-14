import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ShoppingCart, User as UserIcon, Search, Menu, LogOut, ShieldCheck, Package, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../lib/cart';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

/**
 *  Sticky top header with mobile drawer + account dropdown.
 *  Closes the drawer / dropdown on route change and outside click.
 */
function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [loc.pathname]);

  // Close the account dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // Lock the body scroll when the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-(--color-bg)/85 bg-(--color-bg)/95 border-b border-(--color-border)">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
        <button
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="lg:hidden -ml-1.5 p-2 rounded-md hover:bg-(--color-accent-soft)"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <Link to="/" className="flex items-center gap-2 font-bold text-lg shrink-0" aria-label="VisaShop home">
          <span className="grid place-items-center w-8 h-8 rounded-md bg-(--color-accent) text-(--color-accent-fg) text-xs font-black">VS</span>
          <span className="hidden sm:inline">VisaShop</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-5 text-sm ml-4" aria-label="Primary">
          <NavLink to="/shop" className={({ isActive }) => cn('hover:text-(--color-accent)', isActive && 'text-(--color-accent)')}>Shop</NavLink>
          <NavLink to="/c/license-keys" className="hover:text-(--color-accent)">License Keys</NavLink>
          <NavLink to="/c/subscriptions" className="hover:text-(--color-accent)">Subscriptions</NavLink>
          <NavLink to="/c/scripts" className="hover:text-(--color-accent)">Scripts</NavLink>
          <NavLink to="/c/tools" className="hover:text-(--color-accent)">Tools</NavLink>
        </nav>

        <form
          action="/shop"
          method="GET"
          className="ml-auto hidden md:flex items-center gap-2 input max-w-sm h-10 px-3 py-0"
          role="search"
        >
          <Search className="w-4 h-4 opacity-60" aria-hidden />
          <input
            name="q"
            placeholder="Search products"
            className="bg-transparent outline-none text-sm flex-1 min-w-0"
            aria-label="Search products"
          />
        </form>

        <div className="ml-auto md:ml-2 flex items-center gap-1">
          <Link
            to="/cart"
            className="relative p-2 rounded-md hover:bg-(--color-accent-soft)"
            aria-label={`Cart (${count} items)`}
          >
            <ShoppingCart className="w-5 h-5" />
            {count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid place-items-center min-w-5 h-5 rounded-full text-[11px] font-semibold bg-(--color-accent) text-(--color-accent-fg) px-1">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              aria-label="Account menu"
              aria-expanded={menuOpen}
              className="p-2 rounded-md hover:bg-(--color-accent-soft) flex items-center gap-2"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <UserIcon className="w-5 h-5" />
              {user && (
                <span className="hidden sm:inline text-sm max-w-[120px] truncate">
                  {user.name ?? user.email.split('@')[0]}
                </span>
              )}
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 card p-1 text-sm" role="menu">
                {user ? (
                  <>
                    <Link to="/account" className="block px-3 py-2 rounded-md hover:bg-(--color-accent-soft)">My account</Link>
                    <Link to="/account/orders" className="block px-3 py-2 rounded-md hover:bg-(--color-accent-soft)">My orders</Link>
                    {user.role === 'admin' && (
                      <Link to="/admin" className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-(--color-accent-soft)">
                        <ShieldCheck className="w-4 h-4" /> Admin panel
                      </Link>
                    )}
                    <div className="border-t border-(--color-border) my-1" />
                    <button
                      onClick={() => {
                        void logout();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-(--color-accent-soft)"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <Link to="/login" className="block px-3 py-2 rounded-md hover:bg-(--color-accent-soft)">Sign in</Link>
                    <Link to="/register" className="block px-3 py-2 rounded-md hover:bg-(--color-accent-soft)">Create account</Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div
          id="mobile-menu"
          className="lg:hidden border-t border-(--color-border) px-4 py-4 flex flex-col gap-1.5 text-sm bg-(--color-bg)"
        >
          {[
            { to: '/shop', label: 'Shop' },
            { to: '/c/license-keys', label: 'License Keys' },
            { to: '/c/subscriptions', label: 'Subscriptions' },
            { to: '/c/scripts', label: 'Scripts' },
            { to: '/c/tools', label: 'Tools' },
          ].map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                'px-3 py-2 rounded-md ' +
                (isActive ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold' : 'hover:bg-(--color-accent-soft)/60')
              }
            >
              {l.label}
            </NavLink>
          ))}
          <form action="/shop" method="GET" className="input mt-2 flex items-center gap-2">
            <Search className="w-4 h-4 opacity-60" aria-hidden />
            <input name="q" placeholder="Search products" className="bg-transparent outline-none flex-1" />
          </form>
          {user && (
            <Link to="/account/orders" className="mt-2 inline-flex items-center gap-2 text-(--color-accent) px-3 py-2">
              <Package className="w-4 h-4" /> My orders
            </Link>
          )}
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-(--color-border) mt-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 font-bold text-lg">
            <span className="grid place-items-center w-8 h-8 rounded-md bg-(--color-accent) text-(--color-accent-fg) text-xs font-black">VS</span>
            VisaShop
          </div>
          <p className="text-sm text-(--color-muted) mt-3 max-w-xs">
            Premium digital products. Crypto-paid, instantly delivered, and always genuine.
          </p>
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm uppercase tracking-wider">Shop</h4>
          <ul className="space-y-2 text-sm text-(--color-muted)">
            <li><Link to="/shop" className="hover:text-(--color-accent)">All products</Link></li>
            <li><Link to="/c/license-keys" className="hover:text-(--color-accent)">License keys</Link></li>
            <li><Link to="/c/subscriptions" className="hover:text-(--color-accent)">Subscriptions</Link></li>
            <li><Link to="/c/scripts" className="hover:text-(--color-accent)">Scripts</Link></li>
            <li><Link to="/c/tools" className="hover:text-(--color-accent)">Tools</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm uppercase tracking-wider">Help</h4>
          <ul className="space-y-2 text-sm text-(--color-muted)">
            <li><Link to="/help" className="hover:text-(--color-accent)">Help center</Link></li>
            <li><Link to="/help#payment" className="hover:text-(--color-accent)">Crypto payments</Link></li>
            <li><Link to="/help#refund" className="hover:text-(--color-accent)">Refund policy</Link></li>
            <li><Link to="/help#contact" className="hover:text-(--color-accent)">Contact support</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm uppercase tracking-wider">Account</h4>
          <ul className="space-y-2 text-sm text-(--color-muted)">
            <li><Link to="/login" className="hover:text-(--color-accent)">Sign in</Link></li>
            <li><Link to="/register" className="hover:text-(--color-accent)">Create account</Link></li>
            <li><Link to="/account/orders" className="hover:text-(--color-accent)">My orders</Link></li>
            <li><Link to="/forgot" className="hover:text-(--color-accent)">Forgot password</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-(--color-border) py-6 text-center text-xs text-(--color-muted) px-4">
        © {new Date().getFullYear()} VisaShop. All rights reserved. ·{' '}
        <Link to="/help" className="hover:text-(--color-accent)">Terms</Link>{' · '}
        <Link to="/help" className="hover:text-(--color-accent)">Privacy</Link>
      </div>
    </footer>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Skip link for screen readers / keyboard users */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:btn-primary"
      >
        Skip to main content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
