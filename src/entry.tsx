import { h, render } from 'preact'
import { useState } from 'preact/hooks'
import PresenterView from './presentation/PresenterView'

function App() {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <header>
        <h1>Excalidraw Slides — Plugin Demo</h1>
      </header>
      <main>
        <button onClick={() => setOpen(!open)} aria-pressed={open}>Toggle Presenter</button>
        {open && <PresenterView />}
      </main>
    </div>
  )
}

render(h(App as any), document.getElementById('app')!)
