function Icon({ className, strokeWidth = 2.5, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

export function BallIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18M5.6 5.6c3.4 3.5 3.4 9.3 0 12.8M18.4 5.6c-3.4 3.5-3.4 9.3 0 12.8" />
    </Icon>
  )
}

export function PlusIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function XIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function EyeIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

export function EyeOffIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={1.8}>
      <path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Icon>
  )
}

export function AlertIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2.2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </Icon>
  )
}

export function LockIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  )
}

export function ChevronIcon({ className, direction = 'right' }) {
  return (
    <Icon className={className} strokeWidth={2.2}>
      <path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </Icon>
  )
}

export function UserIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5" />
    </Icon>
  )
}

export function DownloadIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2.2}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
    </Icon>
  )
}

export function BellIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  )
}

// Dugme „Podijeli“ u Safariju.
export function ShareIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2}>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8" />
    </Icon>
  )
}

export function TrophyIcon({ className }) {
  return (
    <Icon className={className} strokeWidth={2.2}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.4M17 6h2.5a2.5 2.5 0 0 1-2.6 3.4M12 14v4M8 20h8" />
    </Icon>
  )
}
