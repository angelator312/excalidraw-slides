export type Slide = {
  id: string
  title?: string
  content: any
}

export function getSlidesFromFile(file: File): Promise<Slide[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result))
        if (Array.isArray(json.slides)) resolve(json.slides)
        else reject(new Error('Invalid slide file: missing slides array'))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

export function serializeSlide(slide: Slide) {
  return JSON.stringify(slide)
}

export function deserializeSlide(raw: string): Slide {
  return JSON.parse(raw) as Slide
}
