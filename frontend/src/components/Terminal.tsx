import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
  projectName: string;
  active: boolean;
}

export const Terminal: React.FC<TerminalProps> = ({ projectName, active }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!projectName || !containerRef.current) return;

    // Initialize Xterm
    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#0c0f17',
        foreground: '#e2e8f0',
        cursor: '#a5b4fc',
        black: '#1e293b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#cbd5e1',
      },
      fontFamily: 'Fira Code, Courier New, monospace',
      fontSize: 13,
      lineHeight: 1.2,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const wsUrl = `ws://127.0.0.1:8000/ws/terminal?project=${encodeURIComponent(projectName)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial dimensions
      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows
      }));
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31;1m[WebSocket Connection Error. Could not connect to terminal backend.]\x1b[0m\r\n');
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[33;1m[Terminal Session Disconnected.]\x1b[0m\r\n');
    };

    // Forward terminal input to backend
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Forward terminal resize events
    const resizeDisposable = term.onResize((size) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: size.cols,
          rows: size.rows
        }));
      }
    });

    // Fit handle on window resize
    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch (e) {}
    };

    window.addEventListener('resize', handleResize);

    // Clean up
    return () => {
      window.removeEventListener('resize', handleResize);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
      ws.close();
      terminalRef.current = null;
      wsRef.current = null;
    };
  }, [projectName]);

  // Re-fit xterm when the terminal tab is toggled active
  useEffect(() => {
    if (active && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch (e) {}
      }, 50);
    }
  }, [active]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div 
        ref={containerRef} 
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0,
          background: '#0c0f17'
        }}
      />
    </div>
  );
};
