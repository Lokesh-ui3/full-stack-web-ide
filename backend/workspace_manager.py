import os
import shutil
import pathlib
import subprocess
from typing import Dict, List, Any, Optional
import git

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "projects"))

def ensure_workspace():
    if not os.path.exists(WORKSPACE_DIR):
        os.makedirs(WORKSPACE_DIR)

def safe_path(project_name: str, relative_path: str = "") -> str:
    """
    Returns an absolute path inside the specific project folder, preventing traversal attacks.
    """
    ensure_workspace()
    # Normalize paths
    proj_dir = os.path.abspath(os.path.join(WORKSPACE_DIR, project_name))
    if relative_path:
        target_path = os.path.abspath(os.path.join(proj_dir, relative_path))
    else:
        target_path = proj_dir
        
    # Check that target_path starts with workspace project directory
    if not target_path.startswith(WORKSPACE_DIR):
        raise ValueError("Directory traversal attempt detected.")
    return target_path

def get_projects() -> List[str]:
    ensure_workspace()
    return [d for d in os.listdir(WORKSPACE_DIR) if os.path.isdir(os.path.join(WORKSPACE_DIR, d))]

def get_file_tree(project_name: str, current_path: str = "") -> List[Dict[str, Any]]:
    """
    Returns a list of dictionary representations of files and directories.
    """
    abs_dir = safe_path(project_name, current_path)
    if not os.path.exists(abs_dir):
        return []
    
    items = []
    try:
        for entry in os.scandir(abs_dir):
            # Exclude python cache, env folders, and git folders to keep it clean and performant
            if entry.name in (".git", "__pycache__", "venv", ".venv", "node_modules", ".pytest_cache"):
                continue
                
            # Path relative to project directory
            rel_to_proj = os.path.relpath(entry.path, safe_path(project_name))
            # Normalize to forward slashes for cross-platform frontend compatibility
            rel_to_proj_normalized = rel_to_proj.replace("\\", "/")
            
            item: Dict[str, Any] = {
                "name": entry.name,
                "path": rel_to_proj_normalized,
                "isFolder": entry.is_dir(),
            }
            if entry.is_dir():
                item["children"] = get_file_tree(project_name, rel_to_proj)
            items.append(item)
    except Exception as e:
        pass
        
    # Sort: directories first, then alphabetically
    items.sort(key=lambda x: (not x["isFolder"], x["name"].lower()))
    return items

def read_file_content(project_name: str, file_path: str) -> str:
    abs_path = safe_path(project_name, file_path)
    if not os.path.exists(abs_path):
        raise FileNotFoundError(f"File {file_path} not found.")
    if os.path.isdir(abs_path):
        raise ValueError("Cannot read directory as file.")
    with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()

def write_file_content(project_name: str, file_path: str, content: str) -> None:
    abs_path = safe_path(project_name, file_path)
    if os.path.exists(abs_path) and os.path.isdir(abs_path):
        raise ValueError("Cannot write file: a directory exists at this path.")
    
    # Ensure parent dir exists
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content)

def create_item(project_name: str, path: str, is_folder: bool) -> None:
    abs_path = safe_path(project_name, path)
    if os.path.exists(abs_path):
        raise FileExistsError("Item already exists at this path.")
        
    if is_folder:
        os.makedirs(abs_path, exist_ok=True)
    else:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write("")

def delete_item(project_name: str, path: str) -> None:
    abs_path = safe_path(project_name, path)
    if not os.path.exists(abs_path):
        return
        
    if os.path.isdir(abs_path):
        shutil.rmtree(abs_path)
    else:
        os.remove(abs_path)

def rename_item(project_name: str, old_path: str, new_path: str) -> None:
    abs_old = safe_path(project_name, old_path)
    abs_new = safe_path(project_name, new_path)
    
    if not os.path.exists(abs_old):
        raise FileNotFoundError(f"Source item not found: {old_path}")
    if os.path.exists(abs_new):
        raise FileExistsError(f"Destination already exists: {new_path}")
        
    os.makedirs(os.path.dirname(abs_new), exist_ok=True)
    os.rename(abs_old, abs_new)

def clone_git_repo(project_name: str, repo_url: str) -> None:
    proj_dir = safe_path(project_name)
    if os.path.exists(proj_dir) and os.listdir(proj_dir):
        raise FileExistsError("Project folder already exists and is not empty.")
    
    git.Repo.clone_from(repo_url, proj_dir)

