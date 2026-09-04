import './App.css'
import Viewport from './Viewport'

/**
 * Torchship app shell (M1-T1): header + 3D viewport.
 *
 * The header carries the project name, the ship's class line, and the
 * vessel's name — Hound-class corvette "Firebrand", locked when the build
 * started (BUILD_PLAN execution rule 9). The name later lives in the Ship
 * Spec `name` field (M1-T2) and the share URL (M6).
 *
 * The main area is the empty R3F viewport; the ship-spec preset picker
 * arrives with the assembler milestones, not here.
 */
function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Torchship</h1>
        <p className="app-subtitle">
          Hound-class light corvette · ex-navy fusion torch
        </p>
        <span
          className="ship-name"
          data-testid="ship-name"
          title="Vessel name (BUILD_PLAN rule 9)"
        >
          Firebrand
        </span>
      </header>
      <main className="app-main">
        <Viewport />
      </main>
    </div>
  )
}

export default App
