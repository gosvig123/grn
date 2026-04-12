type Device = Awaited<ReturnType<typeof window.grn.system.getDevices>>[number]

type RecordViewProps = {
  title: string
  device: number
  devices: Device[]
  canStart: boolean
  canStop: boolean
  onTitleChange: (value: string) => void
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
}

export function RecordView({ title, device, devices, canStart, canStop, onTitleChange, onDeviceChange, onStart, onStop }: RecordViewProps) {
  return (
    <section className="panel panel-large">
      <div className="panel-header">
        <div>
          <h1>Record</h1>
          <p>Start and stop meeting recording using the existing grn backend.</p>
        </div>
      </div>

      <div className="form-grid">
        <label>
          <span>Title</span>
          <input value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Sprint planning" />
        </label>
        <label>
          <span>Device</span>
          <select value={device} onChange={(e) => onDeviceChange(Number(e.target.value))}>
            {devices.map((item) => (
              <option key={item.index} value={item.index}>
                [{item.index}] {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="actions-row">
        <button className="primary" onClick={onStart} disabled={!canStart}>
          Start recording
        </button>
        <button className="secondary" onClick={onStop} disabled={!canStop}>
          Stop recording
        </button>
      </div>
    </section>
  )
}
