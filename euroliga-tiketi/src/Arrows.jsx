import { ChevronIcon } from './icons.jsx'

// Strelice u cijeloj aplikaciji: isto dugme (kolo, stranice, mjesec) i ista ikonica uz tekst (nazad / naprijed).
// Strelica u rečenici ("Granice → Forma", "14.5 → 15.5") ostaje znak →, jer nije dugme.

const SIZES = {
  md: 'size-9 rounded-[10px] [&_svg]:size-4.5',
  sm: 'size-8 rounded-[9px] [&_svg]:size-4',
}

// Dugme sa strelicom; blijedo kad nema dalje. size: md (kolo) ili sm (stranice, mjesec).
export function ArrowButton({ direction, label, disabled = false, onClick, size = 'md' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`grid shrink-0 place-items-center bg-surface-2 text-zinc-300 ring-1 ring-white/12 transition ring-inset hover:bg-accent/12 hover:text-accent hover:ring-accent/45 active:scale-94 disabled:pointer-events-none disabled:opacity-30 motion-reduce:active:scale-100 ${SIZES[size]}`}
    >
      <ChevronIcon direction={direction} />
    </button>
  )
}

// Kolo: strelice i naziv kao jedna cjelina ("‹ Kolo 14 · uto i čet ›").
export function RoundStepper({ title, sub, busy = false, prevDisabled, nextDisabled, onPrev, onNext }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[13px] bg-surface p-1 ring-1 ring-line ring-inset">
      <ArrowButton direction="left" label="Prethodno kolo" disabled={prevDisabled || busy} onClick={onPrev} />
      <div className={`flex min-w-34 flex-col px-2.5 text-center leading-[1.05] ${busy ? 'opacity-60' : ''}`}>
        <b className="font-display text-[22px] font-bold tracking-wider text-white uppercase">{title}</b>
        {sub && <span className="text-xs text-zinc-400">{sub}</span>}
      </div>
      <ArrowButton direction="right" label="Sljedeće kolo" disabled={nextDisabled || busy} onClick={onNext} />
    </div>
  )
}

// Ikonica uz tekst linka ili dugmeta; roditelj ima klasu "group", pa se ikonica pomjeri na prelaz mišem.
export function ArrowText({ direction, children }) {
  const icon = (
    <ChevronIcon
      direction={direction}
      className={`size-3.75 shrink-0 transition motion-reduce:transition-none ${
        direction === 'left' ? 'group-hover:-translate-x-0.5' : 'group-hover:translate-x-0.5'
      }`}
    />
  )
  return (
    <span className="inline-flex items-center gap-1.5">
      {direction === 'left' && icon}
      {children}
      {direction === 'right' && icon}
    </span>
  )
}
