import { useState } from 'react'
import { Canvas } from '@react-three/fiber'

/**
 * M1-T1: the 3D viewport.
 *
 * Owns the R3F <Canvas> and nothing else. The scene is deliberately EMPTY
 * (clear color only) until the module kit (M2) and assembler (M3) land —
 * this component is where the assembled ship will mount.
 *
 * `ready` flips once the renderer has been created (Canvas onCreated),
 * letting the shell — and tests — tell "booted and rendering" apart from a
 * blank or failed WebGL context.
 */
export default function Viewport() {
  const [ready, setReady] = useState(false)

  return (
    <div className="viewport" data-testid="viewport">
      <Canvas gl={{ antialias: true }} onCreated={() => setReady(true)}>
        {/* Empty scene: nothing but a background until the kit lands. */}
        <color attach="background" args={['#05070a']} />
      </Canvas>
      {ready && (
        <span className="viewport-ready" data-testid="viewport-ready">
          viewport ready
        </span>
      )}
    </div>
  )
}
