import React, { useState, useEffect, useRef } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import { 
  FolderTree, Database, Terminal as TermIcon, Play, RefreshCw, 
  Plus, GitBranch, Save, X, Layout, AlertTriangle 
} from 'lucide-react';

// Import our components
import { FileExplorer, type FileNode } from './components/FileExplorer';
import { Terminal } from './components/Terminal';
import { Runner } from './components/Runner';
import { DbExplorer, DbGrid } from './components/DbViewer';

const TEMPLATE_COMMANDS: Record<string, string> = {
  django: "python manage.py runserver 0.0.0.0:8000",
  flask: "python -m flask run --host=0.0.0.0 --port=8000",
  fastapi: "python -m uvicorn main:app --host=0.0.0.0 --port=8000",
  general: "python main.py"
};

export default function App() {
  // Projects
  const [projects, setProjects] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState('');
  
  // File Tree & Tabs
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [unsavedTabs, setUnsavedTabs] = useState<Set<string>>(new Set());

  // Layout & Navigation State
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'db'>('explorer');
  const [consoleTab, setConsoleTab] = useState<'terminal' | 'logs' | 'dbgrid'>('terminal');
  
  // SQLite Database State
  const [activeDb, setActiveDb] = useState('');
  const [activeDbTable, setActiveDbTable] = useState('');

  // Live Runner Preview State
  const [runnerStatus, setRunnerStatus] = useState('stopped');
  const [runnerPort, setRunnerPort] = useState<number | null>(null);
  const [previewKey, setPreviewKey] = useState(0); // Force reload iframe

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectTemplate, setNewProjectTemplate] = useState('fastapi');
  
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneProjectName, setCloneProjectName] = useState('');
  const [cloneRepoUrl, setCloneRepoUrl] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // Panel resizing dimensions
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [consoleHeight, setConsoleHeight] = useState(280);
  const [previewWidth, setPreviewWidth] = useState(450);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingConsole, setIsResizingConsole] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  const monacoRef = useRef<any>(null);
  
  // Track activeTab in ref to prevent stale closures in editor shortcut handler
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Fetch list of projects
  const fetchProjects = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
      if (data.projects && data.projects.length > 0 && !activeProject) {
        setActiveProject(data.projects[0]);
      }
    } catch (e) {
      console.error("Failed to load projects list", e);
    }
  };

  // Fetch file tree for current active project
  const fetchFileTree = async () => {
    if (!activeProject) {
      setFileTree([]);
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/files/tree?project=${encodeURIComponent(activeProject)}`);
      const data = await res.json();
      setFileTree(data || []);
    } catch (e) {
      console.error("Failed to load file tree", e);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchFileTree();
    // Clear project-specific states
    setOpenTabs([]);
    setActiveTab('');
    setTabContents({});
    setUnsavedTabs(new Set());
    setActiveDb('');
    setActiveDbTable('');
  }, [activeProject]);

  // Handle file select/open
  const handleFileSelect = async (path: string) => {
    if (openTabs.includes(path)) {
      setActiveTab(path);
      return;
    }

    try {
      const res = await fetch(`http://127.0.0.1:8000/api/files/read?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error("Could not read file");
      const data = await res.json();
      
      setTabContents(prev => ({ ...prev, [path]: data.content }));
      setOpenTabs(prev => [...prev, path]);
      setActiveTab(path);
    } catch (e) {
      alert(`Error opening file: ${path}`);
    }
  };

  // Close tab logic
  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (unsavedTabs.has(path)) {
      if (!confirm(`File "${path}" has unsaved changes. Close anyway?`)) {
        return;
      }
    }
    
    const updatedTabs = openTabs.filter(t => t !== path);
    setOpenTabs(updatedTabs);
    
    // Remove content cache
    const updatedContents = { ...tabContents };
    delete updatedContents[path];
    setTabContents(updatedContents);

    // Remove unsaved status
    const updatedUnsaved = new Set(unsavedTabs);
    updatedUnsaved.delete(path);
    setUnsavedTabs(updatedUnsaved);

    // Pick active tab
    if (activeTab === path) {
      if (updatedTabs.length > 0) {
        setActiveTab(updatedTabs[updatedTabs.length - 1]);
      } else {
        setActiveTab('');
      }
    }
  };

  // File save logic
  const handleSaveFile = async (path: string) => {
    if (!path) return;
    const content = tabContents[path] || '';
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/files/write?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (res.ok) {
        setUnsavedTabs(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      } else {
        alert("Failed to save file.");
      }
    } catch (e) {
      alert("Error saving file: " + e);
    }
  };

  // File create item (file/folder) logic
  const handleCreateItem = async (parentPath: string, name: string, isFolder: boolean) => {
    const itemPath = parentPath ? `${parentPath}/${name}` : name;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/files/create?project=${encodeURIComponent(activeProject)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath, isFolder })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Item already exists');
      }
      fetchFileTree();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // File delete item logic
  const handleDeleteItem = async (path: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/files/delete?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(path)}`, {
        method: 'POST'
      });
      if (res.ok) {
        // If file open, close it
        if (openTabs.includes(path)) {
          setOpenTabs(prev => prev.filter(t => t !== path));
          if (activeTab === path) setActiveTab('');
        }
        fetchFileTree();
      } else {
        alert("Failed to delete item.");
      }
    } catch (e) {
      alert("Error deleting item: " + e);
    }
  };

  // File rename item logic
  const handleRenameItem = async (oldPath: string, newPath: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/files/rename?project=${encodeURIComponent(activeProject)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Rename failed');
      }
      
      // Update tabs if open
      if (openTabs.includes(oldPath)) {
        setOpenTabs(prev => prev.map(t => t === oldPath ? newPath : t));
        setTabContents(prev => {
          const next = { ...prev };
          next[newPath] = next[oldPath];
          delete next[oldPath];
          return next;
        });
        if (activeTab === oldPath) setActiveTab(newPath);
      }
      fetchFileTree();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Create Project submission
  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setModalLoading(true);
    setModalError('');
    try {
      const res = await fetch('http://127.0.0.1:8000/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim(), template: newProjectTemplate })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create project");
      
      await fetchProjects();
      setActiveProject(newProjectName.trim());
      setShowCreateModal(false);
      setNewProjectName('');
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setModalLoading(false);
    }
  };

  // Clone Project submission
  const handleCloneProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneProjectName.trim() || !cloneRepoUrl.trim()) return;
    setModalLoading(true);
    setModalError('');
    try {
      const res = await fetch('http://127.0.0.1:8000/api/projects/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cloneProjectName.trim(), repoUrl: cloneRepoUrl.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to clone repository");
      
      await fetchProjects();
      setActiveProject(cloneProjectName.trim());
      setShowCloneModal(false);
      setCloneProjectName('');
      setCloneRepoUrl('');
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setModalLoading(false);
    }
  };

  // Editor configuration
  const handleEditorMount = (editor: any, monaco: Monaco) => {
    monacoRef.current = editor;
    // Add custom keyboard shortcut Ctrl+S / Cmd+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentTab = activeTabRef.current;
      if (currentTab) {
        handleSaveFile(currentTab);
      }
    });
  };

  // Handle Monaco code modifications
  const handleCodeChange = (value: string | undefined) => {
    if (activeTab && value !== undefined) {
      setTabContents(prev => ({ ...prev, [activeTab]: value }));
      setUnsavedTabs(prev => {
        const next = new Set(prev);
        next.add(activeTab);
        return next;
      });
    }
  };

  // Save via save button click
  const handleSaveBtnClick = () => {
    if (activeTab) {
      handleSaveFile(activeTab);
    }
  };

  // Determine language for syntax highlighting based on file extension
  const getFileLanguage = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'py': return 'python';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'js': return 'javascript';
      case 'ts': return 'typescript';
      case 'tsx': return 'typescript';
      case 'jsx': return 'javascript';
      case 'json': return 'json';
      case 'md': return 'markdown';
      case 'sql': return 'sql';
      case 'sh': return 'shell';
      default: return 'text';
    }
  };

  // Determine default start command based on project files
  const getDefaultCommand = () => {
    // Check if manage.py exists -> django
    const hasFile = (name: string, list: FileNode[]): boolean => {
      return list.some(n => n.name === name || (n.isFolder && n.children && hasFile(name, n.children)));
    };
    
    if (hasFile('manage.py', fileTree)) {
      return TEMPLATE_COMMANDS.django;
    } else if (hasFile('app.py', fileTree)) {
      return TEMPLATE_COMMANDS.flask;
    } else if (hasFile('main.py', fileTree)) {
      return TEMPLATE_COMMANDS.fastapi;
    }
    return TEMPLATE_COMMANDS.general;
  };

  // SQLite DB row view selected
  const handleDbTableSelect = (dbPath: string, tableName: string) => {
    setActiveDb(dbPath);
    setActiveDbTable(tableName);
    setConsoleTab('dbgrid'); // Select bottom db log tab
  };

  // Resizer dragging handlers
  const handleMouseDownSidebar = () => setIsResizingSidebar(true);
  const handleMouseDownConsole = () => setIsResizingConsole(true);
  const handleMouseDownPreview = () => setIsResizingPreview(true);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        setSidebarWidth(Math.max(180, Math.min(e.clientX, 450)));
      } else if (isResizingConsole) {
        setConsoleHeight(Math.max(120, Math.min(window.innerHeight - e.clientY, window.innerHeight - 150)));
      } else if (isResizingPreview) {
        setPreviewWidth(Math.max(200, Math.min(window.innerWidth - e.clientX, window.innerWidth - 300)));
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingConsole(false);
      setIsResizingPreview(false);
    };

    if (isResizingSidebar || isResizingConsole || isResizingPreview) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingConsole, isResizingPreview]);

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <header className="top-nav">
        <div className="brand">
          <div className="brand-logo">Yuvro Web IDE</div>
          <span className="brand-badge">v1.0.0</span>
        </div>

        <div className="project-controls">
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Project:</span>
          <select 
            className="select-control"
            value={activeProject}
            onChange={(e) => setActiveProject(e.target.value)}
          >
            {projects.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <button className="btn" title="Create New Project" onClick={() => setShowCreateModal(true)}>
            <Plus size={15} /> Create Project
          </button>
          
          <button className="btn" title="Clone from Git Repository" onClick={() => setShowCloneModal(true)}>
            <GitBranch size={15} /> Git Clone
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className="btn" 
            title="Save Active File" 
            disabled={!activeTab}
            onClick={handleSaveBtnClick}
          >
            <Save size={15} />
            {activeTab && unsavedTabs.has(activeTab) && <span style={{ color: 'var(--color-warning)', fontWeight: 'bold' }}>*</span>}
            Save
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="workspace-container">
        {/* Sidebar Left */}
        <section className="sidebar" style={{ width: `${sidebarWidth}px` }}>
          <nav className="sidebar-tabs">
            <button 
              className={`sidebar-tab ${sidebarTab === 'explorer' ? 'active' : ''}`}
              onClick={() => setSidebarTab('explorer')}
            >
              <FolderTree size={16} /> Explorer
            </button>
            <button 
              className={`sidebar-tab ${sidebarTab === 'db' ? 'active' : ''}`}
              onClick={() => setSidebarTab('db')}
            >
              <Database size={16} /> Database
            </button>
          </nav>

          <div className="sidebar-content">
            {sidebarTab === 'explorer' ? (
              <FileExplorer
                tree={fileTree}
                selectedPath={activeTab}
                onFileSelect={handleFileSelect}
                onCreateItem={handleCreateItem}
                onDeleteItem={handleDeleteItem}
                onRenameItem={handleRenameItem}
              />
            ) : (
              <DbExplorer
                projectName={activeProject}
                activeDb={activeDb}
                activeTable={activeDbTable}
                onActiveDbChange={(db) => {
                  setActiveDb(db);
                  setActiveDbTable('');
                }}
                onTableSelect={handleDbTableSelect}
              />
            )}
          </div>
        </section>

        {/* Horizontal Resizer (Sidebar - Code Panel) */}
        <div 
          className={`resizer-h ${isResizingSidebar ? 'resizing' : ''}`}
          onMouseDown={handleMouseDownSidebar}
        />

        {/* Center Panel (Code + Console) */}
        <section className="center-panel">
          {/* Tab bar */}
          <div className="tab-bar">
            {openTabs.map(tab => (
              <div 
                key={tab}
                className={`editor-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                <span>{tab.split('/').pop()}</span>
                {unsavedTabs.has(tab) && (
                  <span style={{ width: '6px', height: '6px', backgroundColor: 'var(--color-warning)', borderRadius: '50%' }} />
                )}
                <span className="tab-close" onClick={(e) => handleCloseTab(tab, e)}>
                  <X size={12} />
                </span>
              </div>
            ))}
          </div>

          {/* Monaco Editor Container */}
          <div className="editor-container">
            {activeTab ? (
              <Editor
                height="100%"
                theme="vs-dark"
                language={getFileLanguage(activeTab)}
                value={tabContents[activeTab] || ''}
                onChange={handleCodeChange}
                onMount={handleEditorMount}
                options={{
                  fontFamily: 'Fira Code, monospace',
                  fontSize: 13,
                  minimap: { enabled: false },
                  automaticLayout: true,
                  tabSize: 4,
                  scrollBeyondLastLine: false,
                }}
              />
            ) : (
              <div style={{ color: 'var(--text-secondary)', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
                <FolderTree size={40} style={{ opacity: 0.3 }} />
                <span>Select a file from the explorer sidebar to open it.</span>
              </div>
            )}
          </div>

          {/* Vertical Resizer (Code - Console) */}
          <div 
            className={`resizer-v ${isResizingConsole ? 'resizing' : ''}`}
            onMouseDown={handleMouseDownConsole}
          />

          {/* Bottom Console Panel */}
          <div className="console-panel" style={{ height: `${consoleHeight}px` }}>
            <div className="console-tabs">
              <div className="console-tab-list">
                <button 
                  className={`console-tab ${consoleTab === 'terminal' ? 'active' : ''}`}
                  onClick={() => setConsoleTab('terminal')}
                >
                  <TermIcon size={14} /> Interactive Terminal
                </button>
                <button 
                  className={`console-tab ${consoleTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setConsoleTab('logs')}
                >
                  <Play size={14} /> Server Logs
                </button>
                <button 
                  className={`console-tab ${consoleTab === 'dbgrid' ? 'active' : ''}`}
                  onClick={() => setConsoleTab('dbgrid')}
                >
                  <Database size={14} /> SQLite Query Grid
                </button>
              </div>
            </div>

            <div className="console-content">
              {consoleTab === 'terminal' && activeProject && (
                <Terminal projectName={activeProject} active={consoleTab === 'terminal'} />
              )}
              {consoleTab === 'logs' && activeProject && (
                <Runner
                  projectName={activeProject}
                  defaultCommand={getDefaultCommand()}
                  onStatusChange={(status, port) => {
                    setRunnerStatus(status);
                    setRunnerPort(port);
                  }}
                />
              )}
              {consoleTab === 'dbgrid' && (
                <DbGrid
                  projectName={activeProject}
                  activeDb={activeDb}
                  activeTable={activeDbTable}
                />
              )}
            </div>
          </div>
        </section>

        {/* Horizontal Resizer (Code Panel - Live Preview) */}
        <div 
          className={`resizer-h ${isResizingPreview ? 'resizing' : ''}`}
          onMouseDown={handleMouseDownPreview}
        />

        {/* Live Preview Sidebar Right */}
        <section className="preview-panel" style={{ width: `${previewWidth}px` }}>
          <div className="preview-bar">
            <Layout size={14} style={{ color: 'var(--text-secondary)' }} />
            <div className="preview-url-bar">
              {runnerStatus === 'running' && runnerPort 
                ? `http://localhost:${runnerPort}/` 
                : 'Preview Server Offline'}
            </div>
            <button 
              className="icon-btn" 
              title="Reload preview" 
              disabled={runnerStatus !== 'running'}
              onClick={() => setPreviewKey(k => k + 1)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          
          {runnerStatus === 'running' && runnerPort ? (
            <iframe
              key={`${runnerPort}-${previewKey}`}
              className="preview-iframe"
              src={`http://localhost:${runnerPort}/`}
              title="Application Live Preview"
            />
          ) : (
            <div className="preview-placeholder">
              <AlertTriangle size={36} style={{ color: 'var(--color-warning)', marginBottom: '16px' }} />
              <h3>Server Preview Offline</h3>
              <p>Go to "Server Logs" tab below and start the server to inspect preview.</p>
            </div>
          )}
        </section>
      </main>

      {/* MODAL: Create Project */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <header className="modal-header">Create New Python Project</header>
            <form onSubmit={handleCreateProjectSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Project Name</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. todo-fastapi-app"
                    className="form-input"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Project Boilerplate Template</label>
                  <select
                    className="select-control"
                    value={newProjectTemplate}
                    onChange={(e) => setNewProjectTemplate(e.target.value)}
                  >
                    <option value="fastapi">FastAPI (async API + template)</option>
                    <option value="flask">Flask (app.py router)</option>
                    <option value="django">Django (settings + admin view)</option>
                  </select>
                </div>
                {modalError && (
                  <div style={{ color: 'var(--color-danger)', fontSize: '13px' }}>{modalError}</div>
                )}
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn" onClick={() => setShowCreateModal(false)} disabled={modalLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={modalLoading || !newProjectName.trim()}>
                  {modalLoading ? "Creating..." : "Create Project"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Git Clone */}
      {showCloneModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <header className="modal-header">Clone GitHub Repository</header>
            <form onSubmit={handleCloneProjectSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Project Target Folder Name</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. django-blog"
                    className="form-input"
                    value={cloneProjectName}
                    onChange={(e) => setCloneProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">GitHub Repository HTTPS URL</label>
                  <input
                    required
                    type="url"
                    placeholder="https://github.com/username/repository.git"
                    className="form-input"
                    value={cloneRepoUrl}
                    onChange={(e) => setCloneRepoUrl(e.target.value)}
                  />
                </div>
                {modalError && (
                  <div style={{ color: 'var(--color-danger)', fontSize: '13px' }}>{modalError}</div>
                )}
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn" onClick={() => setShowCloneModal(false)} disabled={modalLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={modalLoading || !cloneProjectName.trim() || !cloneRepoUrl.trim()}>
                  {modalLoading ? "Cloning..." : "Clone Project"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
