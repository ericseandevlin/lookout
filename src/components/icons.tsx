// Lucide paths copied from the design prototype so stroke weights match exactly.
type P = { size?: number; stroke?: string; sw?: number; style?: React.CSSProperties };

function Svg({ size = 16, stroke = "currentColor", sw = 1.9, style, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      {children}
    </svg>
  );
}

export const PanelIcon = ({ open, ...p }: P & { open: boolean }) => (
  <Svg {...p}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d={open ? "m16 15-3-3 3-3" : "m14 9 3 3-3 3"} /></Svg>
);
export const BoardIcon = (p: P) => (
  <Svg {...p}><path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /></Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}><path d="M3 12h.01" /><path d="M3 18h.01" /><path d="M3 6h.01" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M8 6h13" /></Svg>
);
export const FileIcon = (p: P) => (
  <Svg {...p}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></Svg>
);
export const CalendarIcon = (p: P) => (
  <Svg {...p}><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></Svg>
);
export const PinIcon = (p: P) => (
  <Svg sw={1.8} {...p}><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></Svg>
);
export const ArchiveIcon = (p: P) => (
  <Svg sw={1.8} {...p}><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></Svg>
);
export const SearchIcon = (p: P) => (
  <Svg size={15} stroke="#A89F92" sw={2.2} {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Svg>
);
export const ChevronDown = (p: P) => (
  <Svg size={12} sw={2.2} {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
export const CheckIcon = (p: P) => (
  <Svg size={18} sw={2.6} {...p}><path d="M20 6 9 17l-5-5" /></Svg>
);
export const XIcon = (p: P) => (
  <Svg size={14} sw={2.6} {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>
);
export const LinkIcon = (p: P) => (
  <Svg size={13} sw={2} {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Svg>
);
export const ArrowUpRight = (p: P) => (
  <Svg size={13} sw={2.2} {...p}><path d="M7 7h10v10" /><path d="M7 17 17 7" /></Svg>
);
export const TrashIcon = (p: P) => (
  <Svg size={14} {...p}><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" /></Svg>
);
export const PencilIcon = (p: P) => (
  <Svg size={14} {...p}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></Svg>
);
export const SlidersIcon = (p: P) => (
  <Svg size={15} sw={2} {...p}><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></Svg>
);
export const PlusIcon = (p: P) => (
  <Svg size={14} sw={2.2} {...p}><path d="M5 12h14" /><path d="M12 5v14" /></Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></Svg>
);
