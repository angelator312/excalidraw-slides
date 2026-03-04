import { exportToCanvas } from '@excalidraw/excalidraw'

export type ExportableSlide = {
  elements: readonly any[]
  appState?: Record<string, any>
  files?: Record<string, any>
}

/**
 * Export a slide's elements to a PNG blob using Excalidraw's own renderer.
 * This produces pixel-perfect results since it uses the same canvas pipeline.
 */
export async function exportSlideToPNG(slide: ExportableSlide, scale = 2): Promise<Blob> {
  const canvas = await exportToCanvas({
    elements: slide.elements as any,
    appState: { ...(slide.appState ?? {}), exportWithDarkMode: false },
    files: slide.files ?? {},
    getDimensions: () => ({ width: 1280, height: 960, scale }),
  })
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/png'))
}

export async function downloadPNG(blob: Blob, filename = 'slide.png') {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Low-res thumbnail (used for sidebar previews). Returns an object URL.  */
export async function generateThumbnailUrl(slide: ExportableSlide): Promise<string> {
  const canvas = await exportToCanvas({
    elements: slide.elements as any,
    appState: { ...(slide.appState ?? {}), exportWithDarkMode: false },
    files: slide.files ?? {},
    getDimensions: () => ({ width: 320, height: 240, scale: 1 }),
  })
  return canvas.toDataURL('image/png')
}

