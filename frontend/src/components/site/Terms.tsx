import type { ReactNode } from 'react';
import { Eyebrow, Meta, PersonCheckIcon, QueryIcon, ShieldCheckIcon } from './atoms';
import { SITE_CARD } from './SiteChrome';

/**
 * The four proposed terms, and the three safeguards under them.
 *
 * The safeguards are not small print. Each one answers a way this programme
 * could be misread or exploited — that a ceiling is an approval, that someone
 * could charge a fee to apply, that a machine decides — so they are set at
 * the same weight as the terms themselves.
 */

const TERMS: { label: string; value: string; body: string }[] = [
  {
    label: 'Per loan',
    value: 'G$3M',
    body: 'The proposed maximum for a single GDB loan. It is not a promise of approval, and the funding is not in place yet.',
  },
  {
    label: 'Interest',
    value: '0%',
    body: 'You repay what you borrowed and nothing more. There is no arrangement fee and no cost to apply.',
  },
  {
    label: 'Security',
    value: 'No collateral',
    body: 'Land, property or family wealth is not a condition of borrowing under this programme.',
  },
  {
    label: 'Above the cap',
    value: 'No co-financing',
    body: 'Requests must stay at or below G$3M. Nothing larger can be arranged through this portal.',
  },
];

const SAFEGUARDS: { icon: ReactNode; body: string }[] = [
  {
    icon: <QueryIcon />,
    body: 'G$3M is a proposed ceiling, not an offer. Nobody is approved in advance, and the funding is not in place yet.',
  },
  {
    icon: <ShieldCheckIcon />,
    body: 'Applying is free. There is no fee at any stage, no one can move you up the queue, and anyone asking you to pay for help with your application is not acting for the Government of Guyana.',
  },
  {
    icon: <PersonCheckIcon />,
    body: 'A person decides. You can be guided through the preparation and your answers can be organised for you. Submitting, approving, declining and disbursing stay with a human underwriter at every step.',
  },
];

export function Terms() {
  return (
    <section className={SITE_CARD}>
      <Eyebrow>THE PROPOSED TERMS</Eyebrow>
      <h2 className="mt-[30px] font-display text-[38px] leading-[1.08] font-extrabold tracking-[-0.02em] text-gdb-ink sm:text-[54px] xl:text-[68px]">
        What Guyana
        <br />
        <span className="text-gdb-indigo">is offering</span>
      </h2>

      {/* One bordered strip, split by hairlines rather than gaps — four terms
          of one offer, not four offers. */}
      <div className="mt-16 grid grid-cols-1 overflow-hidden rounded-2xl border border-gdb-line bg-white sm:grid-cols-2 xl:mt-[88px] xl:grid-cols-4">
        {TERMS.map((term) => (
          <div
            key={term.label}
            className="border-t border-gdb-line px-8 py-9 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 sm:[&:nth-child(odd)]:border-l-0 xl:border-t-0 xl:border-l xl:first:border-l-0"
          >
            <div className="text-[16px] leading-[1.4] text-gdb-ink/60">{term.label}</div>
            <div className="flex min-h-[92px] items-end pt-6">
              <b className="font-display text-[30px] leading-[1.12] font-extrabold tracking-[-0.02em] text-gdb-indigo">
                {term.value}
              </b>
            </div>
            <div className="mt-[18px] h-[3px] w-10 bg-gdb-goldleaf" />
            <p className="mt-[18px] text-[15px] leading-[1.66] text-gdb-ink/75">{term.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-14 flex flex-col gap-4">
        {SAFEGUARDS.map((safeguard, index) => (
          <div key={index} className="flex overflow-hidden rounded-[10px] bg-gdb-cream">
            <span className="w-1 flex-none bg-gdb-goldleaf" aria-hidden="true" />
            <div className="flex items-center gap-[18px] py-[22px] pr-8 pl-[26px]">
              <span className="text-gdb-indigo">{safeguard.icon}</span>
              <p className="text-[16px] leading-[1.64] text-gdb-ink/85">{safeguard.body}</p>
            </div>
          </div>
        ))}
      </div>

      <Meta className="mt-13">
        Guyana Development Bank &nbsp;&middot;&nbsp; proposed programme terms &nbsp;&middot;&nbsp; 27
        August 2026
      </Meta>
    </section>
  );
}
