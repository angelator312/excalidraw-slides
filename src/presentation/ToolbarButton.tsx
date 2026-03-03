import { h } from 'preact'

type Props = {
  label: string
  onClick?: () => void
}

export default function ToolbarButton({ label, onClick }: Props) {
  return (
    <button className="toolbar-button" aria-label={label} onClick={onClick}>
      {label}
    </button>
  )
}
