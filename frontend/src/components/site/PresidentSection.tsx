import { presidentPortrait } from './assets';
import { AnnouncementIcon, ArrowOut, Eyebrow, Photo, Rule } from './atoms';
import { SITE_CARD } from './SiteChrome';

/**
 * What the President announced, and — just as prominently — what of it this
 * portal actually does.
 *
 * Every quote carries a `caveat`. That pairing is the whole point of the
 * section: both announcements describe more than GDB offers here (coaching
 * and mentorship in the first, a co-investment tier to G$10M in the second),
 * and a citizen who arrives expecting the announced package must not be able
 * to read the quote without reading what is missing from it. The caveat is
 * therefore part of the quote's data, not a note somebody may add later.
 */

interface Quote {
  dateline: string;
  text: string;
  caveat: string;
  cite: string;
}

const QUOTES: Quote[] = [
  {
    dateline: '7 JUNE 2026',
    text: 'You don’t have to own anything. You just have to have an idea that we will help you develop, that we will help you to nurture.',
    caveat:
      'Announced nationally. This portal prepares an application for the direct G$3M financing only. The coaching and mentorship described alongside it are not offered here.',
    cite: 'H.E. Dr. Mohamed Irfaan Ali · Department of Public Information, Guyana · 7 June 2026',
  },
  {
    dateline: '17 DECEMBER 2025',
    text: '…will have access to an additional $7 million, on preferential interest rates, unlocking financing of up to $10 million.',
    caveat:
      "Announced nationally in his address to the nation. The Department of Public Information's report of that address says micro businesses will be able to apply for up to $3 million in zero-collateral, zero-interest loans, and that the further $7 million comes through a co-investment mechanism. This portal offers the direct G$3M portion only. The co-investment tier is not available here.",
    cite: 'H.E. Dr. Mohamed Irfaan Ali · Department of Public Information, Guyana · 17 December 2025',
  },
];

export function PresidentSection() {
  return (
    <section className={SITE_CARD}>
      <Eyebrow>THE PRESIDENT ON THE GUYANA DEVELOPMENT BANK</Eyebrow>

      <div className="mt-14 flex flex-col gap-12 xl:flex-row xl:gap-[72px]">
        <div className="flex w-full flex-none flex-col gap-[22px] xl:w-80">
          <Photo
            src={presidentPortrait}
            alt="H.E. Dr. Mohamed Irfaan Ali, President of the Co-operative Republic of Guyana"
            label="PORTRAIT"
            className="h-[500px] rounded-3xl"
          />
          <div>
            <div className="text-[19px] leading-[1.35] font-extrabold text-gdb-ink">
              H.E. Dr. Mohamed Irfaan Ali
            </div>
            <div className="mt-[5px] text-[15px] leading-[1.5] text-gdb-ink/60">
              President of the Co-operative Republic of Guyana
            </div>
          </div>
          <div className="flex items-start gap-[13px] rounded-2xl bg-gdb-pill px-[18px] py-4 text-gdb-ink">
            <AnnouncementIcon />
            <span className="font-code text-[11px] leading-[1.52] font-extrabold tracking-[0.08em] text-gdb-ink/80">
              ANNOUNCED NATIONALLY &middot; NOT OFFERED ON THIS PORTAL
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-11">
          {QUOTES.map((quote, index) => (
            <div key={quote.dateline} className="contents">
              {index > 0 && <Rule />}
              <article>
                <div className="font-code text-[12px] font-extrabold tracking-[0.12em] text-gdb-goldleaf">
                  {quote.dateline}
                </div>
                <blockquote className="mt-6 border-l-[3px] border-gdb-goldleaf pl-[18px] font-display text-[24px] leading-[1.32] font-bold tracking-[-0.015em] text-gdb-ink sm:text-[28px] sm:pl-[26px] xl:text-[34px]">
                  {quote.text}
                </blockquote>
                <div className="mt-6 rounded-2xl bg-gdb-mist px-6 py-[22px] text-[15px] leading-[1.7] text-gdb-ink/75">
                  {quote.caveat}
                </div>
                <div className="mt-6">
                  <div className="font-code text-[12px] leading-[1.55] font-medium text-gdb-ink/50">
                    {quote.cite}
                  </div>
                  {/* The source is a Department of Public Information report
                      that is not linked from here yet — shown as the label it
                      will carry, not as an anchor that goes nowhere. */}
                  <span className="mt-2.5 inline-flex items-center gap-2 font-code text-[12px] font-extrabold tracking-[0.1em] text-gdb-indigo opacity-45">
                    READ THE SOURCE
                    <ArrowOut />
                  </span>
                </div>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
