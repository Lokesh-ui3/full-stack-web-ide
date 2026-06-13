import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, RotateCcw, AlertTriangle } from 'lucide-react';

interface RunnerProps {
  projectName: string;
  defaultCommand: string;
  onStatusChange: (status: string, port: number | null) => void;
}

export const Runner: React.FC<RunnerProps> = ({ projectName, defaultCommand, onStatusChange }) => {
  const [command, setCommand] = useState(defaultCommand);
  const [port, setPort] = useState(8080);
  const [status, setStatus] = useState('stopped'); // stopped, starting, running, failed
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Sync default command when project changes
  useEffect(() => {
    setCommand(defaultCommand);
    setLogs([]);
  }, [defaultCommand, projectName]);

  useEffect(() => {
    if (!projectName) return;

    const wsUrl = `ws://127.0.0.1:8000/ws/runner/${encodeURIComponent(projectName)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        setStatus(msg.status);
        onStatusChange(msg.status, msg.port);
        if (msg.command) setCommand(msg.command);
        if (msg.port) setPort(msg.port);
      } else if (msg.type === 'log') {
        setLogs(prev => [...prev, msg.data]);
      }
    };

    ws.onclose = () => {
      setStatus('stopped');
      onStatusChange('stopped', null);
    };

    return () => {
      ws.close();
    };
  }, [projectName]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleStart = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'start',
        command,
        port
      }));
    }
  };

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'stop'
      }));
    }
  };

  const handleRestart = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'restart'
      }));
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'var(--color-success)';
      case 'starting': return 'var(--color-warning)';
      case 'failed': return 'var(--color-danger)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Control panel */}
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '8px 12px', 
          backgroundColor: 'var(--bg-secondary)', 
          borderBottom: '1px solid var(--border-color)',
          gap: '12px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>CMD:</span>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1, height: '30px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={status === 'running' || status === 'starting'}
          />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>PORT:</span>
          <input
            type="number"
            className="form-input"
            style={{ width: '80px', height: '30px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            value={port}
            onChange={(e) => {
              const newPort = parseInt(e.target.value) || 8080;
              setPort(newPort);
              setCommand(prev => {
                let updated = prev.replace(/:(\d+)/, `:${newPort}`);
                updated = updated.replace(/--port=(\d+)/, `--port=${newPort}`);
                updated = updated.replace(/--port\s+(\d+)/, `--port ${newPort}`);
                return updated;
              });
            }}
            disabled={status === 'running' || status === 'starting'}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}>
            <span 
              style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                backgroundColor: getStatusColor(),
                display: 'inline-block'
              }} 
            />
            <span style={{ fontSize: '12px', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
              {status}
            </span>
          </div>

          {status === 'stopped' || status === 'failed' ? (
            <button className="btn btn-success" onClick={handleStart} style={{ padding: '4px 10px', height: '30px' }}>
              <Play size={14} /> Start
            </button>
          ) : (
            <>
              <button className="btn btn-danger" onClick={handleStop} style={{ padding: '4px 10px', height: '30px' }}>
                <Square size={14} /> Stop
              </button>
              <button className="btn" onClick={handleRestart} style={{ padding: '4px 10px', height: '30px' }}>
                <RotateCcw size={14} /> Restart
              </button>
            </>
          )}
        </div>
      </div>

      {/* Logs Console screen */}
      <div ref={logContainerRef} className="logs-console">
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', height: '100%', justifyContent: 'center' }}>
            <AlertTriangle size={16} /> Console idle. Start server to stream output.
          </div>
        ) : (
          logs.map((log, index) => {
            const isStderr = log.startsWith('[STDERR] ');
            const isSystem = log.startsWith('[IDE SYSTEM]');
            const cleanLog = isStderr ? log.substring(9) : log;
            
            return (
              <div 
                key={index} 
                className={`log-line ${isStderr ? 'log-stderr' : ''} ${isSystem ? 'log-system' : ''}`}
              >
                {cleanLog}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
