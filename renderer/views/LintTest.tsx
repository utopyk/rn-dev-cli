import React from 'react';

export function LintTest() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--muted)',
      fontSize: 14,
      padding: 12,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>Lint & Test</div>
        <div>Run [l] to lint or [t] to type-check</div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
          Results will appear here
        </div>
      </div>
    </div>
  );
}
