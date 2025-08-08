import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { format, addMinutes, setHours, setMinutes, differenceInMinutes } from 'date-fns';
import { api } from './api';

type Staff = { id: string; name: string; color?: string; active: boolean };

type Slot = { staff_id: string; start_ts: string; end_ts: string; reason: 'gap_fill' | 'best_fit' | 'staff_pref' };

function MinutesOfDayGrid({
  date, cols, gran = 10, onCellClick,
}: { date: Date; cols: Staff[]; gran?: number; onCellClick: (s: Staff, at: Date) => void }) {
  const rows = useMemo(() => Array.from({ length: (24 * 60) / gran }, (_, i) => i * gran), [gran]);
  const start = setMinutes(setHours(date, 0), 0);

  return (
    <div className="grid" style={{ gridTemplateColumns: `120px repeat(${cols.length}, 1fr)` }}>
      {/* headers */}
      <div className="col-header timecol"></div>
      {cols.map((c) => (
        <div key={c.id} className="col-header">
          {c.name}
        </div>
      ))}
      {/* body */}
      {rows.map((min) => {
        const t = addMinutes(start, min);
        return (
          <React.Fragment key={min}>
            <div className="cell timecol" style={{ height: 20 }}>
              {format(t, 'HH:mm')}
            </div>
            {cols.map((c) => (
              <div key={c.id + '_' + min} className="cell" style={{ height: 20 }} onClick={() => onCellClick(c, t)} />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function App() {
  const [date, setDate] = useState(() => new Date());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [panel, setPanel] = useState<{ staff?: Staff; at?: Date } | null>(null);
  const [selectedService, setSelectedService] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    (async () => {
      const [s, sv] = await Promise.all([api.staff(), api.services()]);
      setStaff(s);
      setServices(sv);
      if (sv.length) setSelectedService(sv[0].id);
    })().catch((e) => setError(String(e)));
  }, []);

  async function refreshSlots(serviceId: string) {
    if (!serviceId) return;
    const yyyy = date.toISOString().slice(0, 10);
    const res = await api.availability({ service_id: serviceId, date_from: yyyy, date_to: yyyy });
    setSlots(res);
  }

  useEffect(() => {
    if (selectedService) refreshSlots(selectedService).catch((err) => setError(String(err)));
  }, [selectedService, date]);

  function slotsFor(staffId: string) {
    return slots
      .filter((s) => s.staff_id === staffId)
      .map((s) => ({
        top: differenceInMinutes(new Date(s.start_ts), new Date(date.toDateString())) * (20 / 10),
        height: differenceInMinutes(new Date(s.end_ts), new Date(s.start_ts)) * (20 / 10),
        reason: s.reason,
        start_ts: s.start_ts,
        end_ts: s.end_ts,
      }));
  }

  async function bookQuick(staffId: string, at: Date) {
    setError('');
    setMessage('');
    if (!selectedService) {
      setError('Select a service first');
      return;
    }
    try {
      const body = {
        client: { name: 'Walk-in' },
        service_id: selectedService,
        staff_id: staffId,
        start_ts: at.toISOString(),
        source: 'web',
      };
      const res = await api.createAppointment(body);
      setMessage(`Booked ${format(new Date(res.start_ts), 'HH:mm')} - ${format(new Date(res.end_ts), 'HH:mm')}`);
      await refreshSlots(selectedService);
      setPanel(null);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setDate(new Date(date.getTime() - 86400000))}>
          ← Prev
        </button>
        <div>{format(date, 'EEE, dd LLL yyyy')}</div>
        <button className="btn" onClick={() => setDate(new Date(date.getTime() + 86400000))}>
          Next →
        </button>
        <select className="select" value={selectedService} onChange={(e) => setSelectedService(e.target.value)}>
          {services.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => refreshSlots(selectedService)}>
          Refresh slots
        </button>
        {message && <div className="notice">{message}</div>}
        {error && <div className="err">{error}</div>}
      </div>

      <div style={{ position: 'relative' }}>
        <MinutesOfDayGrid date={date} cols={staff} onCellClick={(s, at) => setPanel({ staff: s, at })} />
        {/* render slot hints */}
        {staff.map((s) =>
          slotsFor(s.id).map((sl, i) => (
            <div
              key={`${s.id}_${i}`}
              className="slot"
              style={{
                position: 'absolute',
                left: `${(1 / (staff.length + 1)) * 100 * (staff.findIndex((x) => x.id === s.id) + 1)}%`,
                width: `${(1 / (staff.length + 1)) * 100}%`,
                top: sl.top,
                height: sl.height,
                borderColor:
                  sl.reason === 'gap_fill'
                    ? 'rgba(16,185,129,.8)'
                    : sl.reason === 'staff_pref'
                    ? 'rgba(99,102,241,.8)'
                    : 'rgba(59,130,246,.5)',
                background:
                  sl.reason === 'gap_fill'
                    ? 'rgba(16,185,129,.15)'
                    : sl.reason === 'staff_pref'
                    ? 'rgba(99,102,241,.12)'
                    : 'rgba(59,130,246,.12)',
              }}
              title={`${sl.reason} ${format(new Date(sl.start_ts), 'HH:mm')} - ${format(new Date(sl.end_ts), 'HH:mm')}`}
            />
          ))
        )}
      </div>

      {panel && panel.staff && panel.at && (
        <div className="panel">
          <h3>Create appointment</h3>
          <div>
            Staff: <b>{panel.staff.name}</b>
          </div>
          <div>
            When: <b>{format(panel.at, 'HH:mm')}</b>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => bookQuick(panel.staff!.id, panel.at!)}>
              Book here
            </button>
          </div>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            This uses /v1/appointments with Idempotency-Key and then refreshes availability.
          </p>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
