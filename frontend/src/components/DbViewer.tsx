import React, { useState, useEffect } from 'react';
import { Database, Table, Play, ChevronLeft, ChevronRight, AlertCircle, DatabaseZap } from 'lucide-react';

interface TableInfo {
  name: string;
  rows: number;
}

interface DbExplorerProps {
  projectName: string;
  onTableSelect: (dbPath: string, tableName: string) => void;
  activeTable: string;
  activeDb: string;
  onActiveDbChange: (dbPath: string) => void;
}

export const DbExplorer: React.FC<DbExplorerProps> = ({
  projectName,
  onTableSelect,
  activeTable,
  activeDb,
  onActiveDbChange
}) => {
  const [dbs, setDbs] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch SQLite files in workspace
  const fetchDbs = async () => {
    if (!projectName) return;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/db/list?project=${encodeURIComponent(projectName)}`);
      const data = await res.json();
      setDbs(data.dbs || []);
      if (data.dbs && data.dbs.length > 0 && !activeDb) {
        onActiveDbChange(data.dbs[0]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch tables in selected database
  const fetchTables = async () => {
    if (!projectName || !activeDb) {
      setTables([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/api/db/tables?project=${encodeURIComponent(projectName)}&dbPath=${encodeURIComponent(activeDb)}`
      );
      const data = await res.json();
      setTables(data.tables || []);
    } catch (e) {
      console.error(e);
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDbs();
  }, [projectName]);

  useEffect(() => {
    fetchTables();
  }, [activeDb, projectName]);

  return (
    <div className="db-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <Database size={15} style={{ color: 'var(--color-info)' }} />
        <span className="explorer-title" style={{ flex: 1 }}>Databases</span>
        <button className="icon-btn" title="Refresh DB list" onClick={fetchDbs}>
          <DatabaseZap size={14} />
        </button>
      </div>

      <select
        className="select-control db-list-select"
        value={activeDb}
        onChange={(e) => onActiveDbChange(e.target.value)}
      >
        {dbs.length === 0 ? (
          <option value="">No Databases Found</option>
        ) : (
          dbs.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))
        )}
      </select>

      {activeDb && (
        <div style={{ marginTop: '8px' }}>
          <span className="explorer-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>
            Tables
          </span>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
              Loading tables...
            </div>
          ) : tables.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
              No tables in this DB
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {tables.map((t) => (
                <div
                  key={t.name}
                  className={`db-table-item ${activeTable === t.name ? 'active' : ''}`}
                  onClick={() => onTableSelect(activeDb, t.name)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    <Table size={14} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                  </div>
                  <span className="db-badge">{t.rows}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Database Table Grid & Query Component ---

interface DbGridProps {
  projectName: string;
  activeDb: string;
  activeTable: string;
}

export const DbGrid: React.FC<DbGridProps> = ({ projectName, activeDb, activeTable }) => {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[][]>([]);
  const [sql, setSql] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'table' | 'query'>('table'); // Browse table vs run query
  const [totalCount, setTotalCount] = useState(0);

  const fetchTableRows = async (currentOffset: number) => {
    if (!projectName || !activeDb || !activeTable) return;
    setLoading(true);
    setError('');
    try {
      const url = `http://127.0.0.1:8000/api/db/rows?project=${encodeURIComponent(projectName)}&dbPath=${encodeURIComponent(activeDb)}&table=${encodeURIComponent(activeTable)}&limit=${limit}&offset=${currentOffset}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to fetch rows');
      }
      const data = await res.json();
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setMode('table');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunQuery = async () => {
    if (!projectName || !activeDb || !sql.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/api/db/query?project=${encodeURIComponent(projectName)}&dbPath=${encodeURIComponent(activeDb)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'SQL syntax/execution error');
      }
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setTotalCount(data.count || 0);
      setMode('query');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTable) {
      setOffset(0);
      setSql(`SELECT * FROM "${activeTable}" LIMIT 50;`);
      fetchTableRows(0);
    } else {
      setColumns([]);
      setRows([]);
      setSql('');
      setError('');
    }
  }, [activeTable, activeDb, projectName]);

  const handleNextPage = () => {
    const nextOffset = offset + limit;
    setOffset(nextOffset);
    fetchTableRows(nextOffset);
  };

  const handlePrevPage = () => {
    const prevOffset = Math.max(0, offset - limit);
    setOffset(prevOffset);
    fetchTableRows(prevOffset);
  };

  if (!activeDb) {
    return (
      <div style={{ color: 'var(--text-muted)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Select a SQLite database from the explorer side panel.
      </div>
    );
  }

  return (
    <div className="db-grid-container">
      {/* SQL Console input */}
      <div className="query-editor-area">
        <textarea
          className="query-textarea"
          placeholder="Write custom SQL query here (e.g. SELECT * FROM users WHERE active = 1;)..."
          value={sql}
          onChange={(e) => setSql(e.target.value)}
        />
        <button 
          className="btn btn-primary" 
          onClick={handleRunQuery}
          disabled={loading || !sql.trim()}
          style={{ alignSelf: 'center', padding: '10px 16px', display: 'flex', gap: '8px' }}
        >
          <Play size={14} /> Run
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Grid content */}
      <div className="db-grid-table-wrapper">
        {loading ? (
          <div style={{ color: 'var(--text-muted)', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            Running query...
          </div>
        ) : columns.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            Select a table or write a SELECT query to view database contents.
          </div>
        ) : (
          <table className="db-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                    No rows returned
                  </td>
                </tr>
              ) : (
                rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((val, cIdx) => (
                      <td key={cIdx} title={val !== null ? String(val) : 'NULL'}>
                        {val === null ? (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span>
                        ) : typeof val === 'boolean' ? (
                          val ? 'true' : 'false'
                        ) : (
                          String(val)
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination (Only visible in Table browse mode) */}
      {mode === 'table' && activeTable && (
        <div className="db-grid-pagination">
          <span>
            Showing rows {offset + 1} - {offset + rows.length}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={handlePrevPage} disabled={offset === 0 || loading} style={{ padding: '2px 8px' }}>
              <ChevronLeft size={16} /> Prev
            </button>
            <button className="btn" onClick={handleNextPage} disabled={rows.length < limit || loading} style={{ padding: '2px 8px' }}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {mode === 'query' && !loading && columns.length > 0 && (
        <div className="db-grid-pagination">
          <span>Query executed successfully. Returned {totalCount} rows.</span>
        </div>
      )}
    </div>
  );
};
