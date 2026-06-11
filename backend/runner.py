import os
import sys
import asyncio
import subprocess
from typing import Dict, List, Set, Optional
from workspace_manager import safe_path

class ProjectRunner:
    def __init__(self, project_name: str):
        self.project_name = project_name
        self.process: Optional[asyncio.subprocess.Process] = None
        self.logs: List[str] = []
        self.max_logs = 1000
        self.status = "stopped"  # "stopped", "starting", "running", "failed"
        self.port: Optional[int] = None
        self.listeners: Set[asyncio.Queue] = set()
        self.read_task: Optional[asyncio.Task] = None
        self.command_ran: Optional[str] = None

    def add_log(self, text: str):
        self.logs.append(text)
        if len(self.logs) > self.max_logs:
            self.logs.pop(0)
        
        # Broadcast to all websocket listener queues
        for q in self.listeners:
            q.put_nowait(text)

    async def _read_stream(self, stream, prefix=""):
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                decoded_line = line.decode("utf-8", errors="replace").rstrip()
                self.add_log(f"{prefix}{decoded_line}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.add_log(f"[IDE SYSTEM ERROR] Error reading process stream: {str(e)}")

    async def start(self, command: str, port: int):
        if self.status in ("starting", "running"):
            await self.stop()

        self.status = "starting"
        self.port = port
        self.command_ran = command
        self.logs = [] # Clear previous logs
        self.add_log(f"[IDE SYSTEM] Starting server for project '{self.project_name}' on port {port}...")
        self.add_log(f"[IDE SYSTEM] Command: {command}")
        
        # Setup environment (e.g., set FLASK_RUN_PORT, PORT, or modify settings)
        env = os.environ.copy()
        env["PORT"] = str(port)
        env["FLASK_RUN_PORT"] = str(port)
        env["PYTHONUNBUFFERED"] = "1"  # Disable python output buffering
        
        proj_dir = safe_path(self.project_name)
        
        try:
            # On Windows, we need standard shell execution
            self.process = await asyncio.create_subprocess_shell(
                command,
                cwd=proj_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                # On Windows, processes run in shell
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
            )
            
            self.status = "running"
            self.add_log(f"[IDE SYSTEM] Server process spawned with PID {self.process.pid}.")
            
            # Start concurrent stdout & stderr reader tasks
            self.read_task = asyncio.gather(
                self._read_stream(self.process.stdout),
                self._read_stream(self.process.stderr, prefix="[STDERR] "),
                self._wait_for_exit()
            )
            
        except Exception as e:
            self.status = "failed"
            self.add_log(f"[IDE SYSTEM ERROR] Failed to start process: {str(e)}")

    async def _wait_for_exit(self):
        try:
            returncode = await self.process.wait()
            self.status = "stopped"
            self.add_log(f"[IDE SYSTEM] Process exited with return code {returncode}.")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.add_log(f"[IDE SYSTEM] Exception while waiting for process: {str(e)}")

    async def stop(self):
        if not self.process:
            self.status = "stopped"
            return
            
        self.add_log("[IDE SYSTEM] Stopping server process...")
        
        # Terminate process tree
        if sys.platform == "win32":
            # On Windows, terminating shell processes often leaves child processes orphaned.
            # We use taskkill to terminate the process and all of its child processes recursively.
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(self.process.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except Exception:
                try:
                    self.process.terminate()
                except Exception:
                    pass
        else:
            try:
                self.process.terminate()
            except Exception:
                pass
                
        # Cancel stream reader tasks
        if self.read_task:
            self.read_task.cancel()
            try:
                await self.read_task
            except Exception:
                pass
            self.read_task = None
            
        self.process = None
        self.status = "stopped"
        self.add_log("[IDE SYSTEM] Server stopped.")

    async def restart(self):
        if self.command_ran and self.port:
            await self.stop()
            # Small wait
            await asyncio.sleep(0.5)
            await self.start(self.command_ran, self.port)
        else:
            self.add_log("[IDE SYSTEM ERROR] Cannot restart: No command or port configured.")

class ProjectRunnerManager:
    def __init__(self):
        self.runners: Dict[str, ProjectRunner] = {}

    def get_runner(self, project_name: str) -> ProjectRunner:
        if project_name not in self.runners:
            self.runners[project_name] = ProjectRunner(project_name)
        return self.runners[project_name]
        
    async def stop_all(self):
        for runner in self.runners.values():
            await runner.stop()

# Global runner manager
runner_manager = ProjectRunnerManager()
