import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { coatOfArms, ministryOfFinance } from './assets';
import { BankMark, Crest, GoldLink, ShieldCheckIcon } from './atoms';

/**
 * The frame around the public site: the government banner above, the bank's
 * own header below it, and the ink footer at the bottom.
 *
 * The gutter these share (`SITE_GUTTER`) is the one horizontal measure on the
 * page — banner, header, main and footer all indent by it, so the crest, the
 * wordmark and the first card edge line up down the left of the screen.
 */

/** 20px on a phone, 40px from tablet, 80px on a wide screen. */
export const SITE_GUTTER = 'px-5 sm:px-10 xl:px-20';

/** Every section of the landing page is one white card on the page's stone
 *  background, sharing this radius and inner padding. */
export const SITE_CARD = 'rounded-[20px] bg-white px-7 py-20 sm:px-12 xl:rounded-[32px] xl:px-18';

/* ------------------------------------------------------------------ *
 * Government banner
 * ------------------------------------------------------------------ */

/** Whose site this is, stated before the bank introduces itself. */
export function GovBanner() {
  return (
    <div className={`flex items-center gap-5 bg-white py-3.5 ${SITE_GUTTER}`}>
      <Crest src={coatOfArms} alt="Coat of arms of Guyana" className="h-10 w-[42px]" />
      <p className="flex-1 text-[13px] leading-[1.4] text-gdb-ink/80 sm:text-[15px]">
        The official website of the Government of the Co-operative Republic of Guyana
      </p>
      <div className="hidden font-code text-[13px] font-extrabold tracking-[0.1em] text-gdb-indigo sm:block">
        MINISTRY OF FINANCE
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

/**
 * The bank's header.
 *
 * `action` is what sits on the right. The landing page hands it a Sign in
 * button; a page reached FROM sign-in would hand it something else, which is
 * why it is a slot rather than a hard-coded button.
 */
export function SiteHeader({ action }: { action?: ReactNode }) {
  return (
    <header className={`flex items-center gap-4 bg-white py-[18px] ${SITE_GUTTER}`}>
      <Link to="/" className="flex items-center gap-4 sm:gap-[18px]">
        <BankMark className="h-12 w-12 rounded-[16px] sm:h-14 sm:w-14 sm:rounded-[18px]" />
        <span>
          <span className="block font-display text-[17px] leading-[1.2] font-extrabold tracking-[-0.01em] text-gdb-ink sm:text-[20px]">
            Guyana Development Bank
          </span>
          <span className="mt-1 block font-code text-[10px] font-bold tracking-[0.1em] text-gdb-ink/60 sm:text-[11px]">
            BUILDING GUYANA&rsquo;S NEXT CHAPTER
          </span>
        </span>
      </Link>
      <div className="flex-1" />
      {action ?? (
        <GoldLink to="/login" size="sm" className="hidden sm:inline-flex">
          Sign in
        </GoldLink>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * Footer
 * ------------------------------------------------------------------ */

/**
 * The footer's navigation.
 *
 * Only four of these destinations exist: Home, Sign in, Create an account,
 * and nothing else. The rest are pages of the public site that have not been
 * built, so they render as plain text rather than as anchors — a footer full
 * of links that reload the same page is a worse answer than a footer that
 * shows what is coming and does not pretend it is ready.
 */
const FOOTER_NAV: { heading: string; links: { label: string; to?: string }[] }[] = [
  {
    heading: 'THE PROGRAMME',
    links: [
      { label: 'Home', to: '/' },
      { label: 'About' },
      { label: 'What you can borrow' },
      { label: 'Priority sectors' },
    ],
  },
  {
    heading: 'APPLYING',
    links: [{ label: 'Who can apply' }, { label: 'Getting ready' }, { label: 'Other support' }],
  },
  {
    heading: 'NEWS AND HELP',
    links: [{ label: 'Updates' }, { label: 'Media' }, { label: 'Questions' }],
  },
  {
    heading: 'YOUR APPLICATION',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create an account', to: '/signup' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className={`bg-gdb-ink pt-[88px] pb-11 text-white ${SITE_GUTTER}`}>
      <div className="flex flex-col gap-12 lg:flex-row lg:gap-20">
        <div className="flex w-full flex-none flex-col gap-5 lg:w-[380px]">
          <h3 className="font-display text-[22px] leading-[1.3] font-extrabold tracking-[-0.01em]">
            Guyana Development Bank
          </h3>
          <p className="text-[16px] leading-[1.68] text-white/70">
            A proposed programme of the Government of Guyana, through the Ministry of Finance. The
            bank is not yet open.
          </p>
          <div className="flex items-center gap-4">
            <Crest src={coatOfArms} alt="Coat of arms of Guyana" className="h-[46px] w-12" chip />
            <Crest
              src={ministryOfFinance}
              alt="Ministry of Finance logo"
              className="h-[46px] w-[46px]"
              chip
            />
          </div>
          <div className="text-[15px] leading-[1.6] text-white/70">
            Government of Guyana &middot; Ministry of Finance
          </div>
        </div>

        <nav className="grid flex-1 grid-cols-1 gap-10 sm:grid-cols-2 xl:grid-cols-4">
          {FOOTER_NAV.map((group) => (
            <div key={group.heading}>
              <h4 className="font-code text-[13px] leading-[1.2] font-extrabold tracking-[0.1em] text-gdb-goldleaf">
                {group.heading}
              </h4>
              <ul className="mt-5 flex list-none flex-col gap-3.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to} className="text-[16px] leading-[1.5] text-white/80">
                        {link.label}
                      </Link>
                    ) : (
                      <span
                        className="text-[16px] leading-[1.5] text-white/40"
                        title="This page is not published yet."
                      >
                        {link.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="my-11 h-px bg-white/15" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex-1 font-code text-[13px] font-bold tracking-[0.02em] text-white/60">
          Guyana Development Bank / Guyana, built forward
        </div>
        <div className="flex items-center gap-3 font-code text-[13px] font-bold tracking-[0.02em] text-white/60">
          <span className="text-white/80">
            <ShieldCheckIcon size={19} />
          </span>
          Human decision at every lending step
        </div>
      </div>
    </footer>
  );
}
