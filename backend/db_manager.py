import os
import aiosqlite
from typing import Dict, List, Any, Tuple
from workspace_manager import safe_path

def find_sqlite_dbs(project_name: str) -> List[str]:
    """
    Search recursively inside the project directory for SQLite database files.
    """
    proj_dir = safe_path(project_name)
    db_files = []
    
    # Extensions commonly used for SQLite files
    extensions = (".sqlite", ".sqlite3", ".db", ".db3")
    
    for root, dirs, files in os.walk(proj_dir):
        # Exclude node_modules, envs, cache
        if any(ignored in root for ignored in ("venv", ".venv", "__pycache__", "node_modules", ".git")):
            continue
        for file in files:
            if file.endswith(extensions):
                rel_path = os.path.relpath(os.path.join(root, file), proj_dir)
                db_files.append(rel_path.replace("\\", "/"))
                
    return db_files

def get_db_uri(project_name: str, db_rel_path: str, read_only: bool = True) -> str:
    """
    Generates a SQLite URI path for connecting.
    Enforces read_only mode via sqlite parameters when required.
    """
    abs_path = safe_path(project_name, db_rel_path)
    # Convert Windows path backslashes to forward slashes for URI formatting
    path_uri = pathlib_path = os.path.abspath(abs_path).replace("\\", "/")
    
    # Ensure it starts with correct prefix. For Windows, we might need file:///C:/path/to/db
    if not path_uri.startswith("/"):
        path_uri = "/" + path_uri
        
    uri = f"file:{path_uri}"
    if read_only:
        uri += "?mode=ro"
        
    return uri

async def get_tables(project_name: str, db_rel_path: str) -> List[Dict[str, Any]]:
    """
    Gets list of tables and their row counts.
    """
    uri = get_db_uri(project_name, db_rel_path, read_only=True)
    tables_list = []
    
    async with aiosqlite.connect(uri, uri=True) as db:
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") as cursor:
            tables = await cursor.fetchall()
            
        for row in tables:
            table_name = row[0]
            # Get row count safely
            try:
                async with db.execute(f'SELECT COUNT(*) FROM "{table_name}"') as count_cursor:
                    count_row = await count_cursor.fetchone()
                    count = count_row[0] if count_row else 0
            except Exception:
                count = 0
            
            tables_list.append({
                "name": table_name,
                "rows": count
            })
            
    return tables_list

async def get_table_schema(project_name: str, db_rel_path: str, table_name: str) -> List[Dict[str, Any]]:
    """
    Fetches details of all columns in the table.
    """
    uri = get_db_uri(project_name, db_rel_path, read_only=True)
    columns = []
    
    async with aiosqlite.connect(uri, uri=True) as db:
        # PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
        async with db.execute(f'PRAGMA table_info("{table_name}")') as cursor:
            rows = await cursor.fetchall()
            for row in rows:
                columns.append({
                    "cid": row[0],
                    "name": row[1],
                    "type": row[2],
                    "notnull": bool(row[3]),
                    "dflt_value": row[4],
                    "pk": bool(row[5])
                })
                
    return columns

async def get_table_rows(
    project_name: str, 
    db_rel_path: str, 
    table_name: str, 
    limit: int = 50, 
    offset: int = 0
) -> Tuple[List[str], List[List[Any]]]:
    """
    Fetches paginated list of rows and column headers.
    """
    uri = get_db_uri(project_name, db_rel_path, read_only=True)
    
    async with aiosqlite.connect(uri, uri=True) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f'SELECT * FROM "{table_name}" LIMIT {limit} OFFSET {offset}') as cursor:
            columns = [col[0] for col in cursor.description] if cursor.description else []
            rows = await cursor.fetchall()
            
            row_data = []
            for r in rows:
                row_data.append(list(r))
                
    return columns, row_data

async def execute_custom_query(project_name: str, db_rel_path: str, query: str) -> Dict[str, Any]:
    """
    Executes a custom SQL query in strict read-only mode and returns columns and row data.
    """
    # Enforce read-only at connection level
    uri = get_db_uri(project_name, db_rel_path, read_only=True)
    
    # Extra check to prevent DDL/DML at app level
    forbidden_keywords = ("insert", "update", "delete", "drop", "create", "alter", "replace", "vacuum", "pragma")
    query_lower = query.strip().lower()
    
    # Allow PRAGMA table_info or index_list, but restrict raw pragma settings
    if any(keyword in query_lower for keyword in forbidden_keywords):
        # Allow reading schema-related statements
        if not (query_lower.startswith("select") or query_lower.startswith("pragma table_info")):
            return {
                "success": False,
                "error": "Only read-only SELECT queries are allowed."
            }
            
    try:
        async with aiosqlite.connect(uri, uri=True) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(query) as cursor:
                columns = [col[0] for col in cursor.description] if cursor.description else []
                rows = await cursor.fetchall()
                
                row_data = []
                for r in rows:
                    row_data.append(list(r))
                    
                return {
                    "success": True,
                    "columns": columns,
                    "rows": row_data,
                    "count": len(row_data)
                }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
