import { serializeSlide, deserializeSlide } from '../src/presentation/slideModel'

function testSerializeRoundtrip() {
  const slide = { id: '1', title: 'A', content: { shapes: [] } }
  const raw = serializeSlide(slide as any)
  const out = deserializeSlide(raw)
  if (out.id !== slide.id) throw new Error('id mismatch')
  if (out.title !== slide.title) throw new Error('title mismatch')
}

try {
  testSerializeRoundtrip()
  console.log('slideModel tests passed')
  process.exit(0)
} catch (e) {
  console.error('slideModel tests failed', e)
  process.exit(1)
}
