import { h } from 'preact'

export default function createPresentationPlugin() {
  // Minimal plugin shell: real integration would register toolbars, export points, and sync
  return {
    id: 'com.example.excalidraw-slides',
    name: 'Slides',
    render: () => h('div', {role: 'presentation'}, 'Slides plugin placeholder')
  }
}
