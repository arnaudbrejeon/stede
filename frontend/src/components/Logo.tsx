type LogoProps = {
  size?: number
}

// Placeholder mark: a map pin with a house cut out of it ("stede": place, homestead).
// Keep public/favicon.svg in sync when this changes.
export function Logo({ size = 28 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d="M16 2C10.2 2 5.5 6.6 5.5 12.3 5.5 20 16 30 16 30s10.5-10 10.5-17.7C26.5 6.6 21.8 2 16 2z" />
      <path fill="#fff" d="M16 7.2l-5.6 4.6v5.7h4v-3.6h3.2v3.6h4v-5.7z" />
    </svg>
  )
}
