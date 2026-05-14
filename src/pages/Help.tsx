import { Link } from 'react-router-dom';

export default function Help() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
      <h1 className="text-3xl font-bold mb-2">Help center</h1>
      <p className="text-(--color-muted)">
        Welcome to the VisaShop help center. Below are answers to the most common questions. If you don't
        find what you need, contact support and we will get back to you within 24 hours.
      </p>

      <div className="mt-10 space-y-10">
        <Section id="payment" title="How does crypto checkout work?">
          <p>
            When you place an order we generate a unique deposit address through our crypto payment provider.
            Send the exact amount shown to that address before the order expires. Your order is fulfilled the
            moment your transaction reaches one network confirmation.
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1.5 text-(--color-muted)">
            <li>Send the exact amount, not less. Sending more is fine but the difference is non-refundable.</li>
            <li>Each address is single-use and tied to your specific order.</li>
            <li>Network fees are paid by you, not VisaShop.</li>
          </ul>
        </Section>

        <Section id="delivery" title="When will I get my product?">
          <p>
            License keys, subscription credentials, scripts, and downloadable files are delivered automatically
            as soon as your transaction confirms — usually within ten minutes. We email a copy and you can also
            view delivery on the order page.
          </p>
        </Section>

        <Section id="refund" title="Refund policy">
          <p>
            Because most products are unique digital codes, refunds are evaluated case by case. Contact support
            within 7 days of purchase if your key fails to activate or your subscription is not honoured.
          </p>
        </Section>

        <Section id="contact" title="Contact us">
          <p>
            Email{' '}
            <a className="text-(--color-accent) underline-offset-4 hover:underline" href="mailto:support@example.com">
              support@example.com
            </a>{' '}
            for anything we missed. Want to chat?{' '}
            <Link to="/login" className="text-(--color-accent) underline-offset-4 hover:underline">
              Sign in
            </Link>{' '}
            and use the in-app contact form.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <div className="leading-relaxed">{children}</div>
    </section>
  );
}
