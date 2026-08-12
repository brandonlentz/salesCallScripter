import { useState } from 'react'
import { NEPQ_STAGES } from './nepqStages'

function App() {
  const [activeStage, setActiveStage] = useState(NEPQ_STAGES[0].id)

  return (
    <div className="app">
      <header className="app__header">
        <h1>Sales Call Scripter</h1>
        <p className="app__subtitle">NEPQ live-call teleprompter</p>
      </header>

      <nav className="stage-tracker" aria-label="NEPQ stages">
        {NEPQ_STAGES.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={`stage-tracker__item${stage.id === activeStage ? ' is-active' : ''}`}
            onClick={() => setActiveStage(stage.id)}
            title={stage.description}
          >
            {stage.label}
          </button>
        ))}
      </nav>

      <main className="app__main">
        <section className="panel panel--transcript">
          <h2>Live Transcript</h2>
          <p className="panel__placeholder">
            Audio capture and speech-to-text aren&apos;t wired up yet. This panel will show the
            rolling transcript of the call once that lands.
          </p>
        </section>

        <section className="panel panel--suggestions">
          <h2>Suggested NEPQ Prompts</h2>
          <p className="panel__placeholder">
            Claude-generated suggestions for the current stage will appear here once the
            suggestion engine is connected.
          </p>
        </section>
      </main>
    </div>
  )
}

export default App
