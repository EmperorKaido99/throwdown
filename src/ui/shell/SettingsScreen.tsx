import { POSE_CONFIG } from "../../config/tuning";
import { reloadWithWorker, type Settings } from "../../config/settings";

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  delegate: string | null;
}

export function SettingsScreen({ settings, onChange, delegate }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  const workerOn = POSE_CONFIG.useWorker;

  return (
    <div className="screen">
      <h2>Settings</h2>

      <section className="howto-section">
        <h3>Display</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.showSkeleton}
            onChange={(e) => set("showSkeleton", e.target.checked)}
          />
          Show tracked skeleton
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.showRawSkeleton}
            disabled={!settings.showSkeleton}
            onChange={(e) => set("showRawSkeleton", e.target.checked)}
          />
          Also show the unsmoothed skeleton (orange)
        </label>
      </section>

      <section className="howto-section">
        <h3>Inference path</h3>
        <p className="muted small">
          Where MediaPipe runs. Currently:{" "}
          <strong>{workerOn ? "Web Worker" : "main thread"}</strong>
          {delegate ? ` · ${delegate} delegate` : ""}.
        </p>
        <div className="row">
          <button
            className="btn"
            disabled={!workerOn}
            onClick={() => reloadWithWorker(false)}
          >
            Use main thread
          </button>
          <button
            className="btn"
            disabled={workerOn}
            onClick={() => reloadWithWorker(true)}
          >
            Use Web Worker
          </button>
        </div>
        <p className="muted small">
          Switching reloads the page. The worker path is off by default because
          the only comparison so far measured it <em>slower</em> (13.8 vs 15.1
          FPS), and that comparison is not yet settled.
        </p>
        {import.meta.env.DEV && (
          <p className="warn small">
            The worker cannot load under the dev server at all — MediaPipe needs
            a classic worker and Vite serves module workers in dev. Run{" "}
            <code>npm run build &amp;&amp; npm run preview</code> to test it.
          </p>
        )}
      </section>

      <section className="howto-section">
        <h3>Privacy</h3>
        <p className="muted small">
          There is no server, no account and no telemetry. The camera stream and
          every landmark derived from it stay in this browser tab. When
          multiplayer is built, only classified events — "left hand threw a
          hook on frame 1234" — will cross the network. Never video, never
          landmarks.
        </p>
      </section>
    </div>
  );
}
