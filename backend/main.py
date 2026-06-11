import os
import json
import asyncio
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import winpty

# Import our managers
import workspace_manager as wm
import db_manager as dbm
from runner import runner_manager

app = FastAPI(title="Web IDE Backend API")

# Add CORS Middleware to allow React dev server to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request Models
class CreateProjectRequest(BaseModel):
    name: str
    template: str  # "fastapi", "flask", "django"

class CloneProjectRequest(BaseModel):
    name: str
    repoUrl: str

class WriteFileRequest(BaseModel):
    content: str

class CreateItemRequest(BaseModel):
    path: str
    isFolder: bool

class RenameItemRequest(BaseModel):
    oldPath: str
    newPath: str

class QueryRequest(BaseModel):
    query: str

@app.on_event("shutdown")
async def shutdown_event():
    # Clean up all background server processes
    await runner_manager.stop_all()

# --- Project REST API ---

@app.get("/api/projects")
def list_projects():
    try:
        return {"projects": wm.get_projects()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects/create")
def create_project(req: CreateProjectRequest):
    try:
        wm.create_project_boilerplate(req.name, req.template)
        return {"success": True, "message": f"Project {req.name} created successfully."}
    except FileExistsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects/clone")
async def clone_project(req: CloneProjectRequest):
    try:
        # Run clone in thread pool to prevent blocking the event loop
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, wm.clone_git_repo, req.name, req.repoUrl)
        return {"success": True, "message": f"Project cloned successfully into {req.name}."}
    except FileExistsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- File Operations REST API ---

@app.get("/api/files/tree")
def get_file_tree(project: str = Query(...)):
    try:
        return wm.get_file_tree(project)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/files/read")
def read_file(project: str = Query(...), path: str = Query(...)):
    try:
        content = wm.read_file_content(project, path)
        return {"content": content}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/files/write")
def write_file(project: str = Query(...), path: str = Query(...), req: WriteFileRequest = Body(...)):
    try:
        wm.write_file_content(project, path, req.content)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/files/create")
def create_item(project: str = Query(...), req: CreateItemRequest = Body(...)):
    try:
        wm.create_item(project, req.path, req.isFolder)
        return {"success": True}
    except FileExistsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/files/delete")
def delete_item(project: str = Query(...), path: str = Query(...)):
    try:
        wm.delete_item(project, path)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/files/rename")
def rename_item(project: str = Query(...), req: RenameItemRequest = Body(...)):
    try:
        wm.rename_item(project, req.oldPath, req.newPath)
        return {"success": True}
    except (FileNotFoundError, FileExistsError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Database REST API ---

@app.get("/api/db/list")
def list_dbs(project: str = Query(...)):
    try:
        return {"dbs": dbm.find_sqlite_dbs(project)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/db/tables")
async def get_tables(project: str = Query(...), dbPath: str = Query(...)):
    try:
        tables = await dbm.get_tables(project, dbPath)
        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/db/schema")
async def get_schema(project: str = Query(...), dbPath: str = Query(...), table: str = Query(...)):
    try:
        schema = await dbm.get_table_schema(project, dbPath, table)
        return {"schema": schema}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/db/rows")
async def get_rows(
    project: str = Query(...), 
    dbPath: str = Query(...), 
    table: str = Query(...),
    limit: int = Query(50),
    offset: int = Query(0)
):
    try:
        columns, rows = await dbm.get_table_rows(project, dbPath, table, limit, offset)
        return {"columns": columns, "rows": rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/db/query")
async def run_query(project: str = Query(...), dbPath: str = Query(...), req: QueryRequest = Body(...)):
    res = await dbm.execute_custom_query(project, dbPath, req.query)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res

# --- WebSocket Terminal Endpoint ---

@app.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket, project: str = Query(...)):
    await websocket.accept()
    
    # Spawn cmd.exe inside the project directory
    cwd = wm.safe_path(project)
    
    # On Windows, we'll spawn cmd.exe which is highly reliable.
    # Set console size: 80 cols, 24 rows
    proc = winpty.PtyProcess.spawn(["cmd.exe"], cwd=cwd, dimensions=(24, 80))
    
    loop = asyncio.get_running_loop()
    
    async def read_from_pty():
        try:
            while proc.isalive():
                # Read from winpty process (blocking call run in executor)
                data = await loop.run_in_executor(None, proc.read, 1024)
                if data:
                    await websocket.send_text(data)
                else:
                    await asyncio.sleep(0.05)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            try:
                await websocket.send_text(f"\r\n[PTY Reader Error: {str(e)}]\r\n")
            except Exception:
                pass

    read_task = asyncio.create_task(read_from_pty())
    
    try:
        while proc.isalive():
            # Wait for data from web client
            text = await websocket.receive_text()
            
            # Check for window resize message
            if text.startswith("{") and "cols" in text and "rows" in text:
                try:
                    data = json.loads(text)
                    if data.get("type") == "resize":
                        proc.setwinsize(data["rows"], data["cols"])
                        continue
                except Exception:
                    pass
            
            # Write plain key events / command text to PTY
            proc.write(text)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Terminal write exception: {e}")
    finally:
        read_task.cancel()
        proc.terminate()
        try:
            await websocket.close()
        except Exception:
            pass

# --- WebSocket Server Runner Endpoint ---

@app.websocket("/ws/runner/{project_name}")
async def websocket_runner(websocket: WebSocket, project_name: str):
    await websocket.accept()
    
    runner = runner_manager.get_runner(project_name)
    queue = asyncio.Queue()
    runner.listeners.add(queue)
    
    # Stream historical logs first
    for log in runner.logs:
        await websocket.send_json({"type": "log", "data": log})
        
    # Send current process status
    await websocket.send_json({
        "type": "status",
        "status": runner.status,
        "port": runner.port,
        "command": runner.command_ran
    })
    
    # Task to forward logs from process to websocket
    async def log_forwarder():
        try:
            while True:
                log_data = await queue.get()
                await websocket.send_json({"type": "log", "data": log_data})
                queue.task_done()
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
            
    forwarder_task = asyncio.create_task(log_forwarder())
    
    try:
        while True:
            # Wait for control commands from client
            msg = await websocket.receive_text()
            data = json.loads(msg)
            action = data.get("action")
            
            if action == "start":
                command = data.get("command")
                port = int(data.get("port", 8000))
                # Start process in background
                asyncio.create_task(runner.start(command, port))
                # Broadcast immediately starting
                await websocket.send_json({"type": "status", "status": "starting", "port": port, "command": command})
                
            elif action == "stop":
                await runner.stop()
                await websocket.send_json({"type": "status", "status": "stopped", "port": None, "command": None})
                
            elif action == "restart":
                asyncio.create_task(runner.restart())
                await websocket.send_json({"type": "status", "status": "starting", "port": runner.port, "command": runner.command_ran})
                
            # Periodically poll/send status updates
            await websocket.send_json({
                "type": "status",
                "status": runner.status,
                "port": runner.port,
                "command": runner.command_ran
            })
            
    except WebSocketDisconnect:
        pass
    finally:
        forwarder_task.cancel()
        runner.listeners.remove(queue)
        try:
            await websocket.close()
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn
    # Run server locally on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
