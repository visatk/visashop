-- Seed: a sample catalog so the shop is browsable from minute one.

INSERT OR IGNORE INTO categories (id, slug, name, description, sort_order) VALUES
  ('cat_keys',    'license-keys',  'License Keys',          'Genuine activation keys for premium software.', 1),
  ('cat_subs',    'subscriptions', 'Subscriptions',         'Time-limited access to premium services.',      2),
  ('cat_scripts', 'scripts',       'Premium Scripts',       'Battle-tested automation and trading scripts.', 3),
  ('cat_tools',   'tools',         'Tools & Utilities',     'Power-user productivity downloads.',            4);

INSERT OR IGNORE INTO products (
  id, slug, name, short_description, description, type, category_id,
  price_cents, compare_at_cents, image, gallery, badge, rating,
  meta_title, meta_description, keywords, duration_days, manual_stock,
  is_active, is_featured
) VALUES
  ('p_office',  'office-pro-2026-key', 'Office Pro 2026 Key',
    'Lifetime activation key for Office Pro 2026.',
    'Genuine retail key delivered instantly after payment confirmation. Works on Windows 10/11.',
    'key', 'cat_keys',
    2999, 5999, '/img/p/office.svg', '[]', 'hot', 48,
    'Buy Office Pro 2026 Key — Instant Delivery', 'Genuine Office Pro 2026 lifetime key with instant crypto checkout.',
    'office, key, lifetime, microsoft', NULL, NULL, 1, 1),

  ('p_vpn',     'pro-vpn-12-month',    'Pro VPN — 12 Month',
    '12-month subscription to Pro VPN with all premium features.',
    'No-logs VPN, 90+ countries, 10 simultaneous devices. Account credentials emailed instantly.',
    'subscription', 'cat_subs',
    1999, 3999, '/img/p/vpn.svg', '[]', 'sale', 47,
    'Pro VPN 12 Months — 50% Off', 'Best value crypto-paid VPN subscription.',
    'vpn, privacy, subscription', 365, NULL, 1, 1),

  ('p_botkit',  'crypto-bot-kit',      'Crypto Bot Kit',
    'Premium trading bot scripts with strategies and back-tests.',
    'Includes Python bot, Pine Script strategies, sample data, and 60-page playbook.',
    'script', 'cat_scripts',
    4999, NULL, '/img/p/botkit.svg', '[]', 'new', 49,
    'Crypto Bot Kit — Premium Trading Scripts', 'Battle-tested crypto trading scripts and strategies.',
    'bot, crypto, trading, scripts', NULL, 100, 1, 1),

  ('p_seoaudit','seo-audit-cli',       'SEO Audit CLI',
    'Headless SEO auditor for technical SEO teams.',
    'CLI binary + Node library. Crawls, lints, and reports on Core Web Vitals.',
    'file', 'cat_tools',
    1499, NULL, '/img/p/seo.svg', '[]', NULL, 46,
    'SEO Audit CLI — Technical SEO Tool', 'Run a Lighthouse-grade SEO audit from your terminal.',
    'seo, cli, audit, tools', NULL, 0, 1, 0);

-- A small pool of demo keys (for the `key` and `subscription` products)
INSERT OR IGNORE INTO license_keys (id, product_id, key_value, status) VALUES
  ('lk_office_1', 'p_office', 'OFFC-PRO-2026-AAAA-1111', 'available'),
  ('lk_office_2', 'p_office', 'OFFC-PRO-2026-BBBB-2222', 'available'),
  ('lk_office_3', 'p_office', 'OFFC-PRO-2026-CCCC-3333', 'available'),
  ('lk_vpn_1',    'p_vpn',    'PROVPN-AAAA-1111-2222',    'available'),
  ('lk_vpn_2',    'p_vpn',    'PROVPN-BBBB-3333-4444',    'available'),
  ('lk_botkit_1', 'p_botkit', 'BOTKIT-AAAA-1111',         'available'),
  ('lk_botkit_2', 'p_botkit', 'BOTKIT-BBBB-2222',         'available');

-- Default coupon
INSERT OR IGNORE INTO coupons (id, code, type, value, min_subtotal_cents, is_active)
VALUES ('cp_welcome', 'WELCOME10', 'percent', 10, 0, 1);

-- A default storefront settings row
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('storefront.brand', '{"name":"VisaShop","tagline":"Premium digital products, instant delivery."}'),
  ('storefront.crypto_currencies', '["btc","ltc","doge","trx","usdt@trx"]');
