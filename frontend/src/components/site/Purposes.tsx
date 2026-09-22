import { Eyebrow, Meta } from './atoms';
import { SITE_CARD } from './SiteChrome';

/**
 * The five purposes the programme exists for.
 *
 * Five in a three-column grid leaves a deliberate empty cell rather than a
 * sixth invented purpose or a stretched layout — the count is the count.
 */

const PURPOSES: { n: string; title: string; body: string }[] = [
  {
    n: '01',
    title: 'Building prosperity',
    body: 'Growth you can feel where you live and work: the shops, the fields and the workshops of every region, not only the national accounts.',
  },
  {
    n: '02',
    title: 'Raising incomes',
    body: 'A business that can take the next job, buy the next stock and pay a better wage. Higher earnings for the owner and for the people they employ are the point of the capital, not a side effect.',
  },
  {
    n: '03',
    title: "Putting power in people's hands",
    body: 'Decisions about what gets built stay with the person who knows the trade. The programme supplies the capital. It does not supply the plan, or the conditions a lender usually attaches.',
  },
  {
    n: '04',
    title: 'Bringing new businesses into being',
    body: 'Capital for a first venture, not only for one with years of audited accounts behind it. A business that never starts employs nobody, buys from nobody and trains nobody.',
  },
  {
    n: '05',
    title: 'Standing behind small and medium enterprises',
    body: 'Most working Guyanese earn their living in a small or medium enterprise. They are the reason this programme exists, not one segment of a lending book.',
  },
];

export function Purposes() {
  return (
    <section className={SITE_CARD}>
      <div className="flex flex-col items-start gap-10 xl:flex-row xl:gap-20">
        <div className="w-full flex-none xl:w-[660px]">
          <Eyebrow>WHY THIS BANK EXISTS</Eyebrow>
          <h2 className="mt-[30px] font-display text-[38px] leading-[1.08] font-extrabold tracking-[-0.02em] text-gdb-ink sm:text-[54px] xl:text-[68px]">
            What the capital
            <br />
            <span className="text-gdb-indigo">is for.</span>
          </h2>
        </div>
        <p className="min-w-0 flex-1 text-[17px] leading-[1.72] text-gdb-ink/80 sm:text-[19px] xl:pt-[46px]">
          A national programme, not a product on sale. It has five purposes, and all of them are
          about what happens outside this building: the workshops, the fields and the shopfronts that
          already keep the country running.
        </p>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-14 sm:grid-cols-2 xl:mt-24 xl:grid-cols-3">
        {PURPOSES.map((purpose) => (
          <div key={purpose.n} className="border-t-2 border-gdb-goldleaf pt-[22px]">
            <div className="font-code text-[15px] font-extrabold tracking-[0.12em] text-gdb-indigo">
              {purpose.n}
            </div>
            <h3 className="mt-4 font-display text-[24px] leading-[1.26] font-extrabold text-gdb-ink">
              {purpose.title}
            </h3>
            <p className="mt-4 text-[16px] leading-[1.68] text-gdb-ink/80">{purpose.body}</p>
          </div>
        ))}
      </div>

      <Meta className="mt-16 xl:mt-[88px]">
        Guyana Development Bank &nbsp;&middot;&nbsp; proposed programme terms &nbsp;&middot;&nbsp; 27
        August 2026
      </Meta>
    </section>
  );
}