def create_project_boilerplate(project_name: str, template: str) -> None:
    proj_dir = safe_path(project_name)
    if os.path.exists(proj_dir) and os.listdir(proj_dir):
        raise FileExistsError("Project folder already exists and is not empty.")
        
    os.makedirs(proj_dir, exist_ok=True)
    
    if template == "fastapi":
        # Create FastAPI main.py, requirements.txt, and simple DB setup
        write_file_content(project_name, "main.py", """import os
import sqlite3
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="My FastAPI IDE App")

# SQLite DB Initialization
DB_FILE = "app.db"
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOCT_INCREMENT,
            title TEXT NOT NULL,
            completed INTEGER DEFAULT 0
        )
    ''')
    # Insert dummy data if table is empty
    c.execute("SELECT COUNT(*) FROM todos")
    if c.fetchone()[0] == 0:
        c.executemany("INSERT INTO todos (title, completed) VALUES (?, ?)", [
            ("Learn FastAPI in-browser", 1),
            ("Connect SQLite Database", 0),
            ("Build stunning full-stack web apps", 0)
        ])
    conn.commit()
    conn.close()

init_db()

@app.get("/")
async def read_root():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT * FROM todos")
    todos = [{"id": r[0], "title": r[1], "completed": bool(r[2])} for r in c.fetchall()]
    conn.close()
    
    todo_list_html = "".join([
        f'<li>{"<s>" if t["completed"] else ""}{t["title"]}{"</s>" if t["completed"] else ""}</li>' 
        for t in todos
    ])
    
    html_content = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>FastAPI Web IDE App</title>
        <style>
            body {{
                font-family: 'Outfit', 'Inter', sans-serif;
                background: linear-gradient(135deg, #0f172a, #1e1b4b);
                color: #f8fafc;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
            }}
            .card {{
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 32px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                max-width: 400px;
                width: 100%;
            }}
            h1 {{
                font-size: 24px;
                margin-bottom: 8px;
                background: linear-gradient(to right, #38bdf8, #818cf8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            p {{ color: #94a3b8; font-size: 14px; margin-bottom: 24px; }}
            ul {{ list-style: none; padding: 0; }}
            li {{
                background: rgba(255, 255, 255, 0.03);
                padding: 12px 16px;
                border-radius: 8px;
                margin-bottom: 8px;
                border: 1px solid rgba(255, 255, 255, 0.05);
                font-size: 14px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>FastAPI Backend Running!</h1>
            <p>This page is rendering live data fetched from SQLite database in the workspace.</p>
            <h3>Todo List:</h3>
            <ul>
                {todo_list_html}
            </ul>
        </div>
    </body>
    </html>
    '''
    return HTMLResponse(content=html_content)

@app.get("/api/todos")
async def get_todos():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT * FROM todos")
    todos = [{"id": r[0], "title": r[1], "completed": bool(r[2])} for r in c.fetchall()]
    conn.close()
    return {"todos": todos}
""")
        write_file_content(project_name, "requirements.txt", """fastapi==0.111.0
uvicorn[standard]==0.30.1
""")
        
    elif template == "flask":
        write_file_content(project_name, "app.py", """import os
import sqlite3
from flask import Flask, render_template_string, jsonify

app = Flask(__name__)
DB_FILE = "app.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            quantity INTEGER DEFAULT 1
        )
    ''')
    c.execute("SELECT COUNT(*) FROM items")
    if c.fetchone()[0] == 0:
        c.executemany("INSERT INTO items (name, quantity) VALUES (?, ?)", [
            ("Workspace Files", 10),
            ("SQLite DB Tables", 4),
            ("Live Server Instances", 1)
        ])
    conn.commit()
    conn.close()

init_db()

@app.route("/")
def home():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT * FROM items")
    items = [{"id": r[0], "name": r[1], "quantity": r[2]} for r in c.fetchall()]
    conn.close()
    
    list_items = "".join([f'<li>{item["name"]} - Quantity: <b>{item["quantity"]}</b></li>' for item in items])
    
    html_content = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Flask Web IDE App</title>
        <style>
            body {{
                font-family: 'Outfit', 'Inter', sans-serif;
                background: linear-gradient(135deg, #0f172a, #111827);
                color: #f8fafc;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
            }}
            .card {{
                background: rgba(255, 255, 255, 0.04);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 32px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
                max-width: 400px;
                width: 100%;
            }}
            h1 {{
                font-size: 24px;
                margin-bottom: 8px;
                background: linear-gradient(to right, #fb7185, #f43f5e);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            p {{ color: #94a3b8; font-size: 14px; margin-bottom: 24px; }}
            ul {{ list-style: none; padding: 0; }}
            li {{
                background: rgba(255, 255, 255, 0.03);
                padding: 12px 16px;
                border-radius: 8px;
                margin-bottom: 8px;
                border: 1px solid rgba(255, 255, 255, 0.05);
                font-size: 14px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Flask Backend Running!</h1>
            <p>Rendered dynamically from Flask on local development server.</p>
            <h3>Workspace Inventory:</h3>
            <ul>
                {list_items}
            </ul>
        </div>
    </body>
    </html>
    '''
    return render_template_string(html_content)

@app.route("/api/items")
def get_items():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT * FROM items")
    items = [{"id": r[0], "name": r[1], "quantity": r[2]} for r in c.fetchall()]
    conn.close()
    return jsonify(items)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
""")
        write_file_content(project_name, "requirements.txt", """flask==3.0.3
""")
        
    elif template == "django":
        # Create standard Django structure manually to avoid requiring django-admin preinstalled
        # We write a basic self-contained Django startup
        write_file_content(project_name, "manage.py", """#!/usr/bin/env python
import os
import sys

def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed?"
        ) from exc
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()
""")
        write_file_content(project_name, "myproject/__init__.py", "")
        write_file_content(project_name, "myproject/asgi.py", """import os
from django.core.asgi import get_asgi_application
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')
application = get_asgi_application()
""")
        write_file_content(project_name, "myproject/wsgi.py", """import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')
application = get_wsgi_application()
""")
        write_file_content(project_name, "myproject/urls.py", """from django.contrib import admin
from django.urls import path
from django.http import HttpResponse
import sqlite3

def home_view(request):
    # Retrieve from sqlite db
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db.sqlite3")
    todos = []
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, done INTEGER)")
        c.execute("SELECT COUNT(*) FROM tasks")
        if c.fetchone()[0] == 0:
            c.executemany("INSERT INTO tasks (title, done) VALUES (?, ?)", [
                ("Configure Django settings", 1),
                ("Run Django server", 0),
                ("Observe SQLite integration", 0)
            ])
            conn.commit()
        c.execute("SELECT * FROM tasks")
        todos = [{"id": r[0], "title": r[1], "done": bool(r[2])} for r in c.fetchall()]
        conn.close()
    except Exception as e:
        todos = [{"id": 0, "title": f"DB load error: {str(e)}", "done": False}]

    todo_items = "".join([f'<li>{"<s>" if t["done"] else ""}{t["title"]}{"</s>" if t["done"] else ""}</li>' for t in todos])
    
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Django Web IDE App</title>
        <style>
            body {{
                font-family: 'Outfit', 'Inter', sans-serif;
                background: linear-gradient(135deg, #1e1b4b, #111827);
                color: #f8fafc;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
            }}
            .card {{
                background: rgba(255, 255, 255, 0.04);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 32px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
                max-width: 400px;
                width: 100%;
            }}
            h1 {{
                font-size: 24px;
                margin-bottom: 8px;
                background: linear-gradient(to right, #4ade80, #2dd4bf);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            p {{ color: #94a3b8; font-size: 14px; margin-bottom: 24px; }}
            ul {{ list-style: none; padding: 0; }}
            li {{
                background: rgba(255, 255, 255, 0.03);
                padding: 12px 16px;
                border-radius: 8px;
                margin-bottom: 8px;
                border: 1px solid rgba(255, 255, 255, 0.05);
                font-size: 14px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Django Server Active!</h1>
            <p>Serving templates and connecting database dynamically.</p>
            <h3>Django Tasks:</h3>
            <ul>
                {todo_items}
            </ul>
        </div>
    </body>
    </html>
    '''
    return HttpResponse(html)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', home_view),
]
""")
        
        write_file_content(project_name, "myproject/settings.py", """import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-mock-key-for-local-development-web-ide-app'

DEBUG = True

ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'myproject.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'myproject.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
""")
        write_file_content(project_name, "requirements.txt", """django==5.0.6
""")
        
        # Touch db.sqlite3 right away to make it easy for db viewer
        db_path = safe_path(project_name, "db.sqlite3")
        import sqlite3
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT, done INTEGER)")
        c.execute("INSERT INTO tasks (title, done) VALUES ('Configure Django settings', 1)")
        conn.commit()
        conn.close()
