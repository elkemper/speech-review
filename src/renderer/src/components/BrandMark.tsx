export default function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark${large ? ' large' : ''}`} aria-hidden="true">
      <span className="brand-s">S</span>
      <span className="brand-r">R</span>
    </span>
  )
}
