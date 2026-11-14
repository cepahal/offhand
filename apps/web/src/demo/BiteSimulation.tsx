/**
 * Occlusal biomechanics page. Numbers come from the local scenario file.
 * Bite-force maps are not available yet; the launch button remains intentionally inert.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { biteFactors, biteFindings, overallClass, type FactorStatus } from './bite-analysis.js';
import { BITE_DISCLAIMER, BITE_SCENARIOS, biteScenario, scenarioForTraining, type BiteScenario } from './bite-scenarios.js';
import { BAND_COLOR, BONE_THRESHOLDS, boneReading, pressureBand, type BoneKey } from './bite-view.js';

type RunPhase = 'ready' | 'running' | 'paused' | 'done';

const BONE_LABELS: Record<BoneKey, string> = {
  corticalBone: 'Cortical bone',
  trabecularBone: 'Trabecular bone',
  periodontalLigament: 'Periodontal ligament',
  tmjLoading: 'TMJ',
};

export function BiteSimulation({
  trainingTitle,
  patientName,
  request,
  onNote,
}: {
  trainingTitle: string;
  patientName: string;
  request: { scenarioId: string | null; focus: 'bone' | 'analysis' | 'adjustments' | null; replay: number };
  onNote: (text: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(() => scenarioForTraining(trainingTitle).id);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<RunPhase>('ready');
  const [speed, setSpeed] = useState(1);
  const progressRef = useRef(0);
  const phaseRef = useRef<RunPhase>('ready');
  const speedRef = useRef(1);
  phaseRef.current = phase;
  speedRef.current = speed;
  const scenario = biteScenario(selectedId) ?? scenarioForTraining(trainingTitle);
  const noted = useRef('');

  useEffect(() => {
    if (request.scenarioId) setSelectedId(request.scenarioId);
  }, [request.scenarioId]);

  useEffect(() => {
    if (request.replay === 0) return;
    setRun(0, 'running');
  }, [request.replay]);

  useEffect(() => {
    const target = request.focus === 'bone' ? 'bite-bone' : request.focus === 'adjustments' ? 'bite-adjustments' : request.focus === 'analysis' ? 'bite-analysis' : '';
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'nearest' });
  }, [request.focus, request.replay, selectedId]);

  useEffect(() => {
    const line = phase === 'running' ? `Bite simulation started for FDI ${scenario.fdi}.` : phase === 'done' ? `Bite simulation completed for FDI ${scenario.fdi}.` : '';
    if (!line || noted.current === line) return;
    noted.current = line;
    onNote(line);
  }, [phase, scenario.fdi]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = now - last;
      last = now;
      if (phaseRef.current !== 'running') return;
      const next = Math.min(1, progressRef.current + dt / (3200 / speedRef.current));
      progressRef.current = next;
      setProgress(next);
      if (next >= 1) setPhase('done');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function setRun(next: number, run: RunPhase): void {
    progressRef.current = next;
    setProgress(next);
    setPhase(run);
  }

  function choose(id: string): void {
    setSelectedId(id);
    setRun(0, 'ready');
  }

  return (
    <section class="page bite">
      <h1>Occlusal Biomechanics Simulator</h1>
      <p class="lead">Bite Simulation for {patientName}. Open training case: {trainingTitle}.</p>
      <p class="flag">{BITE_DISCLAIMER}</p>
      <div class="bite-controls">
        <button type="button" class="btn" onClick={() => setRun(phase === 'done' ? 0 : progressRef.current, 'running')}>Run Simulation</button>
        <button type="button" class="btn" onClick={() => setPhase('paused')}>Pause</button>
        <button type="button" class="btn" onClick={() => setRun(0, 'running')}>Replay</button>
        <button type="button" class="btn" onClick={() => setRun(0, 'ready')}>Reset</button>
        <label>Speed <input aria-label="Simulation speed" type="range" min="0.5" max="2" step="0.5" value={speed} onInput={(event) => setSpeed(Number(event.currentTarget.value))} /></label>
        <label>
          Select tooth
          <select aria-label="Select tooth" value={scenario.fdi} onChange={(event) => choose(BITE_SCENARIOS.find((item) => item.fdi === event.currentTarget.value)?.id ?? scenario.id)}>
            {BITE_SCENARIOS.map((item) => (
              <option key={item.id} value={item.fdi}>FDI {item.fdi} · Universal {item.universal}</option>
            ))}
          </select>
        </label>
      </div>
      <div class="progress" role="progressbar" aria-label="Simulation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div class="bite-pick" role="listbox" aria-label="Change scenario">
        {BITE_SCENARIOS.map((item) => (
          <button key={item.id} type="button" role="option" aria-selected={item.id === scenario.id} class={item.id === scenario.id ? 'on' : ''} onClick={() => choose(item.id)}>
            {item.id.slice(5)} · FDI {item.fdi}
          </button>
        ))}
      </div>
      {/* TODO(offhand): load the future GLB bite-force map here. */}
      <button class="btn" type="button" aria-label="Open bite force map">
        Open bite force map
      </button>
      <BoneOverload scenario={scenario} />
      {(phase === 'done' || request.focus === 'analysis' || request.focus === 'adjustments') && <AnalysisPanel scenario={scenario} focus={request.focus} />}
      <ScenarioDetail scenario={scenario} />
    </section>
  );
}

const STATUS_COLOR: Record<FactorStatus, string> = {
  Normal: '#8ca17d',
  Elevated: '#d0a75d',
  'Exceeds Demo Threshold': '#c87869',
};

