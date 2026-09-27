
type Props = { className?: string }

function Svg({ children, className }: Props & { children: React.ReactNode }) {
  return (
    <svg className={`b-i ${className ?? ''}`} viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

export const IconChevron = (p: Props) => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
)

export const IconCheck = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
)

export const IconAlert = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.5M8 11h.01" />
  </Svg>
)

export const IconBolt = (p: Props) => (
  <Svg {...p}>
    <path d="M9 1.75L3.75 9h4l-1 5.25L12.25 7h-4L9 1.75z" />
  </Svg>
)

export const IconCancel = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M6 6l4 4M10 6l-4 4" />
  </Svg>
)

export const IconClock = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.25l2.25 1.5" />
  </Svg>
)

export const IconUserOff = (p: Props) => (
  <Svg {...p}>
    <circle cx="7" cy="5.5" r="2.5" />
    <path d="M2.5 13.5c.5-2.3 2.3-3.75 4.5-3.75.8 0 1.6.2 2.2.55M10.5 10.5l3 3M13.5 10.5l-3 3" />
  </Svg>
)

export const IconUpload = (p: Props) => (
  <Svg {...p}>
    <path d="M8 10.5V2.75M5 5.75l3-3 3 3M2.75 13.25h10.5" />
  </Svg>
)

export const IconSearch = (p: Props) => (
  <Svg {...p}>
    <circle cx="7.25" cy="7.25" r="4.5" />
    <path d="M10.5 10.5l2.75 2.75" />
  </Svg>
)

export const IconClose = (p: Props) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)

export const IconFit = (p: Props) => (
  <Svg {...p}>
    <path d="M2.75 6V2.75H6M10 2.75h3.25V6M13.25 10v3.25H10M6 13.25H2.75V10" />
  </Svg>
)

export const IconSun = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3.25" />
    <path d="M8 1.5v1.25M8 13.25v1.25M14.5 8h-1.25M2.75 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" />
  </Svg>
)

export const IconMoon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 8.53A6 6 0 1 1 7.47 2a4.67 4.67 0 0 0 6.53 6.53z" />
  </Svg>
)

export const IconUsers = (p: Props) => (
  <Svg {...p}>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.75 13.25c.4-2.4 2.2-3.9 4.25-3.9s3.85 1.5 4.25 3.9M10.5 3.4a2.5 2.5 0 010 4.2M12 9.9c1.3.55 2.1 1.8 2.35 3.35" />
  </Svg>
)

export const IconSliders = (p: Props) => (
  <Svg {...p}>
    <path d="M2 4h3.5M9.5 4H14M2 8h7.5M13.5 8H14M2 12h2.5M8.5 12H14" />
    <circle cx="7.5" cy="4" r="1.75" />
    <circle cx="11.5" cy="8" r="1.75" />
    <circle cx="6.5" cy="12" r="1.75" />
  </Svg>
)

export const IconCompare = (p: Props) => (
  <Svg {...p}>
    <path d="M3 13.25V7.5M8 13.25V2.75M13 13.25V5.5M1.75 13.25h12.5" />
  </Svg>
)

export const IconCalendar = (p: Props) => (
  <Svg {...p}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.5" />
    <path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3" />
  </Svg>
)

export const IconPin = (p: Props) => (
  <Svg {...p}>
    <path d="M8 14.25s4.25-4.1 4.25-7.5a4.25 4.25 0 0 0-8.5 0c0 3.4 4.25 7.5 4.25 7.5z" />
    <circle cx="8" cy="6.75" r="1.5" />
  </Svg>
)

export const IconPlay = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 2.75v10.5L12.75 8z" />
  </Svg>
)

export const IconPhone = (p: Props) => (
  <Svg {...p}>
    <rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.5" />
    <path d="M7 12h2" />
  </Svg>
)

export const IconShield = (p: Props) => (
  <Svg {...p}>
    <path d="M8 1.75 2.75 3.75v4c0 3 2.2 5.2 5.25 6.5 3.05-1.3 5.25-3.5 5.25-6.5v-4z" />
    <path d="m5.5 8 1.75 1.75L10.75 6.25" />
  </Svg>
)

