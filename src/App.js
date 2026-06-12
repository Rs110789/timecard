import { useState, useEffect, useRef, useCallback } from "react";

// ---- Supabase config ----
const SUPABASE_URL = "https://yrelmzrukylitnmuqbev.supabase.co";
const SUPABASE_KEY = "sb_publishable_1oDQcRJbHbyjW2On7GkdIA_alrNogBW";

const sb = async (path, options = {}) => {
  const { prefer, headers: extraHeaders, ...fetchOptions } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...fetchOptions,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": prefer || "return=representation",
      ...(extraHeaders || {}),
    },
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
};

// ---- DB helpers ----
const dbLoadEmployees = async () => {
  const rows = await sb("employees?select=name,sort_order&order=sort_order.asc");
  return rows.map(r => r.name);
};

const dbSaveEmployees = async (list) => {
  // delete all and re-insert
  await sb("employees?id=gte.0", { method: "DELETE", prefer: "" });
  if (list.length === 0) return;
  await sb("employees", {
    method: "POST",
    body: JSON.stringify(list.map((name, i) => ({ name, sort_order: i + 1 }))),
  });
};

const dbLoadRecords = async () => {
  const rows = await sb("timecard_records?select=employee_name,date,time_in,time_out,photo_in,photo_out");
  const result = {};
  for (const r of rows) {
    if (!result[r.date]) result[r.date] = {};
    result[r.date][r.employee_name] = {
      in: r.time_in, out: r.time_out,
      inPhoto: r.photo_in, outPhoto: r.photo_out,
    };
  }
  return result;
};

const dbUpsertRecord = async (date, name, patch) => {
  await sb("timecard_records", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify({
      employee_name: name,
      date,
      time_in: patch.in ?? null,
      time_out: patch.out ?? null,
      photo_in: patch.inPhoto ?? null,
      photo_out: patch.outPhoto ?? null,
    }),
  });
};

const dbDeleteRecord = async (date, name) => {
  await sb(`timecard_records?employee_name=eq.${encodeURIComponent(name)}&date=eq.${date}`, {
    method: "DELETE", prefer: "",
  });
};

