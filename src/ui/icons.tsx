import type { SVGProps } from 'react'

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'book'
  | 'check'
  | 'chevron-right'
  | 'close'
  | 'headphones'
  | 'home'
  | 'info'
  | 'mic'
  | 'pause'
  | 'play'
  | 'refresh'
  | 'spark'
  | 'stop'
  | 'target'
  | 'trend'
  | 'wifi-off'

interface IconProps extends SVGProps<SVGSVGElement> {
  readonly name: IconName
}

export function Icon({ name, ...props }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    'arrow-left': (
      <>
        <path d="M19 12H5" />
        <path d="m11 18-6-6 6-6" />
      </>
    ),
    'arrow-right': (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
        <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
    headphones: (
      <>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <path d="M4 14h3v6H5a1 1 0 0 1-1-1z" />
        <path d="M20 14h-3v6h2a1 1 0 0 0 1-1z" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </>
    ),
    pause: (
      <>
        <path d="M9 6v12" />
        <path d="M15 6v12" />
      </>
    ),
    play: <path d="m9 6 9 6-9 6z" />,
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M18.5 9A7 7 0 0 0 6.3 6.3L4 9" />
        <path d="M5.5 15A7 7 0 0 0 17.7 17.7L20 15" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" />
        <path d="m5 16 .7 2.3L8 19l-2.3.7L5 22l-.7-2.3L2 19l2.3-.7z" />
        <path d="m19 14 .6 1.9 1.9.6-1.9.6L19 19l-.6-1.9-1.9-.6 1.9-.6z" />
      </>
    ),
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M15 9 21 3" />
        <path d="M17 3h4v4" />
      </>
    ),
    trend: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 4-4 3 3 5-7" />
      </>
    ),
    'wifi-off': (
      <>
        <path d="m3 3 18 18" />
        <path d="M8.5 8.5A9.5 9.5 0 0 1 21 9" />
        <path d="M3 9a14 14 0 0 1 2.7-1.8" />
        <path d="M6 13a9 9 0 0 1 6-2.3" />
        <path d="M18 13a8.8 8.8 0 0 0-1.4-1" />
        <path d="M9.5 16.5a3.5 3.5 0 0 1 5 0" />
        <path d="M12 20h.01" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
