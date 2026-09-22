import {
  sectorAgriculture,
  sectorManufacturing,
  sectorOrangeCare,
  sectorTechnology,
  sectorTourism,
} from './assets';
import { ArrowOut, GoldLink, IndigoLink, Meta, Photo } from './atoms';
import { SITE_CARD } from './SiteChrome';

/**
 * The five priority sectors, as a citizen would recognise their own trade.
 *
 * Every card carries the same "Up to G$3M" — that repetition is the message.
 * The terms do not change by sector, so nothing here should suggest that
 * some trades get a better deal than others.
 */

const SECTORS: { photo: string; label: string; title: string; body: string }[] = [
  {
    photo: sectorAgriculture,
    label: 'AGRICULTURE',
    title: 'Agriculture',
    body: 'Farmers, fishers, agro-processors and the suppliers who keep them working, in every region.',
  },
  {
    photo: sectorTourism,
    label: 'TOURISM',
    title: 'Tourism & hospitality',
    body: 'Guesthouses, tour operators, caterers and the small trades that visitors spend with.',
  },
  {
    photo: sectorManufacturing,
    label: 'MANUFACTURING',
    title: 'Manufacturing',
    body: 'Making here what the country has been buying from abroad: food, garments, furniture, building materials.',
  },
  {
    photo: sectorTechnology,
    label: 'TECHNOLOGY',
    title: 'Technology & services',
    body: 'Repair, logistics, professional and digital services. The businesses other businesses depend on.',
  },
  {
    photo: sectorOrangeCare,
    label: 'ORANGE & CARE',
    title: 'Orange & care economy',
    body: 'Creative work, culture, childcare and care services: trades that employ neighbours and hold communities together.',
  },
];

export function Sectors() {
  return (
    <section className={SITE_CARD}>
      <div className="flex flex-col items-start gap-10 xl:flex-row xl:gap-20">
        <div className="w-full flex-none xl:w-[660px]">
          <h2 className="font-display text-[38px] leading-[1.08] font-extrabold tracking-[-0.02em] text-gdb-ink sm:text-[54px] xl:text-[68px]">
            Find the work
            <br />
            <span className="text-gdb-indigo">you already do.</span>
          </h2>
        </div>
        <p className="min-w-0 flex-1 text-[17px] leading-[1.72] text-gdb-ink/80 sm:text-[19px] xl:pt-[22px]">
          Whatever trade you are in, the terms are the same. These are the five sectors the proposed
          programme is built around. Open one to see who it is meant for.
        </p>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-10 sm:grid-cols-2 xl:mt-[88px] xl:grid-cols-3">
        {SECTORS.map((sector) => (
          <article
            key={sector.title}
            className="flex flex-col overflow-hidden rounded-2xl border border-gdb-line bg-white"
          >
            <Photo
              src={sector.photo}
              alt={sector.title}
              label={sector.label}
              className="aspect-[352/234]"
            />
            <div className="flex flex-1 flex-col justify-between gap-[22px] px-[26px] py-6">
              <div>
                <div className="text-[19px] font-extrabold tracking-[-0.01em] text-gdb-indigo">
                  Up to G$3M
                </div>
                <h3 className="mt-2 text-[17px] leading-[1.35] font-extrabold text-gdb-ink">
                  {sector.title}
                </h3>
                <p className="mt-2 text-[15px] leading-[1.68] text-gdb-ink/75">{sector.body}</p>
              </div>
              {/* The per-sector page is not built; this is the label it will
                  carry, shown as text so no card offers a dead link. */}
              <span className="inline-flex items-center gap-2.5 font-code text-[13px] font-extrabold tracking-[0.09em] text-gdb-indigo opacity-45">
                PRIORITY SECTORS
                <ArrowOut />
              </span>
            </div>
          </article>
        ))}

        <div className="flex flex-col justify-end gap-[26px] pb-6">
          <p className="text-[17px] leading-[1.7] text-gdb-ink/80">
            Open a sector to see what it covers and who it is meant for. Or sign in and start putting
            your answers together.
          </p>
          <GoldLink to="/login" size="md" className="self-start">
            Sign in and start preparing
          </GoldLink>
          <IndigoLink className="text-[15px]">See what each sector covers</IndigoLink>
        </div>
      </div>

      <Meta className="mt-14">
        Guyana Development Bank &nbsp;&middot;&nbsp; proposed programme terms &nbsp;&middot;&nbsp; 27
        August 2026
      </Meta>
    </section>
  );
}
