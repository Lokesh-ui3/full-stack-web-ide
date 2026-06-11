import React, { useState } from 'react';
import { Folder, FolderOpen, File, Plus, FolderPlus, Edit3, Trash2, ChevronRight, ChevronDown } from 'lucide-react';

export interface FileNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileNode[];
}

interface FileExplorerProps {
  tree: FileNode[];
  selectedPath: string;
  onFileSelect: (path: string) => void;
  onCreateItem: (parentPath: string, name: string, isFolder: boolean) => void;
  onDeleteItem: (path: string) => void;
  onRenameItem: (path: string, newName: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  tree,
  selectedPath,
  onFileSelect,
  onCreateItem,
  onDeleteItem,
  onRenameItem
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [inputState, setInputState] = useState<{
    parentPath: string;
    isFolder: boolean;
    active: boolean;
  }>({ parentPath: '', isFolder: false, active: false });
  const [inputValue, setInputValue] = useState('');
  
  const [renameState, setRenameState] = useState<{
    path: string;
    active: boolean;
  }>({ path: '', active: false });
  const [renameValue, setRenameValue] = useState('');

  const toggleExpand = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onCreateItem(inputState.parentPath, inputValue.trim(), inputState.isFolder);
      setInputState({ parentPath: '', isFolder: false, active: false });
      setInputValue('');
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim() && renameState.path) {
      onRenameItem(renameState.path, renameValue.trim());
      setRenameState({ path: '', active: false });
      setRenameValue('');
    }
  };

  const renderTree = (nodes: FileNode[]) => {
    return nodes.map(node => {
      const isExpanded = expanded[node.path];
      const isSelected = selectedPath === node.path;
      
      return (
        <div key={node.path} style={{ paddingLeft: '8px' }}>
          {renameState.active && renameState.path === node.path ? (
            <form onSubmit={handleRenameSubmit} className="tree-node" style={{ padding: '2px 8px' }}>
              <Edit3 size={14} className="text-primary" />
              <input
                autoFocus
                type="text"
                className="form-input"
                style={{ height: '22px', padding: '2px 6px', fontSize: '12px', flex: 1 }}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => setRenameState({ path: '', active: false })}
              />
            </form>
          ) : (
            <div 
              className={`tree-node ${isSelected ? 'selected' : ''}`}
              onClick={() => {
                if (node.isFolder) {
                  toggleExpand(node.path);
                } else {
                  onFileSelect(node.path);
                }
              }}
            >
              {node.isFolder ? (
                <>
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isExpanded ? <FolderOpen size={16} style={{ color: '#f59e0b' }} /> : <Folder size={16} style={{ color: '#f59e0b' }} />}
                </>
              ) : (
                <>
                  <span style={{ width: '14px' }}></span>
                  <File size={16} style={{ color: '#6366f1' }} />
                </>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {node.name}
              </span>
              
              <div className="tree-node-actions" onClick={e => e.stopPropagation()}>
                {node.isFolder && (
                  <>
                    <button 
                      className="icon-btn" 
                      title="New File"
                      onClick={() => setInputState({ parentPath: node.path, isFolder: false, active: true })}
                    >
                      <Plus size={13} />
                    </button>
                    <button 
                      className="icon-btn" 
                      title="New Folder"
                      onClick={() => setInputState({ parentPath: node.path, isFolder: true, active: true })}
                    >
                      <FolderPlus size={13} />
                    </button>
                  </>
                )}
                <button 
                  className="icon-btn" 
                  title="Rename"
                  onClick={() => {
                    setRenameState({ path: node.path, active: true });
                    setRenameValue(node.name);
                  }}
                >
                  <Edit3 size={13} />
                </button>
                <button 
                  className="icon-btn" 
                  title="Delete"
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete ${node.name}?`)) {
                      onDeleteItem(node.path);
                    }
                  }}
                >
                  <Trash2 size={13} style={{ color: '#f87171' }} />
                </button>
              </div>
            </div>
          )}
          
          {/* Create Sub-item Box */}
          {inputState.active && inputState.parentPath === node.path && (
            <form 
              onSubmit={handleCreateSubmit} 
              className="tree-node"
              style={{ paddingLeft: '24px' }}
            >
              {inputState.isFolder ? <Folder size={14} style={{ color: '#f59e0b' }} /> : <File size={14} style={{ color: '#6366f1' }} />}
              <input
                autoFocus
                type="text"
                placeholder={inputState.isFolder ? "Folder name..." : "File name..."}
                className="form-input"
                style={{ height: '22px', padding: '2px 6px', fontSize: '12px', flex: 1 }}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onBlur={() => setInputState({ parentPath: '', isFolder: false, active: false })}
              />
            </form>
          )}

          {node.isFolder && isExpanded && node.children && (
            <div>{renderTree(node.children)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="explorer-header">
        <span className="explorer-title">Files</span>
        <div className="action-btn-group">
          <button 
            className="icon-btn" 
            title="New File in Root"
            onClick={() => setInputState({ parentPath: '', isFolder: false, active: true })}
          >
            <Plus size={14} />
          </button>
          <button 
            className="icon-btn" 
            title="New Folder in Root"
            onClick={() => setInputState({ parentPath: '', isFolder: true, active: true })}
          >
            <FolderPlus size={14} />
          </button>
        </div>
      </div>
      
      {/* Create Root-item box */}
      {inputState.active && inputState.parentPath === '' && (
        <form onSubmit={handleCreateSubmit} className="tree-node" style={{ marginBottom: '8px' }}>
          {inputState.isFolder ? <Folder size={14} style={{ color: '#f59e0b' }} /> : <File size={14} style={{ color: '#6366f1' }} />}
          <input
            autoFocus
            type="text"
            placeholder={inputState.isFolder ? "Folder name..." : "File name..."}
            className="form-input"
            style={{ height: '24px', padding: '2px 8px', fontSize: '12px', flex: 1 }}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onBlur={() => setInputState({ parentPath: '', isFolder: false, active: false })}
          />
        </form>
      )}
      
      <div style={{ flex: 1, overflowY: 'auto', margin: '0 -12px' }}>
        {tree.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px', textAlign: 'center' }}>
            No files found
          </div>
        ) : (
          renderTree(tree)
        )}
      </div>
    </div>
  );
};