export const IconDots = (p: Props) => (
  <Svg {...p}>
    <circle cx="3" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconBell = (p: Props) => (
  <Svg {...p}>
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3L4 11z" />
    <path d="M6.5 14a1.6 1.6 0 0 0 3 0" />
  </Svg>
)

export const IconChart = (p: Props) => (
  <Svg {...p}>
    <path d="M3 13V8M6.5 13V4M10 13V9M13.5 13V6" />
  </Svg>
)

/* ── Приложение бригады: вкладки, действия с заявкой, способы поездки ──
   Эмодзи здесь не годятся: у каждой системы свой рисунок и своя краска,
   тему они не слушают, а рядом с контурными значками читаются чужими. */

export const IconBriefcase = (p: Props) => (
  <Svg {...p}>
    <rect x="2.25" y="4.75" width="11.5" height="8.5" rx="1.5" />
    <path d="M5.75 4.75V3.5a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.25M2.25 8.5h11.5" />
  </Svg>
)

export const IconMap = (p: Props) => (
  <Svg {...p}>
    <path d="M1.75 3.75l4-1.5 4.5 1.5 4-1.5v10l-4 1.5-4.5-1.5-4 1.5z" />
    <path d="M5.75 2.25v10M10.25 3.75v10" />
  </Svg>
)

export const IconRoute = (p: Props) => (
  <Svg {...p}>
    <circle cx="3.75" cy="3.75" r="1.75" />
    <circle cx="12.25" cy="12.25" r="1.75" />
    <path d="M5.5 3.75h5a2.25 2.25 0 0 1 0 4.5h-5a2.25 2.25 0 0 0 0 4.5h5" />
  </Svg>
)

export const IconChat = (p: Props) => (
  <Svg {...p}>
    <path d="M3.75 2.75h8.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7.25l-3 2.5v-2.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-5.5a1.5 1.5 0 0 1 1.5-1.5z" />
  </Svg>
)

export const IconUser = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="5.25" r="2.75" />
    <path d="M2.75 13.75c.5-2.6 2.6-4.25 5.25-4.25s4.75 1.65 5.25 4.25" />
  </Svg>
)

export const IconCall = (p: Props) => (
  <Svg {...p}>
    <path d="M13.75 11.1v1.65a1.1 1.1 0 0 1-1.2 1.1 10.9 10.9 0 0 1-4.75-1.7 10.7 10.7 0 0 1-3.3-3.3 10.9 10.9 0 0 1-1.7-4.77A1.1 1.1 0 0 1 3.9 2.9h1.65a1.1 1.1 0 0 1 1.1.95c.07.54.2 1.06.39 1.55a1.1 1.1 0 0 1-.25 1.16l-.7.7a8.8 8.8 0 0 0 3.3 3.3l.7-.7a1.1 1.1 0 0 1 1.16-.25c.49.19 1.01.32 1.55.39a1.1 1.1 0 0 1 .95 1.1z" />
  </Svg>
)

export const IconCompass = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M10.5 5.5 9.25 9.25 5.5 10.5l1.25-3.75z" />
  </Svg>
)

export const IconNavigate = (p: Props) => (
  <Svg {...p}>
    <path d="M13.75 2.25 2.25 7l5 1.75L9 13.75z" />
  </Svg>
)

export const IconWarning = (p: Props) => (
  <Svg {...p}>
    <path d="M7.13 2.75a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5z" />
    <path d="M8 6.25v3M8 11.5h.01" />
  </Svg>
)

export const IconStar = (p: Props) => (
  <Svg {...p}>
    <path d="M8 2.25l1.53 4.15 4.41.17-3.47 2.73 1.2 4.26L8 11.1l-3.67 2.46 1.2-4.26-3.47-2.73 4.41-.17z" />
  </Svg>
)

export const IconArrowRight = (p: Props) => (
  <Svg {...p}>
    <path d="M2.75 8h10.5M9 3.75 13.25 8 9 12.25" />
  </Svg>
)

