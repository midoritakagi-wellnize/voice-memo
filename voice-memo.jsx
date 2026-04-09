import { useState, useRef, useEffect, useCallback } from "react";

const CATEGORIES = {
  アイデア: { icon: "💡", color: "#F59E0B", bg: "#FEF3C7" },
  タスク: { icon: "✅", color: "#10B981", bg: "#D1FAE5" },
  メモ: { icon: "📝", color: "#6366F1", bg: "#EEF2FF" },
  感情: { icon: "💭", color: "#EC4899", bg: "#FCE7F3" },
  学び: { icon: "📚", color: "#3B82F6", bg: "#DBEAFE" },
  その他: { icon: "🗂️", color: "#6B7280", bg: "#F3F4F6" },
};

const NOTION_SYSTEM_PROMPT = `あなたは音声メモを分析するアシスタントです。
ユーザーのメモを以下の形式でJSONのみ返してください（説明不要）:
{
  "category": "アイデア" | "タスク" | "メモ" | "感情" | "学び" | "その他",
  "summary": "10〜20文字の要約",
  "tags": ["タグ1", "タグ2"],
  "priority": "高" | "中" | "低"
}`;

export default function VoiceMemoApp() {
  const [memos, setMemos] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [notionToken, setNotionToken] = useState("");
  const [notionDb, setNotionDb] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState("すべて");
  const [pulseSize, setPulseSize] = useState(1);
  const recognitionRef = useRef(null);
  const pulseRef = useRef(null);

  // Pulse animation while recording
  useEffect(() => {
    if (isRecording) {
      let dir = 1;
      pulseRef.current = setInterval(() => {
        setPulseSize(s => {
          const next = s + dir * 0.02;
          if (next > 1.15) dir = -1;
          if (next < 0.95) dir = 1;
          return next;
        });
      }, 30);
    } else {
      clearInterval(pulseRef.current);
      setPulseSize(1);
    }
    return () => clearInterval(pulseRef.current);
  }, [isRecording]);

  const analyzeWithAI = async (text) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: NOTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
    });
    const data = await response.json();
    const raw = data.content?.[0]?.text || "{}";
    try {
      return JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      return { category: "その他", summary: text.slice(0, 15), tags: [], priority: "中" };
    }
  };

  const saveToNotion = async (memo) => {
    if (!notionToken || !notionDb) return false;
    try {
      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: notionDb },
          properties: {
            Name: { title: [{ text: { content: memo.summary } }] },
            Category: { select: { name: memo.category } },
            Priority: { select: { name: memo.priority } },
            Tags: { multi_select: memo.tags.map(t => ({ name: t })) },
            Content: { rich_text: [{ text: { content: memo.text } }] },
          },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const startRecording = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("このブラウザは音声認識に対応していません。Chrome推奨です。");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) setTranscript(t => t + final);
    };
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript("");
  }, []);

  const stopRecording = useCallback(async () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    if (!transcript.trim()) return;
    setIsProcessing(true);
    try {
      const analysis = await analyzeWithAI(transcript);
      const newMemo = {
        id: Date.now(),
        text: transcript,
        ...analysis,
        createdAt: new Date().toLocaleString("ja-JP"),
        saved: false,
      };
      setMemos(prev => [newMemo, ...prev]);
      setTranscript("");
    } finally {
      setIsProcessing(false);
    }
  }, [transcript]);

  const handleSaveToNotion = async (memo) => {
    setSavingId(memo.id);
    const ok = await saveToNotion(memo);
    if (ok) {
      setMemos(prev => prev.map(m => m.id === memo.id ? { ...m, saved: true } : m));
    } else {
      alert("Notion保存に失敗しました。設定を確認してください。");
    }
    setSavingId(null);
  };

  const deleteMemo = (id) => setMemos(prev => prev.filter(m => m.id !== id));

  const filtered = filter === "すべて" ? memos : memos.filter(m => m.category === filter);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f0c29, #1a1a2e, #16213e)",
      fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      color: "#e2e8f0",
      padding: "0",
    }}>
      {/* Header */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "0.05em", color: "#f8fafc" }}>
            🎙️ VoiceMemo
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>AI分類 × Notion連携</div>
        </div>
        <button onClick={() => setShowSettings(!showSettings)} style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "10px",
          color: "#94a3b8",
          padding: "8px 14px",
          fontSize: "13px",
          cursor: "pointer",
        }}>⚙️ 設定</button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{
          background: "rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          padding: "16px 24px",
        }}>
          <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "10px", fontWeight: 600 }}>Notion設定</div>
          <input
            placeholder="Notion Integration Token (secret_...)"
            value={notionToken}
            onChange={e => setNotionToken(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Database ID (32文字のID)"
            value={notionDb}
            onChange={e => setNotionDb(e.target.value)}
            style={{ ...inputStyle, marginTop: "8px" }}
          />
          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "8px" }}>
            💡 Notion Integrationを作成し、データベースと連携してください
          </div>
        </div>
      )}

      {/* Record Button Area */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "36px 24px 28px",
        gap: "20px",
      }}>
        {/* Mic Button */}
        <div style={{ position: "relative", width: "100px", height: "100px" }}>
          {isRecording && (
            <div style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(239,68,68,0.3) 0%, transparent 70%)",
              transform: `scale(${pulseSize * 1.6})`,
              transition: "transform 0.03s",
            }} />
          )}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            style={{
              width: "100px",
              height: "100px",
              borderRadius: "50%",
              border: "none",
              background: isRecording
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "white",
              fontSize: "32px",
              cursor: isProcessing ? "not-allowed" : "pointer",
              transform: `scale(${isRecording ? pulseSize : 1})`,
              transition: "background 0.3s, transform 0.1s",
              boxShadow: isRecording
                ? "0 0 30px rgba(239,68,68,0.5)"
                : "0 0 30px rgba(99,102,241,0.4)",
              opacity: isProcessing ? 0.5 : 1,
            }}
          >
            {isProcessing ? "⏳" : isRecording ? "⏹️" : "🎙️"}
          </button>
        </div>

        <div style={{ textAlign: "center" }}>
          {isProcessing ? (
            <div style={{ color: "#a78bfa", fontSize: "14px", fontWeight: 500 }}>
              AIが分析中...
            </div>
          ) : isRecording ? (
            <div style={{ color: "#f87171", fontSize: "14px", fontWeight: 500 }}>
              録音中 — タップで停止
            </div>
          ) : (
            <div style={{ color: "#64748b", fontSize: "13px" }}>
              タップして録音開始
            </div>
          )}
        </div>

        {/* Live transcript */}
        {(isRecording || transcript) && (
          <div style={{
            width: "100%",
            maxWidth: "480px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "14px",
            padding: "14px 16px",
            fontSize: "14px",
            color: "#cbd5e1",
            minHeight: "56px",
            lineHeight: 1.6,
          }}>
            {transcript || <span style={{ color: "#475569" }}>音声を認識しています...</span>}
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      {memos.length > 0 && (
        <div style={{
          display: "flex",
          gap: "8px",
          padding: "0 20px 16px",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}>
          {["すべて", ...Object.keys(CATEGORIES)].map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              style={{
                whiteSpace: "nowrap",
                padding: "6px 14px",
                borderRadius: "20px",
                border: "1px solid",
                borderColor: filter === cat ? "#6366f1" : "rgba(255,255,255,0.1)",
                background: filter === cat ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.03)",
                color: filter === cat ? "#a5b4fc" : "#64748b",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {cat !== "すべて" && CATEGORIES[cat].icon + " "}{cat}
            </button>
          ))}
        </div>
      )}

      {/* Memo List */}
      <div style={{ padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {filtered.length === 0 && !isProcessing && (
          <div style={{ textAlign: "center", color: "#334155", padding: "48px 0", fontSize: "14px" }}>
            メモがまだありません<br />
            <span style={{ fontSize: "32px", display: "block", marginTop: "12px" }}>🎙️</span>
          </div>
        )}

        {filtered.map(memo => {
          const cat = CATEGORIES[memo.category] || CATEGORIES["その他"];
          return (
            <div key={memo.id} style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "16px",
              padding: "16px",
              position: "relative",
              overflow: "hidden",
            }}>
              {/* Category accent line */}
              <div style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "3px",
                background: cat.color,
                borderRadius: "3px 0 0 3px",
              }} />

              <div style={{ paddingLeft: "8px" }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{
                      background: cat.bg,
                      color: cat.color,
                      borderRadius: "8px",
                      padding: "2px 10px",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}>
                      {cat.icon} {memo.category}
                    </span>
                    <span style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      background: memo.priority === "高" ? "rgba(239,68,68,0.15)" : memo.priority === "中" ? "rgba(245,158,11,0.15)" : "rgba(107,114,128,0.15)",
                      color: memo.priority === "高" ? "#f87171" : memo.priority === "中" ? "#fbbf24" : "#9ca3af",
                    }}>
                      {memo.priority}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteMemo(memo.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#475569",
                      cursor: "pointer",
                      fontSize: "16px",
                      padding: "4px",
                    }}
                  >×</button>
                </div>

                {/* Summary */}
                <div style={{ fontWeight: 600, fontSize: "15px", color: "#f1f5f9", marginBottom: "6px" }}>
                  {memo.summary}
                </div>

                {/* Full text */}
                <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, marginBottom: "10px" }}>
                  {memo.text}
                </div>

                {/* Tags */}
                {memo.tags?.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}>
                    {memo.tags.map(tag => (
                      <span key={tag} style={{
                        fontSize: "11px",
                        color: "#6366f1",
                        background: "rgba(99,102,241,0.1)",
                        borderRadius: "6px",
                        padding: "2px 8px",
                        border: "1px solid rgba(99,102,241,0.2)",
                      }}>#{tag}</span>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "11px", color: "#334155" }}>{memo.createdAt}</div>
                  {notionToken && notionDb ? (
                    <button
                      onClick={() => handleSaveToNotion(memo)}
                      disabled={memo.saved || savingId === memo.id}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "8px",
                        border: "1px solid",
                        borderColor: memo.saved ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.1)",
                        background: memo.saved ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.04)",
                        color: memo.saved ? "#34d399" : "#94a3b8",
                        fontSize: "12px",
                        cursor: memo.saved ? "default" : "pointer",
                      }}
                    >
                      {savingId === memo.id ? "保存中..." : memo.saved ? "✓ Notion保存済" : "Notionに保存"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowSettings(true)}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        color: "#475569",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      設定でNotion連携
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  padding: "10px 14px",
  color: "#e2e8f0",
  fontSize: "13px",
  outline: "none",
  boxSizing: "border-box",
};