const fmt2 = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`; };
const calcDur = (inn, out) => {
  if (!inn || !out) return null;
  const [ih,im] = inn.split(":").map(Number);
  const [oh,om] = out.split(":").map(Number);
  const mins = (oh*60+om)-(ih*60+im);
  if (mins <= 0) return null;
  return `${Math.floor(mins/60)}h${fmt2(mins%60)}m`;
};
const monthLabel = (ym) => { const [y,m] = ym.split("-"); return `${y}年${Number(m)}月`; };
const getYM = (d) => d.slice(0,7);

// ---- Camera modal ----
function CameraModal({ name, field, onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [captured, setCaptured] = useState(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); setReady(true); }
      }).catch(() => setReady(false));
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const shoot = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    setCaptured(c.toDataURL("image/jpeg", 0.5));
  };
  const confirm = () => { streamRef.current?.getTracks().forEach(t => t.stop()); onCapture(captured); };
  const label = field === "in" ? "出勤" : "退勤";
  const color = field === "in" ? "#6abf69" : "#e57373";

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={{background:"#1a1d2e",borderRadius:"16px",overflow:"hidden",width:"100%",maxWidth:"400px",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"}}>
        <div style={{background:field==="in"?"linear-gradient(135deg,#2d5a35,#1b5e20)":"linear-gradient(135deg,#5a1e1e,#7f2020)",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:"12px",color:"rgba(255,255,255,0.6)",letterSpacing:"2px"}}>{name}</div>
            <div style={{fontSize:"20px",fontWeight:"700",color:"#fff"}}>{label}打刻</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:"50%",width:"36px",height:"36px",color:"#fff",fontSize:"18px",cursor:"pointer"}}>×</button>
        </div>
        <div style={{position:"relative",background:"#000",aspectRatio:"4/3",overflow:"hidden"}}>
          {!captured ? (
            <>
              <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}} muted playsInline />
              <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-55%)",width:"55%",paddingBottom:"70%",border:"2px dashed rgba(255,255,255,0.6)",borderRadius:"50% 50% 45% 45%",pointerEvents:"none"}}/>
              {!ready && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#999",fontSize:"13px"}}>カメラを起動中…</div>}
            </>
          ) : (
            <img src={captured} style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}} alt="captured" />
          )}
          <canvas ref={canvasRef} style={{display:"none"}} />
        </div>
        <div style={{padding:"20px",display:"flex",gap:"12px"}}>
          {!captured ? (
            <button onClick={shoot} disabled={!ready} style={{flex:1,padding:"14px",borderRadius:"10px",border:"none",background:ready?color:"#333",color:"#fff",fontSize:"16px",fontWeight:"700",cursor:ready?"pointer":"not-allowed"}}> 撮影</button>
          ) : (
            <>
              <button onClick={() => setCaptured(null)} style={{flex:1,padding:"14px",borderRadius:"10px",border:"1px solid #444",background:"transparent",color:"#aaa",fontSize:"15px",cursor:"pointer"}}>撮り直す</button>
              <button onClick={confirm} style={{flex:1,padding:"14px",borderRadius:"10px",border:"none",background:color,color:"#fff",fontSize:"16px",fontWeight:"700",cursor:"pointer"}}>v {label}する</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Admin Panel ----
function AdminPanel({ employees, onSave, onClose }) {
  const [list, setList] = useState([...employees]);
  const [newName, setNewName] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [saving, setSaving] = useState(false);

  const addEmployee = () => { const n = newName.trim(); if (!n || list.includes(n)) return; setList([...list, n]); setNewName(""); };
  const startEdit = (i) => { setEditIdx(i); setEditVal(list[i]); };
  const applyEdit = () => { const v = editVal.trim(); if (!v) return; const next=[...list]; next[editIdx]=v; setList(next); setEditIdx(null); };
  const remove = (i) => { setList(list.filter((_,idx) => idx !== i)); setConfirmDel(null); };
  const moveUp = (i) => { if(i===0) return; const n=[...list]; [n[i-1],n[i]]=[n[i],n[i-1]]; setList(n); };
  const moveDown = (i) => { if(i===list.length-1) return; const n=[...list]; [n[i],n[i+1]]=[n[i+1],n[i]]; setList(n); };

  const handleSave = async () => { setSaving(true); await onSave(list); setSaving(false); };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:900,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:"480px",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 -8px 40px rgba(0,0,0,0.2)"}}>
        <div style={{background:"linear-gradient(135deg,#388e3c,#2e7d32)",borderRadius:"20px 20px 0 0",padding:"18px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:"11px",color:"rgba(255,255,255,0.7)",letterSpacing:"2px"}}>ADMIN</div>
            <div style={{fontSize:"20px",fontWeight:"700",color:"#fff"}}>従業員管理</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:"50%",width:"36px",height:"36px",color:"#fff",fontSize:"18px",cursor:"pointer"}}>×</button>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"16px"}}>
          <div style={{background:"#f1f8f1",borderRadius:"12px",padding:"14px",marginBottom:"16px",border:"1px dashed #a5d6a7"}}>
            <div style={{fontSize:"11px",color:"#388e3c",fontWeight:"700",letterSpacing:"1px",marginBottom:"8px"}}>+ 新しい従業員を追加</div>
            <div style={{display:"flex",gap:"8px"}}>
              <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmployee()} placeholder="名前を入力"
                style={{flex:1,padding:"9px 12px",borderRadius:"8px",border:"1px solid #c8e6c9",fontSize:"14px",outline:"none",background:"#fff"}} />
              <button onClick={addEmployee} style={{padding:"9px 18px",borderRadius:"8px",border:"none",background:"#43a047",color:"#fff",fontWeight:"700",fontSize:"14px",cursor:"pointer"}}>追加</button>
            </div>
          </div>
          <div style={{fontSize:"11px",color:"#888",letterSpacing:"1px",marginBottom:"8px"}}>従業員リスト ({list.length}名)</div>
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {list.map((name, i) => (
              <div key={i} style={{background:"#fff",borderRadius:"10px",border:"1px solid #e8f5e9",boxShadow:"0 1px 4px rgba(0,0,0,0.05)",overflow:"hidden"}}>
                {confirmDel === i ? (
                  <div style={{padding:"12px 14px",display:"flex",alignItems:"center",gap:"10px",background:"#fff3f3"}}>
                    <span style={{flex:1,fontSize:"13px",color:"#c62828"}}>「{name}」を削除しますか？</span>
                    <button onClick={() => remove(i)} style={{padding:"6px 14px",borderRadius:"6px",border:"none",background:"#e53935",color:"#fff",fontSize:"12px",fontWeight:"700",cursor:"pointer"}}>削除</button>
                    <button onClick={() => setConfirmDel(null)} style={{padding:"6px 12px",borderRadius:"6px",border:"1px solid #ccc",background:"#fff",fontSize:"12px",cursor:"pointer"}}>キャンセル</button>
                  </div>
                ) : editIdx === i ? (
                  <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:"8px"}}>
                    <input value={editVal} onChange={e=>setEditVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")applyEdit();if(e.key==="Escape")setEditIdx(null);}} autoFocus
                      style={{flex:1,padding:"7px 10px",borderRadius:"6px",border:"1px solid #66bb6a",fontSize:"14px",outline:"none"}} />
                    <button onClick={applyEdit} style={{padding:"7px 14px",borderRadius:"6px",border:"none",background:"#43a047",color:"#fff",fontSize:"13px",fontWeight:"700",cursor:"pointer"}}>保存</button>
                    <button onClick={() => setEditIdx(null)} style={{padding:"7px 10px",borderRadius:"6px",border:"1px solid #ccc",background:"#fff",fontSize:"13px",cursor:"pointer"}}>✕</button>
                  </div>
                ) : (
                  <div style={{padding:"11px 14px",display:"flex",alignItems:"center",gap:"8px"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:"1px"}}>
                      <button onClick={() => moveUp(i)} disabled={i===0} style={{background:"none",border:"none",color:i===0?"#ddd":"#888",fontSize:"10px",cursor:i===0?"default":"pointer",padding:"1px 3px",lineHeight:1}}>^</button>
                      <button onClick={() => moveDown(i)} disabled={i===list.length-1} style={{background:"none",border:"none",color:i===list.length-1?"#ddd":"#888",fontSize:"10px",cursor:i===list.length-1?"default":"pointer",padding:"1px 3px",lineHeight:1}}>v</button>
                    </div>
                    <div style={{width:"30px",height:"30px",borderRadius:"50%",background:"#e8f5e9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",color:"#4caf50",flexShrink:0}}>{name[0]}</div>
                    <div style={{flex:1,fontSize:"14px",fontWeight:"600",color:"#1b5e20"}}>{name}</div>
                    <button onClick={() => startEdit(i)} style={{padding:"5px 12px",borderRadius:"6px",border:"1px solid #c8e6c9",background:"#f1f8f1",color:"#388e3c",fontSize:"12px",cursor:"pointer"}}>編集</button>
                    <button onClick={() => setConfirmDel(i)} style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid #ffcdd2",background:"#fff",color:"#e57373",fontSize:"12px",cursor:"pointer"}}>削除</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:"16px",borderTop:"1px solid #e8f5e9",flexShrink:0}}>
          <button onClick={handleSave} disabled={saving} style={{width:"100%",padding:"14px",borderRadius:"12px",border:"none",background:saving?"#aaa":"linear-gradient(135deg,#43a047,#2e7d32)",color:"#fff",fontSize:"16px",fontWeight:"700",cursor:saving?"not-allowed":"pointer",boxShadow:"0 3px 12px rgba(46,125,50,0.35)"}}>
            {saving ? "保存中…" : "v 保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
// ---- Main App ----
export default function TimeCard() {
  const [records, setRecords] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [tab, setTab] = useState("stamp");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [historyYM, setHistoryYM] = useState(getYM(todayStr()));
  const [camera, setCamera] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [toast, setToast] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    try {
      setError(null);
      const [emp, rec] = await Promise.all([dbLoadEmployees(), dbLoadRecords()]);
      setEmployees(emp);
      setRecords(rec);
    } catch(e) {
      setError("読み込み失敗: " + (e.message || JSON.stringify(e)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const showToast = (msg, color="#6abf69") => { setToast({msg,color}); setTimeout(() => setToast(null), 2500); };

  const getRecord = useCallback((date, name) => records?.[date]?.[name] || {in:null,out:null,inPhoto:null,outPhoto:null}, [records]);

  const updateRecord = async (date, name, patch) => {
    const current = getRecord(date, name);
    const merged = { ...current, ...patch };
    await dbUpsertRecord(date, name, merged);
    setRecords(prev => ({
      ...prev,
      [date]: { ...(prev[date]||{}), [name]: merged }
    }));
  };

  const handleCapture = async (photo) => {
    const { name, field } = camera;
    const time = nowTime();
    try {
      await updateRecord(todayStr(), name, { [field]: time, [`${field}Photo`]: photo });
      setCamera(null);
      showToast(`${name} の${field==="in"?"出勤":"退勤"}を記録しました (${time})`, field==="in"?"#6abf69":"#e57373");
    } catch(e) {
      showToast("保存に失敗しました", "#e57373");
    }
  };

  const clearRecord = async (date, name) => {
    try {
      await dbDeleteRecord(date, name);
      setRecords(prev => {
        const next = { ...prev };
        if (next[date]) { const d = {...next[date]}; delete d[name]; next[date] = d; }
        return next;
      });
      showToast("記録を削除しました", "#e57373");
    } catch(e) {
      showToast("削除に失敗しました", "#e57373");
    }
  };

  const handleSaveEmployees = async (list) => {
    try {
      await dbSaveEmployees(list);
      setEmployees(list);
      setShowAdmin(false);
      showToast("従業員リストを保存しました");
    } catch(e) {
      showToast("保存に失敗しました", "#e57373");
    }
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#e8f5e9",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Noto Sans JP',sans-serif",gap:"16px"}}>
      <div style={{width:"40px",height:"40px",border:"4px solid #c8e6c9",borderTop:"4px solid #4caf50",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />
      <div style={{color:"#4a7a4a",fontSize:"14px"}}>データを読み込み中…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{minHeight:"100vh",background:"#e8f5e9",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Noto Sans JP',sans-serif",padding:"24px",gap:"16px"}}>
      <div style={{fontSize:"32px"}}>⚠️</div>
      <div style={{color:"#c62828",fontSize:"14px",textAlign:"center"}}>{error}</div>
      <button onClick={loadData} style={{padding:"10px 24px",borderRadius:"8px",border:"none",background:"#4caf50",color:"#fff",fontSize:"14px",fontWeight:"700",cursor:"pointer"}}>再試行</button>
    </div>
  );

  if (!records || !employees) return null;

  const today = todayStr();
  const todayDisplay = (() => { const d=new Date(); const days=["日","月","火","水","木","金","土"]; return `${fmt2(d.getMonth()+1)}/${fmt2(d.getDate())} (${days[d.getDay()]})`; })();
  const clockStr = `${fmt2(clock.getHours())}:${fmt2(clock.getMinutes())}:${fmt2(clock.getSeconds())}`;
  const allMonths = [...new Set(Object.keys(records).map(getYM))].sort().reverse();
  if (!allMonths.includes(getYM(today))) allMonths.unshift(getYM(today));
  const historyDates = Object.keys(records).filter(d => getYM(d) === historyYM).sort().reverse();

  return (
    <div style={{minHeight:"100vh",background:"#e8f5e9",fontFamily:"'Noto Sans JP','Hiragino Sans',sans-serif",paddingBottom:"70px"}}>
      {toast && <div style={{position:"fixed",top:"16px",left:"50%",transform:"translateX(-50%)",background:toast.color,color:"#fff",padding:"10px 22px",borderRadius:"30px",fontSize:"13px",fontWeight:"600",zIndex:2000,boxShadow:"0 4px 20px rgba(0,0,0,0.3)",whiteSpace:"nowrap",animation:"fadeIn 0.2s ease"}}>{toast.msg}</div>}
      {camera && <CameraModal name={camera.name} field={camera.field} onCapture={handleCapture} onClose={() => setCamera(null)} />}
      {showAdmin && <AdminPanel employees={employees} onSave={handleSaveEmployees} onClose={() => setShowAdmin(false)} />}

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#4caf50 0%,#388e3c 100%)",padding:"12px 16px",boxShadow:"0 2px 10px rgba(0,0,0,0.15)",position:"relative"}}>
        <div style={{textAlign:"center",color:"rgba(255,255,255,0.85)",fontSize:"13px",letterSpacing:"1px",marginBottom:"2px"}}>{todayDisplay}</div>
        <div style={{textAlign:"center",color:"#fff",fontSize:"36px",fontWeight:"700",letterSpacing:"2px",lineHeight:1.1}}>
          {clockStr.slice(0,5)}<span style={{fontSize:"22px",opacity:.8}}>:{clockStr.slice(6)}</span>
        </div>
        <div style={{textAlign:"center",color:"rgba(255,255,255,0.7)",fontSize:"11px",marginTop:"4px",letterSpacing:"3px"}}>タイムカード</div>
        <button onClick={() => setShowAdmin(true)} style={{position:"absolute",top:"12px",right:"16px",background:"rgba(255,255,255,0.25)",border:"1px solid rgba(255,255,255,0.5)",borderRadius:"10px",color:"#fff",padding:"8px 14px",fontSize:"13px",cursor:"pointer",fontWeight:"700"}}>⚙ 管理</button>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:"#2e7d32"}}>
        {[["stamp","打刻"],["list","今日の一覧"],["history","履歴"]].map(([t,label]) => (
          <button key={t} onClick={() => setTab(t)} style={{flex:1,padding:"11px 0",border:"none",background:tab===t?"#fff":"transparent",color:tab===t?"#2e7d32":"rgba(255,255,255,0.75)",fontSize:"13px",fontWeight:tab===t?"700":"400",cursor:"pointer",transition:"all 0.15s"}}>{label}</button>
        ))}
      </div>

      <div style={{padding:"16px"}}>

        {/* STAMP */}
        {tab === "stamp" && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"10px"}}>
            {employees.map(name => {
              const rec = getRecord(today, name);
              const done = rec.in && rec.out;
              const working = rec.in && !rec.out;
              return (
                <div key={name} style={{background:done?"#c8e6c9":working?"#fff9c4":"#fff",borderRadius:"12px",padding:"14px 12px",boxShadow:"0 1px 6px rgba(0,0,0,0.08)",border:done?"1px solid #a5d6a7":working?"1px solid #fff176":"1px solid #e8f5e9",transition:"all 0.2s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
                    <div style={{width:"38px",height:"38px",borderRadius:"50%",overflow:"hidden",background:done?"#81c784":working?"#fff176":"#c8e6c9",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {rec.inPhoto ? <img src={rec.inPhoto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" /> : <span style={{fontSize:"18px",color:"#4caf50"}}>☺</span>}
                    </div>
                    <div>
                      <div style={{fontSize:"13px",fontWeight:"700",color:"#1b5e20"}}>{name}</div>
                      <div style={{fontSize:"10px",color:done?"#388e3c":working?"#f57f17":"#999"}}>{done?"退勤済":working?"出勤中":"未出勤"}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"6px",marginBottom:"10px"}}>
                    <div style={{flex:1,background:"rgba(76,175,80,0.1)",borderRadius:"6px",padding:"4px 6px",textAlign:"center"}}>
                      <div style={{fontSize:"9px",color:"#888",letterSpacing:"1px"}}>出勤</div>
                      <div style={{fontSize:"13px",fontWeight:"700",color:"#2e7d32",fontFamily:"monospace"}}>{rec.in||"--:--"}</div>
                    </div>
                    <div style={{flex:1,background:"rgba(229,115,115,0.1)",borderRadius:"6px",padding:"4px 6px",textAlign:"center"}}>
                      <div style={{fontSize:"9px",color:"#888",letterSpacing:"1px"}}>退勤</div>
                      <div style={{fontSize:"13px",fontWeight:"700",color:"#c62828",fontFamily:"monospace"}}>{rec.out||"--:--"}</div>
                    </div>
                  </div>
                  {!rec.in && <button onClick={() => setCamera({name,field:"in"})} style={{width:"100%",padding:"9px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#66bb6a,#43a047)",color:"#fff",fontSize:"13px",fontWeight:"700",cursor:"pointer"}}>📷 出勤</button>}
                  {rec.in && !rec.out && <button onClick={() => setCamera({name,field:"out"})} style={{width:"100%",padding:"9px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#ef5350,#c62828)",color:"#fff",fontSize:"13px",fontWeight:"700",cursor:"pointer"}}>📷 退勤</button>}
                  {done && <div style={{textAlign:"center",fontSize:"12px",color:"#388e3c",fontWeight:"600"}}>✓ {calcDur(rec.in,rec.out)}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* LIST */}
        {tab === "list" && (
          <div>
            <div style={{marginBottom:"14px"}}>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                style={{width:"100%",background:"#fff",border:"1px solid #c8e6c9",borderRadius:"8px",padding:"8px 12px",fontSize:"14px",color:"#1b5e20",outline:"none",cursor:"pointer"}} />
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
              {[["出勤済",employees.filter(n=>getRecord(selectedDate,n).in).length,"#388e3c"],["退勤済",employees.filter(n=>getRecord(selectedDate,n).out).length,"#c62828"],["未出勤",employees.filter(n=>!getRecord(selectedDate,n).in).length,"#9e9e9e"]].map(([label,count,color]) => (
                <div key={label} style={{flex:1,background:"#fff",borderRadius:"10px",padding:"10px",textAlign:"center",border:`1px solid ${color}33`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:"22px",fontWeight:"700",color}}>{count}</div>
                  <div style={{fontSize:"10px",color:"#888",letterSpacing:"1px"}}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{background:"#fff",borderRadius:"12px",overflow:"hidden",boxShadow:"0 1px 8px rgba(0,0,0,0.08)"}}>
              {employees.map((name, i) => {
                const rec = getRecord(selectedDate, name);
                return (
                  <div key={name} style={{display:"flex",alignItems:"center",gap:"10px",padding:"11px 14px",borderBottom:i<employees.length-1?"1px solid #f1f8e9":"none",background:i%2===0?"#fff":"#fafff8"}}>
                    <div style={{width:"32px",height:"32px",borderRadius:"50%",overflow:"hidden",flexShrink:0,background:"#c8e6c9",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {rec.inPhoto ? <img src={rec.inPhoto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" /> : <span style={{fontSize:"16px",color:"#4caf50"}}>☺</span>}
                    </div>
                    <div style={{flex:1,fontSize:"13px",fontWeight:"600",color:"#1b5e20"}}>{name}</div>
                    <div style={{fontFamily:"monospace",fontSize:"13px",color:"#388e3c",minWidth:"42px",textAlign:"center"}}>{rec.in||<span style={{color:"#ccc"}}>—</span>}</div>
                    <div style={{color:"#bbb",fontSize:"12px"}}>→</div>
                    <div style={{fontFamily:"monospace",fontSize:"13px",color:"#c62828",minWidth:"42px",textAlign:"center"}}>{rec.out||<span style={{color:"#ccc"}}>—</span>}</div>
                    <div style={{fontSize:"11px",color:"#7cb342",minWidth:"46px",textAlign:"right"}}>{calcDur(rec.in,rec.out)||""}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <div>
            <div style={{display:"flex",gap:"8px",marginBottom:"16px",flexWrap:"wrap"}}>
              {allMonths.map(ym => (
                <button key={ym} onClick={() => setHistoryYM(ym)} style={{padding:"7px 14px",borderRadius:"20px",border:"none",background:historyYM===ym?"#388e3c":"#fff",color:historyYM===ym?"#fff":"#388e3c",fontSize:"13px",fontWeight:"600",cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,0.1)"}}>{monthLabel(ym)}</button>
              ))}
            </div>
            {historyDates.length === 0 ? (
              <div style={{textAlign:"center",color:"#aaa",padding:"40px",fontSize:"14px"}}>この月の記録はありません</div>
            ) : historyDates.map(date => {
              const dateRecs = employees.map(n => ({name:n,...getRecord(date,n)})).filter(r => r.in);
              if (!dateRecs.length) return null;
              const d = new Date(date); const days=["日","月","火","水","木","金","土"];
              return (
                <div key={date} style={{marginBottom:"14px"}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:"#388e3c",marginBottom:"8px",display:"flex",alignItems:"center",gap:"8px"}}>
                    <div style={{background:"#388e3c",color:"#fff",borderRadius:"6px",padding:"2px 10px",fontSize:"12px"}}>{`${fmt2(d.getMonth()+1)}/${fmt2(d.getDate())} (${days[d.getDay()]})`}</div>
                    <div style={{color:"#aaa",fontWeight:"400"}}>{dateRecs.length}名出勤</div>
                  </div>
                  <div style={{background:"#fff",borderRadius:"12px",overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,0.07)"}}>
                    {dateRecs.map((rec, i) => (
                      <div key={rec.name} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 14px",borderBottom:i<dateRecs.length-1?"1px solid #f1f8e9":"none"}}>
                        <div style={{width:"28px",height:"28px",borderRadius:"50%",overflow:"hidden",flexShrink:0,background:"#c8e6c9",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {rec.inPhoto ? <img src={rec.inPhoto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" /> : <span style={{fontSize:"15px",color:"#4caf50"}}>☺</span>}
                        </div>
                        <div style={{flex:1,fontSize:"13px",fontWeight:"600",color:"#1b5e20"}}>{rec.name}</div>
                        <div style={{fontFamily:"monospace",fontSize:"12px",color:"#555"}}>{rec.in} → {rec.out||"?"}</div>
                        <div style={{fontSize:"11px",color:"#7cb342",minWidth:"46px",textAlign:"right"}}>{calcDur(rec.in,rec.out)||""}</div>
                        <button onClick={() => clearRecord(date, rec.name)} style={{background:"none",border:"1px solid #ffcdd2",borderRadius:"6px",color:"#e57373",fontSize:"11px",padding:"3px 7px",cursor:"pointer"}}>削除</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.4)}
        *{box-sizing:border-box}
      `}</style>
    </div>
  );
}