function AnalysisPanel({ scenario, focus }: { scenario: BiteScenario; focus: 'bone' | 'analysis' | 'adjustments' | null }) {
  const factors = biteFactors(scenario);
  const findings = biteFindings(scenario);
  const exceeded = factors.filter((factor) => factor.status === 'Exceeds Demo Threshold').length;
  return (
    <div class="cols">
      <article class="sect" id="bite-analysis">
        <h2>Simulation overview</h2>
        <p class="flag">{BITE_DISCLAIMER}</p>
        <dl class="kv">
          <div><dt>Selected tooth</dt><dd>FDI {scenario.fdi} · Universal {scenario.universal}</dd></div>
          <div><dt>Simulated bite force</dt><dd>{scenario.biteForceN} N</dd></div>
          <div><dt>Overall loading</dt><dd style={{ color: STATUS_COLOR[overallClass(factors)] }}>{overallClass(factors)}</dd></div>
          <div><dt>Factors over threshold</dt><dd>{exceeded} of {factors.length}</dd></div>
        </dl>
        <h2>11 biomechanical factors</h2>
        <ul class="factors">
          {factors.map((factor) => (
            <li key={factor.name}>
              <span>{factor.name}</span>
              <b>{factor.value}</b>
              <small>Threshold {factor.threshold}</small>
              <i><em style={{ width: `${factor.gauge}%`, background: STATUS_COLOR[factor.status] }} /></i>
              <strong style={{ color: STATUS_COLOR[factor.status] }}>{factor.status}</strong>
            </li>
          ))}
        </ul>
      </article>
      <article class="sect" id="bite-adjustments">
        <h2>Potential biomechanical issues</h2>
        <p class="lead">Illustrative suggestions requiring clinician assessment. Not a diagnosis.</p>
        {findings.length === 0 ? <p>No demonstration threshold was crossed for this scenario.</p> : (
          <ul class="findings">
            {findings.map((finding) => <li key={finding.title}>{finding.title}</li>)}
          </ul>
        )}
        <h2>Suggested adjustments</h2>
        {findings.length === 0 ? <p>No adjustment is suggested from these demonstration rules.</p> : (
          <ul class="findings">
            {findings.map((finding) => <li key={finding.suggestion}>{finding.suggestion}</li>)}
          </ul>
        )}
        {focus === 'adjustments' ? <p class="flag">Showing suggested adjustments for this scenario.</p> : null}
      </article>
    </div>
  );
}

function BoneOverload({ scenario }: { scenario: BiteScenario }) {
  const items = (Object.keys(BONE_THRESHOLDS) as BoneKey[]).map((key) => {
    const threshold = BONE_THRESHOLDS[key];
    const score = scenario[key];
    return { key, score, threshold, ...boneReading(score, threshold) };
  });
  return (
    <article class="sect" id="bite-bone">
      <h2>Bone overload</h2>
      <p class="flag">{BITE_DISCLAIMER}</p>
      <p class="lead">Colored marks show where this scenario’s illustrative load sits relative to a fixed demonstration threshold.</p>
      <div class="bone-arch" aria-hidden="true">
        <span class="joint left" style={{ background: BAND_COLOR[severityColor(items[3]!.severity)] }} />
        <span class="joint right" style={{ background: BAND_COLOR[severityColor(items[3]!.severity)] }} />
        <span class="shell" style={{ borderColor: BAND_COLOR[severityColor(items[0]!.severity)] }} />
        <span class="core" style={{ background: BAND_COLOR[severityColor(items[1]!.severity)] }} />
        <span class="ligament" style={{ background: BAND_COLOR[severityColor(items[2]!.severity)] }} />
      </div>
      <dl class="kv">
        {items.map((item) => (
          <div key={item.key}>
            <dt>{BONE_LABELS[item.key]}</dt>
            <dd>{item.score} / threshold {item.threshold} · {item.exceeded ? 'Exceeded' : 'Within threshold'} · {item.severity}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function severityColor(severity: 'Low' | 'Moderate' | 'Elevated' | 'High'): keyof typeof BAND_COLOR {
  if (severity === 'Low') return 'low';
  if (severity === 'Moderate') return 'moderate';
  if (severity === 'Elevated') return 'elevated';
  return 'high';
}

function ScenarioDetail({ scenario }: { scenario: BiteScenario }) {
  const rows: [string, string][] = [
    ['Scenario', `${scenario.id} · ${scenario.title}`],
    ['Tooth, FDI', scenario.fdi],
    ['Tooth, Universal', String(scenario.universal)],
    ['Numbering', 'FDI is the two-digit system shown on the training cases. Universal is the 1–32 system for the same tooth.'],
    ['Simulated bite force', `${scenario.biteForceN} N`],
    ['Occlusal contact area', `${scenario.contactAreaMm2} mm²`],
    ['Left-right balance', `${scenario.leftPercent}% left · ${100 - scenario.leftPercent}% right`],
    ['Cusp interference score', String(scenario.cuspInterference)],
    ['Crown loading score', String(scenario.crownLoading)],
    ['Cortical bone loading score', String(scenario.corticalBone)],
    ['Trabecular bone loading score', String(scenario.trabecularBone)],
    ['Periodontal ligament loading score', String(scenario.periodontalLigament)],
    ['TMJ loading score', String(scenario.tmjLoading)],
    ['Load concentration score', String(scenario.loadConcentration)],
  ];
  return (
    <div class="cols">
      <article class="sect">
        <h2>Scenario result</h2>
        <p class="flag">{BITE_DISCLAIMER}</p>
        <dl class="kv">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </article>
      <article class="sect">
        <h2>Contact pressure distribution</h2>
        <p class="lead">Demonstration zones for this scenario. Not a measured pressure map.</p>
        <ul class="pressure">
          {scenario.pressure.map((zone) => (
            <li key={zone.zone}>
              <span>{zone.zone}</span>
              <b style={{ color: BAND_COLOR[pressureBand(zone.mpa)] }}>{zone.mpa.toFixed(1)} MPa</b>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
