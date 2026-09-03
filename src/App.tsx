import './App.css'

/**
 * Torchship app shell — placeholder until M1-T1 lands the real layout
 * (ship-spec picker + 3D viewport). Deliberately has no three.js import
 * yet: M1-T1 introduces the R3F viewport as its own deliverable.
 */
function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Torchship</h1>
        <p className="app-subtitle">Walkable interior of an ex-navy fusion-torch corvette</p>
      </header>
      <main className="app-main">
        <p className="scaffold-note" data-testid="scaffold-note">
          Scaffold booting — M1-T1 lands the 3D viewport here.
        </p>
      </main>
    </div>
  )
}

export default App
