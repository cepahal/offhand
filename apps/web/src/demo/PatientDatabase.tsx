/** Patient-record sheet over the workstation. The cursor edit is simulated and confirmed. */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  bindPatientWindow,
  closePatientWindow,
  CONFIRMED_PRESCRIPTION,
  allergyConflict,
  readPatient,
  updatePrescription,
  type PatientRecord,
} from './patient-record.js';
import { IconClose } from './icons.js';

type Phase = 'idle' | 'selected' | 'typing' | 'updated';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function glide(from: { x: number; y: number }, to: { x: number; y: number }, ms: number, frame: (point: { x: number; y: number }) => void): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const eased = t * t * (3 - 2 * t);
      frame({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function PatientDatabase() {
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState<PatientRecord>(readPatient());
  const [shown, setShown] = useState(patient.prescription);
  const [phase, setPhase] = useState<Phase>('idle');
  const [cursor, setCursor] = useState({ x: 36, y: 48, visible: false });
  const root = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const show = () => {
      const current = readPatient();
      setPatient(current);
      setShown(current.prescription);
      setPhase('idle');
      setCursor({ x: 36, y: 48, visible: false });
      setOpen(true);
    };
    bindPatientWindow({
      open: show,
      close: () => {
        setCursor((point) => ({ ...point, visible: false }));
        setOpen(false);
      },
      async showCursor() {
        show();
        await wait(60);
        const target = prescriptionPoint(root.current);
        setCursor({ x: 36, y: 48, visible: true });
        await glide({ x: 36, y: 48 }, target, 1100, (point) => setCursor({ ...point, visible: true }));
      },
      async animateField(next) {
        const previous = shownRef.current;
        setPhase('selected');
        await wait(360);
        for (let i = previous.length; i >= 0; i -= 1) {
          setShown(previous.slice(0, i));
          await wait(32);
        }
        setPhase('typing');
        for (let i = 1; i <= next.length; i += 1) {
          setShown(next.slice(0, i));
          await wait(38);
        }
        setPhase('updated');
      },
    });
    return () => bindPatientWindow(null);
  }, []);

  if (!open) return null;

  const rows: [string, string, string?][] = [
    ['Name', patient.name],
    ['Age', String(patient.age)],
    ['Chief complaint', patient.initialProblem],
    ['Medical history', patient.medicalHistory],
    ['Allergies', patient.allergies, 'allergy'],
    ['Diagnosis', patient.diagnosis],
    ['Plan', patient.treatment],
    ['Prescription', shown, 'prescription'],
  ];
  const conflict = allergyConflict(shown, patient.allergies);

  return (
    <>
      <div class="sheet-scrim" onClick={() => closePatientWindow()} />
      <div class="sheet" ref={root} role="dialog" aria-label="Patient record">
        <div class="sheet-head">
          <div>
            <h2>Patient record · {patient.name} <span class="allergy-chip">Allergy: {patient.allergies}</span></h2>
            <p>Synthetic demonstration record · not a real person · not linked to this scan</p>
          </div>
          <button type="button" class="btn-plain" aria-label="Close" onClick={() => closePatientWindow()}><IconClose size={18} /></button>
        </div>
        <div class="sheet-body">
          <table>
            <tbody>
              {rows.map(([label, value, field]) => (
                <tr key={label}>
                  <th class={label === 'Allergies' ? 'alert' : ''}>{label}</th>
                  <td class={field === 'prescription' ? phase : ''} data-field={field}>
                    {field === 'allergy' ? <span class="allergy-chip">{value} · allergy</span> : value || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {conflict && <p class="conflict" role="alert">Conflicts with recorded allergy: {conflict}. Review before confirming.</p>}
        </div>
        <div class="sheet-actions">
          <button type="button" class="btn" onClick={() => closePatientWindow()}>Close</button>
          <button type="button" class="btn btn-primary" onClick={() => { void updatePrescription(CONFIRMED_PRESCRIPTION, true); }}>
            Set prescription to {CONFIRMED_PRESCRIPTION}
          </button>
        </div>
        {cursor.visible && (
          <svg class="ai-cursor" style={{ left: `${cursor.x}px`, top: `${cursor.y}px` }} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" stroke="#111" stroke-width="1" d="M5 2l14 9-6 1 4 8-3 1-4-8-5 4V2z" />
          </svg>
        )}
      </div>
    </>
  );
}

function prescriptionPoint(rootEl: HTMLDivElement | null): { x: number; y: number } {
  const cell = rootEl?.querySelector('[data-field="prescription"]');
  if (!rootEl || !cell) return { x: 220, y: 220 };
  const cellBox = cell.getBoundingClientRect();
  const rootBox = rootEl.getBoundingClientRect();
  return { x: cellBox.left - rootBox.left + 8, y: cellBox.top - rootBox.top + cellBox.height / 2 };
}
