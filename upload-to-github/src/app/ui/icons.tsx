import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const I = {
  Cursor: (p: P) => <Svg {...p}><path d="M5 3.5l13 7.2-5.6 1.4 3.2 5.6-2.3 1.3-3.2-5.6L6 17.2z" /></Svg>,
  Terrain: (p: P) => <Svg {...p}><path d="M2.5 19.5l6-9 3.2 4.4 2.3-3.2 7.5 7.8z" /><path d="M7 13.2c1.2.6 2.3.6 3.3-.2" /></Svg>,
  Walls: (p: P) => <Svg {...p}><path d="M3 20V9h2.5v2h2.5V9h2.5v2H13V9h2.5v2H18V9h3v11z" /><path d="M3 15h18M8 15v5M14 15v5M11 11v4M17 11v4" /></Svg>,
  Fort: (p: P) => <Svg {...p}><path d="M6 21V10.5h1.6V9h1.8v1.5h1.4V9h1.8v1.5h1.4V9h1.8v1.5H17V21z" /><path d="M10 21v-4a2 2 0 014 0v4" /><path d="M12 9V3l4.5 1.6L12 6.2" /></Svg>,
  House: (p: P) => <Svg {...p}><path d="M3.5 11L12 4.5l8.5 6.5" /><path d="M5.5 10v10h13V10" /><path d="M10 20v-5h4v5" /></Svg>,
  Tree: (p: P) => <Svg {...p}><path d="M12 21v-6" /><path d="M12 15c-4.5 0-7-2.3-7-5.3 0-2.6 2-4.2 3.8-4.4C9.5 3.5 10.6 3 12 3s2.5.5 3.2 2.3c1.8.2 3.8 1.8 3.8 4.4 0 3-2.5 5.3-7 5.3z" /><path d="M9 21h6" /></Svg>,
  Water: (p: P) => <Svg {...p}><path d="M2.5 9c2 0 2-1.5 4-1.5S8.5 9 10.5 9s2-1.5 4-1.5S16.5 9 18.5 9s2-1.5 3-1.5" /><path d="M2.5 14c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5" /><path d="M2.5 19c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5" /></Svg>,
  People: (p: P) => <Svg {...p}><circle cx="12" cy="5.5" r="2.3" /><path d="M8.5 21l.8-7.5L7 10.2C8 8.8 10 8.2 12 8.2s4 .6 5 2l-2.3 3.3.8 7.5" /><path d="M10.2 4.2c1-.9 2.6-.9 3.6 0" /></Svg>,
  Decor: (p: P) => <Svg {...p}><circle cx="7" cy="16.5" r="3.2" /><path d="M9.6 14.6l9.9-6.4 1.2 2-9.6 6.6" /><circle cx="7" cy="16.5" r="0.9" /><path d="M3 21h8" /></Svg>,
  Diya: (p: P) => <Svg {...p}><path d="M3 14c2.5 3.6 6 5 9 5s6.5-1.4 9-5H3z" /><path d="M12 12.5c-1.6-1.5-1.6-3.3 0-6.5 1.6 3.2 1.6 5 0 6.5z" /><path d="M7 21h10" /></Svg>,
  Undo: (p: P) => <Svg {...p}><path d="M9 7L4.5 11.5 9 16" /><path d="M5 11.5h9.5a5 5 0 010 10H12" /></Svg>,
  Redo: (p: P) => <Svg {...p}><path d="M15 7l4.5 4.5L15 16" /><path d="M19 11.5H9.5a5 5 0 000 10H12" /></Svg>,
  Check: (p: P) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
  Save: (p: P) => <Svg {...p}><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></Svg>,
  Camera: (p: P) => <Svg {...p}><path d="M3.5 8.5h3l1.6-2.5h7.8l1.6 2.5h3v11h-17z" /><circle cx="12" cy="13.5" r="3.5" /></Svg>,
  Sunrise: (p: P) => <Svg {...p}><path d="M5 17a7 7 0 0114 0" /><path d="M2.5 20h19M12 3.5v4M4.8 9.3l1.7 1.6M19.2 9.3l-1.7 1.6M9.5 6.5L12 4l2.5 2.5" /></Svg>,
  Sun: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></Svg>,
  Golden: (p: P) => <Svg {...p}><path d="M4.5 16a7.5 7.5 0 0115 0" /><path d="M2.5 16h19M5 19.5h14M12 5v2.5M5.5 8.5l1.8 1.6M18.5 8.5l-1.8 1.6" /></Svg>,
  Sunset: (p: P) => <Svg {...p}><path d="M6.5 17a5.5 5.5 0 0111 0" /><path d="M2.5 17h19M12 13.5V8.5M9.5 11L12 13.5 14.5 11" /><path d="M7 20.5h10" /></Svg>,
  Moon: (p: P) => <Svg {...p}><path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" /><path d="M17 3.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" /></Svg>,
  Share: (p: P) => <Svg {...p}><path d="M12 3.5v12M7.5 8L12 3.5 16.5 8" /><path d="M5 12.5V20h14v-7.5" /></Svg>,
  Help: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 015 1c0 1.8-2.5 2-2.5 4" /><circle cx="12" cy="17.3" r="0.6" fill="currentColor" /></Svg>,
  Grid: (p: P) => <Svg {...p}><path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" /></Svg>,
  Killas: (p: P) => <Svg {...p}><path d="M3.5 6.5h6l2 2h9v11h-17z" /><path d="M8 16.5v-3h1v1h1.2v-1h1.2v1h1.2v-1h1.2v1h1.2v-1h1v3" /></Svg>,
  Plus: (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  Trash: (p: P) => <Svg {...p}><path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13" /><path d="M10 11v5.5M14 11v5.5" /></Svg>,
  Copy: (p: P) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" /></Svg>,
  Focus: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>,
  Close: (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  Info: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r="0.7" fill="currentColor" /></Svg>,
  Raise: (p: P) => <Svg {...p}><path d="M3 19.5c3 0 4-8.5 9-8.5s6 8.5 9 8.5" /><path d="M12 8V3M9.5 5.5L12 3l2.5 2.5" /></Svg>,
  Lower: (p: P) => <Svg {...p}><path d="M3 11c3 0 4 7 9 7s6-7 9-7" /><path d="M12 3v6M9.5 6.5L12 9l2.5-2.5" /></Svg>,
  Smooth: (p: P) => <Svg {...p}><path d="M3 16c3-3 6-3 9 0s6 3 9 0" /><path d="M3 10c3-3 6-3 9 0s6 3 9 0" opacity={0.45} /></Svg>,
  Flatten: (p: P) => <Svg {...p}><path d="M3 15h18" /><path d="M3 19.5c3 0 3.5-4.5 5-4.5h8c1.5 0 2 4.5 5 4.5" /><path d="M8 8.5l4 3 4-3" /></Svg>,
  Slope: (p: P) => <Svg {...p}><path d="M3 19.5L21 8v11.5z" /><path d="M7 17l2.5-1.6M11 14.5l2.5-1.6M15 12l2.5-1.6" /></Svg>,
  Roughen: (p: P) => <Svg {...p}><path d="M3 17l2.5-4 2 2.5 3-6 2 4 2.5-3 2 3.5 2-2 2 5" /></Svg>,
  Erode: (p: P) => <Svg {...p}><path d="M3 19.5c2.5 0 3-2 4.5-5S10 7 12 7s3 4.5 4.5 7.5 2 5 4.5 5" /><path d="M8.5 19.5l1-2M12 19.5v-2.5M15.5 19.5l-1-2" /></Svg>,
  Move: (p: P) => <Svg {...p}><path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" /></Svg>,
  Rotate: (p: P) => <Svg {...p}><path d="M19.5 12a7.5 7.5 0 11-2.2-5.3" /><path d="M19.5 4v4.5H15" /></Svg>,
  Scale: (p: P) => <Svg {...p}><rect x="3.5" y="10.5" width="10" height="10" rx="1.5" /><path d="M13 4h7v7M20 4l-7.5 7.5" /></Svg>,
  Image: (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M3 17l5-4.5 4 3.5 3-2.5 6 5" /></Svg>,
  Download: (p: P) => <Svg {...p}><path d="M12 3.5v12M7.5 11L12 15.5 16.5 11" /><path d="M4.5 19.5h15" /></Svg>,
  Upload: (p: P) => <Svg {...p}><path d="M12 15.5v-12M7.5 8L12 3.5 16.5 8" /><path d="M4.5 19.5h15" /></Svg>,
  Settings: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8l1.5 2.4 2.8-.4.6 2.8 2.5 1.3-1.1 2.6 1.1 2.6-2.5 1.3-.6 2.8-2.8-.4L12 21.2l-1.5-2.4-2.8.4-.6-2.8-2.5-1.3L5.7 12 4.6 9.4l2.5-1.3.6-2.8 2.8.4z" /></Svg>,
  Flag: (p: P) => <Svg {...p}><path d="M6 21V3.5" /><path d="M6.5 4.5c3.5 0 7 1.5 12.5 1.5-2.5 1.2-4 2.3-4.6 3.3 1.5.8 3 1.6 4.6 2.2-5.5 0-9-1.5-12.5-1.5" /></Svg>,
  Brush: (p: P) => <Svg {...p}><path d="M14.5 4.5l5 5L11 18l-5-5z" /><path d="M6 13c-2 0-3 1.5-3 3.5S2.5 20 2.5 20s3.5.5 5.5-.5 2-3 2-3" /></Svg>,
  Sparkle: (p: P) => <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></Svg>,
  Edit: (p: P) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Svg>,
  Pond: (p: P) => <Svg {...p}><path d="M5 13c0-4 4-6.5 8-6s6.5 3 6 6.5-4 5-8 4.5S5 16.5 5 13z" /><path d="M8.5 13c1-.6 2-.6 3 0s2 .6 3 0" /></Svg>,
  Lake: (p: P) => <Svg {...p}><path d="M2.5 14c2-4.5 6-6 10-5.5s8 2 9 5.5c-2 3.5-7 5-11 4.5s-7-1.5-8-4.5z" /><path d="M7 13.5c1.2-.7 2.4-.7 3.6 0s2.4.7 3.6 0" /></Svg>,
  Tank: (p: P) => <Svg {...p}><path d="M3.5 7h17v12h-17z" /><path d="M6 9.5h12v7H6z" /><path d="M8.5 12h7v2.5h-7z" /></Svg>,
  Moat: (p: P) => <Svg {...p}><ellipse cx="12" cy="15" rx="9.5" ry="5" /><path d="M8.5 15V8h1.5v1.2h1.3V8h1.4v1.2h1.3V8h1.5v7" /></Svg>,
  River: (p: P) => <Svg {...p}><path d="M5 2.5c3 4 -3 7 0 11s-1 6 1 8" /><path d="M11 2.5c3 4 -3 7 0 11s-1 6 1 8" /><path d="M14 8l6-1.5M13.5 16l6.5 1" /></Svg>,
  Stream: (p: P) => <Svg {...p}><path d="M8 2.5c4 3.5-3 6.5 1 10s-2 6 0 9" /><path d="M14.5 6.5c1.5.5 3 .3 4.5-.5M15 15c1.4.6 2.8.6 4.2 0" /></Svg>,
  Waterfall: (p: P) => <Svg {...p}><path d="M3 4.5h8v15" /><path d="M11 4.5h2.5" /><path d="M12 7v10M14.5 7v9M17 8v8" /><path d="M10 20c2-1 5-1 9 0" /></Svg>,
  Keyboard: (p: P) => <Svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 14h12" /></Svg>,
};
