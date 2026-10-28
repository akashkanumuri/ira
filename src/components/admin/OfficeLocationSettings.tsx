import React, { useEffect, useState } from 'react';
import { Crosshair, ExternalLink, MapPin, Ruler } from 'lucide-react';
import { notify } from '../../lib/toast';
import { GeoError, distanceM, fetchOffice, fmtCoords, fmtDistance, getFix, parseCoords, saveOffice, type OfficeLocation } from '../../lib/officeLocation';
import { Badge, Button, Notice, Skeleton, cx } from '../../ui';

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative w-11 h-6 rounded-full transition-colors shrink-0', on ? 'bg-brand-600' : 'bg-ink-200')}>
      <span className={cx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
    </button>
  );
}

/** Admin: where the office is, and whether office check-in must happen within the radius. */
export function OfficeLocationSettings() {
  const [saved, setSaved] = useState<OfficeLocation | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [name, setName] = useState('Office');
  const [coords, setCoords] = useState('');
  const [radius, setRadius] = useState('150');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<'save' | 'here' | 'test' | null>(null);
  const [hereNote, setHereNote] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = (o: OfficeLocation) => {
    setSaved(o);
    setName(o.name || 'Office');
    setCoords(o.latitude != null && o.longitude != null ? fmtCoords(o.latitude, o.longitude) : '');
    setRadius(String(o.radius_m || 150));
    setEnabled(o.enabled);
  };

  useEffect(() => {
    let alive = true;
    void fetchOffice().then((o) => {
      if (!alive) return;
      if (!o) { setState('missing'); return; }
      load(o);
      setState('ready');
    });
    return () => { alive = false; };
  }, []);

  const parsed = parseCoords(coords);
  const radiusNum = Number(radius);
  const radiusOk = Number.isInteger(radiusNum) && radiusNum >= 50 && radiusNum <= 2000;
  const dirty = !!saved && (
    name.trim() !== saved.name || enabled !== saved.enabled || radiusNum !== saved.radius_m ||
    (parsed?.lat ?? null) !== saved.latitude || (parsed?.lng ?? null) !== saved.longitude
  );

  async function useHere() {
    setBusy('here');
    setHereNote(null);
    setTestNote(null);
    try {
      const fix = await getFix();
      setCoords(fmtCoords(fix.lat, fix.lng));
      setHereNote(fix.accuracy <= 60
        ? `Got it — accurate to about ±${Math.round(fix.accuracy)} m. Save to keep it.`
        : `This reading is only accurate to ±${Math.round(fix.accuracy)} m. Turn Wi-Fi on and try again, or paste the exact coordinates from Google Maps.`);
    } catch (e) {
      notify(e instanceof GeoError ? `${e.message} Allow location for this site and make sure Location Services is on.` : 'Couldn’t read your location.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function testHere() {
    if (!parsed) { notify('Enter the office coordinates first.', 'error'); return; }
    setBusy('test');
    setTestNote(null);
    try {
      const fix = await getFix();
      const d = distanceM(parsed, fix);
      const r = radiusOk ? radiusNum : 150;
      const inside = fix.accuracy <= 1000 && d - Math.min(fix.accuracy, 100) <= r;
      setTestNote({ ok: inside, text: `This laptop is ${fmtDistance(d)} from the pin (reading ±${Math.round(fix.accuracy)} m) — ${inside ? 'check-in would be allowed here.' : 'check-in would be refused here.'}` });
    } catch (e) {
      notify(e instanceof GeoError ? e.message : 'Couldn’t read your location.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!name.trim()) { notify('Give the office a name.', 'error'); return; }
    if (coords.trim() && !parsed) { notify('Those coordinates don’t look right. Paste them like 17.440120, 78.348910.', 'error'); return; }
    if (!radiusOk) { notify('Radius must be a whole number between 50 and 2000 metres.', 'error'); return; }
    if (enabled && !parsed) { notify('Add the office coordinates before switching the check-in rule on.', 'error'); return; }
    setBusy('save');
    try {
      const o = await saveOffice({ name: name.trim(), latitude: parsed?.lat ?? null, longitude: parsed?.lng ?? null, radius_m: radiusNum, enabled });
      load(o);
      notify(o.enabled ? `Saved. Office check-in now works within ${o.radius_m} m.` : 'Office location saved. Check-in isn’t restricted.', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save.', 'error');
    } finally {
      setBusy(null);
    }
  }

  if (state === 'loading') return <div className="card p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>;
  if (state === 'missing') {
    return (
      <Notice tone="sky" title="Office location switches on with the next database update">
        The office check-in rule is ready in the app and appears here once its database update is applied.
      </Notice>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className="card p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full grid place-items-center bg-brand-50 text-brand-600 shrink-0"><MapPin className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-[15px] text-ink-900">Office check-in rule</p>
            <p className="text-[13px] text-ink-500 mt-0.5">When on, employees can check in as “Office” only within the radius below. Check-out, breaks, approved WFH and remote staff are not affected.</p>
          </div>
          <Switch on={enabled} onChange={setEnabled} label="Office check-in rule" />
        </div>

        <label className="block">
          <span className="label">Office name</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. IRA Office, Madhapur" />
        </label>

        <div>
          <span className="label">Office coordinates</span>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={cx('input tnum flex-1', coords.trim() && !parsed && '!border-rose-300')}
              value={coords}
              onChange={(e) => { setCoords(e.target.value); setHereNote(null); setTestNote(null); }}
              placeholder="17.440120, 78.348910"
              inputMode="decimal"
              aria-label="Office coordinates"
            />
            <Button variant="secondary" icon={<Crosshair className="w-4 h-4" />} loading={busy === 'here'} disabled={!!busy && busy !== 'here'} onClick={() => void useHere()}>
              Use my current location
            </Button>
          </div>
          <p className="text-[12px] text-ink-500 mt-1.5">
            {coords.trim() && !parsed
              ? <span className="text-rose-600 font-semibold">Couldn’t read that. Paste latitude, longitude — e.g. 17.440120, 78.348910.</span>
              : hereNote ?? 'Easiest: click “Use my current location” while you’re in the office. Or in Google Maps, right-click the building and click the numbers at the top to copy them, then paste here.'}
          </p>
          {parsed && (
            <a className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 mt-1.5" href={`https://www.google.com/maps?q=${parsed.lat},${parsed.lng}`} target="_blank" rel="noreferrer noopener">
              Check this point on Google Maps <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <label className="block max-w-[220px]">
          <span className="label">Radius <span className="font-normal text-ink-400 ml-1">metres</span></span>
          <input className={cx('input tnum', !radiusOk && '!border-rose-300')} type="number" min={50} max={2000} step={10} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button loading={busy === 'save'} disabled={!dirty || (!!busy && busy !== 'save')} onClick={() => void save()}>Save</Button>
          <Button variant="secondary" icon={<Ruler className="w-4 h-4" />} loading={busy === 'test'} disabled={!parsed || (!!busy && busy !== 'test')} onClick={() => void testHere()}>
            Test from this laptop
          </Button>
          {saved?.enabled ? <Badge tone="mint" dot>On · {saved.radius_m} m</Badge> : <Badge tone="ink" dot>Off</Badge>}
        </div>
        {testNote && <Notice tone={testNote.ok ? 'mint' : 'amber'}>{testNote.text}</Notice>}
      </div>

      <div className="card p-5 sm:p-6 text-[13px] text-ink-600 space-y-3">
        <p className="font-display font-bold text-[15px] text-ink-900">How it works</p>
        <ul className="space-y-2 list-disc pl-4">
          <li>At check-in the laptop shares its location once. The server checks the distance — the laptop can’t decide for itself.</li>
          <li>Laptops find their location from nearby Wi-Fi networks, so Wi-Fi must be <b>on</b>. Being connected to a phone hotspot is fine.</li>
          <li>On a Mac, Location Services must be on for the browser; on Windows, Location must be on in Privacy settings. The check-in screen shows these steps when needed.</li>
          <li>If someone’s location fails while they’re really in, open <b>Attendance</b> and use <b>Check in</b> next to their name. A reason is required and it’s recorded.</li>
        </ul>
      </div>
    </div>
  );
}
