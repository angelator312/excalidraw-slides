import { h } from 'preact'

export default function PresenterView() {
  return (
    <section aria-label="Presenter view">
      <div role="toolbar" aria-label="Presentation toolbar">
        <button aria-label="Previous slide">←</button>
        <button aria-label="Next slide">→</button>
      </div>
      <div aria-live="polite">
        <h2>Slides will render here</h2>
        <div style={{width: '800px', height: '600px', border: '1px solid #ccc'}} />
      </div>
    </section>
  )
}
