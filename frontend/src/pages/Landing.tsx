import { FlagRibbon } from '../components/site/atoms';
import { Hero } from '../components/site/Hero';
import { PresidentSection } from '../components/site/PresidentSection';
import { Purposes } from '../components/site/Purposes';
import { Sectors } from '../components/site/Sectors';
import { GovBanner, SITE_GUTTER, SiteFooter, SiteHeader } from '../components/site/SiteChrome';
import { Terms } from '../components/site/Terms';

/**
 * The public front door — what a citizen sees before they have an account.
 *
 * It is the one page in this SPA that renders for a signed-out visitor by
 * choice rather than as a gate, so it carries no `useAuth`: nothing on it
 * varies by who is reading, and a marketing page that waits on `whoami`
 * before painting is a slower page for no benefit. App.tsx decides whether a
 * visitor sees this or their dashboard.
 *
 * `gdb-public` is not a styling hook for this file — it tells `index.css` to
 * drop the application's fixed gradient so this page's own stone background
 * runs the full height of a very long document.
 */
export function Landing() {
  return (
    <div className="gdb-public min-h-screen bg-gdb-page font-body text-gdb-ink">
      <FlagRibbon />
      <GovBanner />
      <SiteHeader />

      <main className={`flex flex-col gap-6 pt-6 pb-20 ${SITE_GUTTER}`}>
        <Hero />
        <PresidentSection />
        <Purposes />
        <Terms />
        <Sectors />
      </main>

      <SiteFooter />
    </div>
  );
}
