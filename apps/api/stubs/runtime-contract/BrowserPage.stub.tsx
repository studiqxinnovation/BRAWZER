import React from "react";

export interface BrowserPageProps {
  sessionId: string;
  userId: string;
  onClose: () => void;
  onNavigate?: (url: string) => void;
  onDownload?: (filename: string, tempUrl: string) => void;
}

export const BrowserPage: React.FC<BrowserPageProps> = ({ sessionId, onClose, onNavigate, onDownload }) => (
  <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#0f0f0f", color:"#ccc", fontFamily:"monospace", alignItems:"center", justifyContent:"center", gap:12 }}>
    <p style={{ fontSize:14, opacity:0.6 }}>🚧 Cloud browser not yet available — stub active</p>
    <p style={{ fontSize:12, opacity:0.4 }}>Session: {sessionId}</p>
    <div style={{ display:"flex", gap:8, marginTop:16 }}>
      <button onClick={() => onNavigate?.("https://example.com")} style={{ padding:"6px 12px", background:"#1e1e1e", color:"#ccc", border:"1px solid #333", borderRadius:4, cursor:"pointer", fontSize:12 }}>Simulate navigate</button>
      <button onClick={() => onDownload?.("report.pdf", `https://stub-storage.local/dl/${sessionId}/report.pdf`)} style={{ padding:"6px 12px", background:"#1e1e1e", color:"#ccc", border:"1px solid #333", borderRadius:4, cursor:"pointer", fontSize:12 }}>Simulate download</button>
      <button onClick={onClose} style={{ padding:"6px 12px", background:"#7f1d1d", color:"#ccc", border:"1px solid #333", borderRadius:4, cursor:"pointer", fontSize:12 }}>Close session</button>
    </div>
  </div>
);
