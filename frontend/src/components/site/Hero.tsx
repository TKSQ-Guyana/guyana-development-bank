import { coatOfArms, ministryOfFinance } from './assets';
import { Crest, Eyebrow, GoldLink, IndigoLink, NotOpenIcon } from './atoms';

/**
 * The hero, and the credential panel beside it.
 *
 * The two halves answer different questions and are weighted accordingly: the
 * left says what is on offer, the right says who is offering it and that it
 * is not open yet. The "not yet open" line is not a footnote — it sits inside
 * the same panel as the crests, because the authority and the caveat are the
 * same claim and should never be read apart.
 */
export function Hero() {
  return (
    <section className="flex flex-col items-center gap-12 rounded-[20px] bg-white px-7 py-20 sm:px-12 xl:flex-row xl:gap-[88px] xl:rounded-[32px] xl:px-18 xl:py-24">
      <div className="min-w-0 flex-1">
        <Eyebrow>A PROPOSED NATIONAL PROGRAMME FOR GUYANESE ENTERPRISE</Eyebrow>

        <h2 className="mt-[34px] font-display text-[44px] leading-[1.02] font-extrabold tracking-[-0.025em] text-gdb-ink sm:text-[64px] xl:text-[80px]">
          Prosperity
          <br />
          starts with
          <br />
          <span className="text-gdb-indigo">your business.</span>
        </h2>

        <div className="mt-6 h-1.5 rounded-full bg-gdb-goldleaf" />

        <p className="mt-[34px] text-[17px] leading-[1.72] text-gdb-ink/80 sm:text-[20px]">
          A bank built to raise incomes, leave decisions with the people doing the work, start new
          businesses and back the small and medium enterprises Guyana runs on. Up to{' '}
          <strong className="font-extrabold text-gdb-indigo">G$3M</strong> a loan, at{' '}
          <strong className="font-extrabold text-gdb-indigo">0% interest</strong>, with{' '}
          <strong className="font-extrabold text-gdb-indigo">no collateral</strong>.
        </p>

        <div className="mt-11 flex flex-wrap items-center gap-6 sm:gap-7">
          <GoldLink to="/login">Sign in</GoldLink>
          <IndigoLink>See the terms in full</IndigoLink>
        </div>
      </div>

      <aside className="flex w-full flex-none flex-col gap-[26px] rounded-3xl bg-gdb-lav p-[34px] xl:w-[356px]">
        <div className="flex items-center gap-[22px]">
          <Crest src={coatOfArms} alt="Coat of arms of Guyana" className="h-[60px] w-[63px]" />
          <span className="h-12 w-px bg-gdb-lavline" />
          <Crest
            src={ministryOfFinance}
            alt="Ministry of Finance logo"
            className="h-[60px] w-[60px]"
            blend
          />
        </div>

        <p className="text-[16px] leading-[1.68] text-gdb-ink/80">
          A proposed programme of the{' '}
          <strong className="font-extrabold text-gdb-ink">Government of Guyana</strong>, through the{' '}
          <strong className="font-extrabold text-gdb-ink">Ministry of Finance</strong>.
        </p>

        <hr className="h-px border-0 bg-gdb-lavline" />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-[11px] text-gdb-ink">
            <NotOpenIcon />
            <b className="text-[16px] font-extrabold text-gdb-ink/85">The bank is not yet open.</b>
          </div>
          <IndigoLink className="text-[15px] leading-[1.45]">
            Where the programme stands today
          </IndigoLink>
        </div>
      </aside>
    </section>
  );
}
