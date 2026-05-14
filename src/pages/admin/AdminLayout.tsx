import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect } from 'react';
import { LayoutGrid, Package, Tag, ScrollText, Users, Star, ShoppingBag, Workflow } from 'lucide-react';

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Not signed in — bounce to /login and remember where we wanted to go.
      navigate('/login', { replace: true, state: { from: '/admin' } });
      return;
    }
    if (user.role !== 'admin') {
      // Signed in but not an admin — send to the storefront. Avoid the
      // login → admin → login loop the previous redirect produced.
      navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="grid place-items-center py-32">
        <div className="spinner" />
      </div>
    );
  }
  if (user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md py-20 text-center px-4">
        <h1 className="text-2xl font-bold">Admin only</h1>
        <p className="text-(--color-muted) mt-2">You don’t have access to this area.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 grid lg:grid-cols-[220px_1fr] gap-6">
      <aside>
        <div className="font-bold text-lg mb-4">Admin</div>
        <nav className="flex lg:flex-col gap-1 text-sm" aria-label="Admin navigation">
          {[
            { to: '/admin', label: 'Dashboard', end: true, icon: LayoutGrid },
            { to: '/admin/products', label: 'Products', icon: Package },
            { to: '/admin/categories', label: 'Categories', icon: Tag },
            { to: '/admin/orders', label: 'Orders', icon: ShoppingBag },
            { to: '/admin/coupons', label: 'Coupons', icon: ScrollText },
            { to: '/admin/reviews', label: 'Reviews', icon: Star },
            { to: '/admin/users', label: 'Users', icon: Users },
            { to: '/admin/workflows', label: 'Workflows', icon: Workflow },
          ].map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                'flex items-center gap-2 px-3 py-2 rounded-md ' +
                (isActive
                  ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold'
                  : 'hover:bg-(--color-accent-soft)/50')
              }
            >
              <t.icon className="w-4 h-4" aria-hidden />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
