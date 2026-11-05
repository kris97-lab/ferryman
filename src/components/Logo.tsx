import { useId } from 'react'

// Ferryman: a crescent boat carrying a lit lantern across the water / bridge arc.
export function Logo({ size = 30 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <radialGradient id={`${id}g`} cx="20" cy="11.6" r="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff1cf" stopOpacity=".95" />
          <stop offset=".4" stopColor="#ffc56b" stopOpacity=".4" />
          <stop offset="1" stopColor="#ffc56b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}b`} x1="2" x2="30" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7ce8ff" stopOpacity="0" />
          <stop offset=".5" stopColor="#bff6ff" />
          <stop offset="1" stopColor="#7ce8ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="11.6" r="8" fill={`url(#${id}g)`} className="logo-glow" />
      {/* mast and arm */}
      <path d="M11.5 20C11.5 12 13.5 6.4 20 6.4v2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* lantern */}
      <rect x="18.1" y="8.6" width="3.8" height="5.4" rx="1.2" fill="rgba(124,232,255,.08)" stroke="currentColor" strokeWidth="1.2" />
      <path d="M20 9.7c.2 1.3.4 1.5 1.3 1.8-.9.3-1.1.5-1.3 1.8-.2-1.3-.4-1.5-1.3-1.8.9-.3 1.1-.5 1.3-1.8z" fill="#ffd58a" />
      {/* hull */}
      <path d="M4.5 19.6h23c-1.6 4-5.8 5.9-11.5 5.9S6.1 23.6 4.5 19.6z" fill="currentColor" />
      {/* water / bridge arc */}
      <path d="M2 28.8Q16 24.6 30 28.8" fill="none" stroke={`url(#${id}b)`} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
