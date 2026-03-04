import { h, render } from 'preact'
import './index.css'
import '@excalidraw/excalidraw/index.css'
import PresenterView from './presentation/PresenterView'

render(<PresenterView />, document.getElementById('app')!)
