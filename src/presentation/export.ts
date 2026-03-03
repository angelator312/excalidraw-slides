import html2canvas from 'html2canvas'

export async function exportElementToPNG(el: HTMLElement, scale = 1): Promise<Blob> {
  const canvas = await html2canvas(el, {scale})
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob)))
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