export const IconCar = (p: Props) => (
  <Svg {...p}>
    <path d="M2.25 11.25V8.5l1.4-3.75a1.5 1.5 0 0 1 1.4-.97h5.9a1.5 1.5 0 0 1 1.4.97l1.4 3.75v2.75z" />
    <path d="M2.25 8.5h11.5M4.25 11.25v1.5M11.75 11.25v1.5M4.5 10h1M10.5 10h1" />
  </Svg>
)

export const IconCarShare = (p: Props) => (
  <Svg {...p}>
    <path d="M2.25 13v-2.25l1.2-2.9a1.25 1.25 0 0 1 1.15-.77h6.8a1.25 1.25 0 0 1 1.15.77l1.2 2.9V13z" />
    <path d="M2.25 10.75h11.5M4.25 13v1M11.75 13v1" />
    <circle cx="5" cy="3.25" r="1.5" />
    <path d="M6.5 3.25h5M10.25 3.25v1.25M11.5 3.25v.9" />
  </Svg>
)

export const IconTransit = (p: Props) => (
  <Svg {...p}>
    <rect x="3.25" y="1.75" width="9.5" height="10" rx="2" />
    <path d="M3.25 7.25h9.5M5.75 9.6h.01M10.25 9.6h.01M5 11.75l-1 2.5M11 11.75l1 2.5" />
  </Svg>
)

export const IconScooter = (p: Props) => (
  <Svg {...p}>
    <circle cx="3.5" cy="12" r="1.75" />
    <circle cx="12.5" cy="12" r="1.75" />
    <path d="M5.25 12h5.5M12.5 12 10.75 2.75H9" />
  </Svg>
)

export const IconBike = (p: Props) => (
  <Svg {...p}>
    <circle cx="3.75" cy="10.75" r="2.75" />
    <circle cx="12.25" cy="10.75" r="2.75" />
    <path d="M3.75 10.75h3.5l3-5.25 2 5.25M7.25 10.75 6 5.5M5 5.5h2.25M7 7.25h3M9.5 3.75h1.5" />
  </Svg>
)

export const IconWalk = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="2.75" r="1.25" />
    <path d="M8.5 5.25 7 9.5l2.25 1.75 1 3M7 9.5l-1.5 4.75M8.5 5.25l2.25 2.25 1.75.5M8.5 5.25 6 6.5l-.75 2" />
  </Svg>
)

export const IconPlus = (p: Props) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)

export const IconGrid = (p: Props) => (
  <Svg {...p}>
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.5" />
    <path d="M2.25 6.1h11.5M2.25 9.9h11.5M6.1 2.25v11.5M9.9 2.25v11.5" />
  </Svg>
)

export const IconTable = (p: Props) => (
  <Svg {...p}>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5" />
    <path d="M2.25 6.25h11.5M2.25 9.75h11.5M6 6.25v7" />
  </Svg>
)

export const IconFlask = (p: Props) => (
  <Svg {...p}>
    <path d="M6.25 2.25h3.5M6.75 2.25v4L3.1 12.4a1 1 0 00.87 1.35h8.06a1 1 0 00.87-1.35L9.25 6.25v-4M4.6 10h6.8" />
  </Svg>
)

export const IconSum = (p: Props) => (
  <Svg {...p}>
    <path d="M3 13.25V9.5M6.33 13.25V6M9.67 13.25V8M13 13.25V3.25" />
  </Svg>
)

export const IconKeyboard = (p: Props) => (
  <Svg {...p}>
    <rect x="1.75" y="4" width="12.5" height="8" rx="1.5" />
    <path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6" />
  </Svg>
)

/** Аналитический отчёт: лист с графиком. */
export const IconReport = (p: Props) => (
  <Svg {...p}>
    <path d="M4 1.75h5.5l2.75 2.75v9.75H4z" />
    <path d="M9.5 1.75V4.5h2.75M6 12v-2M8 12V7.5M10 12V9" />
  </Svg>
)

export const IconEye = (p: Props) => (
  <Svg {...p}>
    <path d="M1.75 8s2.25-4.25 6.25-4.25S14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
)
