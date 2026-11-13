import React from 'react';
import ReactDOM from 'react-dom/client';

const root = document.getElementById('root');

if (!root) {
  document.body.innerHTML = '<div style="padding:24px;color:red">Root not found</div>';
  throw new Error('Root not found');
}

// 1. 立即顯示基本載入畫面，避免白屏
root.innerHTML = `
  <div style="padding:24px;background:#111;color:#fff;min-height:100vh;font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;">
    <h2 style="margin:0;font-weight:900;letter-spacing:-0.05em;text-transform:uppercase;">交易紀錄 App 載入中...</h2>
    <p style="color:#555;font-size:12px;margin-top:8px;">正在啟動核心引擎與本地資料模式</p>
  </div>
`;

// 2. 錯誤邊界組件 (防止 App 內部任何模組或渲染錯誤導致白屏)
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SafeErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SAFE_BOOT] 攔截到組件運行期錯誤，防止白屏發生:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <EmergencyApp error={this.state.error} onRetry={() => this.setState({ hasError: false, error: null })} />;
    }
    return this.props.children;
  }
}

// 3. 緊急模式組件 (當主 App 載入或運行出錯時顯示)
function EmergencyApp({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  const [trades, setTrades] = React.useState<any[]>(() => {
    try {
      const raw = localStorage.getItem('trades');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const addTrade = () => {
    const trade = {
      id: crypto.randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      pair: 'BTCUSDT',
      side: 'long',
      pnl: 0,
      note: '緊急模式自動生成'
    };

    const next = [trade, ...trades];
    setTrades(next);
    localStorage.setItem('trades', JSON.stringify(next));
  };

  const deleteTrade = (id: string) => {
    const next = trades.filter(t => t.id !== id);
    setTrades(next);
    localStorage.setItem('trades', JSON.stringify(next));
  };

  return (
    <div style={{ padding: 24, background: '#111', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #222', paddingBottom: 16, marginBottom: 20 }}>
          <h1 style={{ fontWeight: 900, letterSpacing: '-0.05em', margin: 0, fontSize: '22px' }}>
            交易紀錄 App - <span style={{ color: '#ef4444' }}>緊急安全模式</span>
          </h1>
          <span style={{ fontSize: '12px', background: '#331111', color: '#f87171', padding: '4px 10px', borderRadius: '6px', border: '1px solid #7f1d1d' }}>
            防白屏保護中
          </span>
        </div>

        <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, marginBottom: '16px' }}>
          系統偵測到模組載入或運行異常。為確保資料不遺失，已為您自動啟用「禁止白屏硬修保護模式」。您可以直接在此安全檢視或手動輸入交易資料。
        </p>

        {error && (
          <div style={{ background: '#1c1917', border: '1px solid #442222', borderRadius: '8px', padding: '12px', marginBottom: '20px', fontSize: '12px', color: '#fca5a5', fontFamily: 'monospace', overflowX: 'auto' }}>
            <strong>錯誤原因：</strong> {error.message || String(error)}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginBottom: 24 }}>
          <button 
            onClick={addTrade} 
            style={{ 
              padding: '10px 20px', 
              background: '#fff', 
              color: '#000', 
              border: 'none', 
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            + 新增本地紀錄
          </button>

          {onRetry ? (
            <button 
              onClick={onRetry} 
              style={{ 
                padding: '10px 20px', 
                background: '#22c55e', 
                color: '#000', 
                border: 'none', 
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              嘗試恢復完整版
            </button>
          ) : (
            <button 
              onClick={() => window.location.reload()} 
              style={{ 
                padding: '10px 20px', 
                background: '#22c55e', 
                color: '#000', 
                border: 'none', 
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              重新整理頁面
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          {trades.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', border: '1px dashed #333', borderRadius: '12px', color: '#666' }}>
              目前沒有本地暫存紀錄，點擊上方按鈕即可安全記帳
            </div>
          ) : (
            trades.map(trade => (
              <div key={trade.id} style={{ padding: 16, border: '1px solid #2a2a2a', borderRadius: 12, background: '#181818', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{trade.date} · {trade.pair}</div>
                  <div style={{ fontSize: '12px', color: trade.side === 'long' ? '#22c55e' : '#ef4444', textTransform: 'uppercase', marginTop: 4 }}>{trade.side}</div>
                  {trade.note && <div style={{ fontSize: '12px', color: '#777', marginTop: 2 }}>{trade.note}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>${trade.pnl}</div>
                  <button 
                    onClick={() => deleteTrade(trade.id)}
                    style={{ background: 'transparent', border: '1px solid #444', color: '#999', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div style={{ marginTop: '40px', paddingTop: '20px', borderTop: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#555' }}>Trading Journey 安全模式 v2.0</span>
          <button 
            onClick={() => window.location.reload()}
            style={{ background: '#262626', color: '#ddd', border: '1px solid #333', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}
          >
            強制重新啟動
          </button>
        </div>
      </div>
    </div>
  );
}

// 4. 核心啟動邏輯
async function boot() {
  try {
    // 首先載入 CSS
    await import('./index.css');

    // 動態載入 App 組件
    const mod = await import('./App');
    const App = mod.default;
    
    // 清空載入畫面並掛載 React (包含 SafeErrorBoundary)
    const reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(
      <React.StrictMode>
        <SafeErrorBoundary>
          <App />
        </SafeErrorBoundary>
      </React.StrictMode>
    );
    
    console.log('[SAFE_BOOT] 完整版應用程式已成功掛載');
  } catch (error: any) {
    console.error('[SAFE_BOOT_FAILED] 載入失敗，啟動緊急模式:', error);
    
    // 如果動態載入失敗，掛載緊急模式
    const reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(<EmergencyApp error={error} />);
  }
}

boot();
