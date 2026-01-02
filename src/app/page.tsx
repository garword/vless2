export default function Home() {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            fontFamily: 'sans-serif',
            backgroundColor: '#f0f2f5',
            color: '#333'
        }}>
            <div style={{
                padding: '2rem',
                backgroundColor: 'white',
                borderRadius: '12px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                textAlign: 'center'
            }}>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: '#0070f3' }}>VLESS Bot Manager</h1>
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🤖</div>
                <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Status: <span style={{ color: 'green', fontWeight: 'bold' }}>ACTIVE</span></p>
                <p style={{ color: '#666' }}>Webhooks are listening.</p>
                <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: '#888' }}>Please use the Telegram Bot to interact.</p>
            </div>
        </div>
    );
}
