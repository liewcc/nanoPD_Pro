import argparse
import platform
import sys
import psutil
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import cellular_mqtt_manager


app = FastAPI(
    title="nanoPD Pro Backend",
    description="Local Python Backend for nanoPD Pro Desktop Framework",
    version="1.0.0"
)

active_backend_ports = set()

# Enable CORS for local Electron frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local desktop apps, allow all or electron-specific protocols
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "message": "FastAPI Python backend is fully operational!",
        "engine": "nanoPD Pro Core"
    }

@app.get("/api/diagnostics")
def get_diagnostics():
    """Returns real-time system performance data."""
    try:
        cpu_usage = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        return {
            "status": "success",
            "data": {
                "os": platform.system(),
                "os_release": platform.release(),
                "python_version": sys.version.split()[0],
                "cpu_cores": psutil.cpu_count(logical=True),
                "cpu_usage_percent": cpu_usage,
                "memory_used_gb": round(mem.used / (1024**3), 2),
                "memory_total_gb": round(mem.total / (1024**3), 2),
                "memory_usage_percent": mem.percent,
                "disk_usage_percent": disk.percent
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

@app.get("/api/com_ports")
def get_com_ports():
    """Returns a list of connected COM ports and their detailed properties."""
    ports = []
    details = {}
    
    try:
        if platform.system() == "Windows":
            import subprocess
            import json
            import re
            
            # Primary method: Get-PnpDevice via PowerShell to get rich properties
            try:
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                out = subprocess.check_output(
                    ["powershell", "-Command", "Get-PnpDevice -Class Ports -PresentOnly | Select-Object FriendlyName, Manufacturer, InstanceId | ConvertTo-Json"],
                    text=True,
                    startupinfo=startupinfo,
                    timeout=5
                )
                if out.strip():
                    raw_data = json.loads(out)
                    devices = [raw_data] if isinstance(raw_data, dict) else raw_data
                    
                    for dev in devices:
                        friendly_name = dev.get("FriendlyName") or ""
                        manufacturer = dev.get("Manufacturer") or "------"
                        instance_id = dev.get("InstanceId") or ""
                        
                        com_match = re.search(r'\((COM\d+)\)', friendly_name)
                        if com_match:
                            port_name = com_match.group(1)
                            
                            vid_match = re.search(r'VID_([0-9A-Fa-f]{4})', instance_id)
                            pid_match = re.search(r'PID_([0-9A-Fa-f]{4})', instance_id)
                            
                            # Filter out unresponsive/dummy COM ports (no USB VID/PID)
                            if not vid_match and not pid_match:
                                continue
                                
                            ports.append(port_name)
                            vid = f"0x{vid_match.group(1).upper()}" if vid_match else "------"
                            pid = f"0x{pid_match.group(1).upper()}" if pid_match else "------"
                            
                            # Parse serial number
                            ser = "------"
                            if vid_match or pid_match:
                                parts = instance_id.split('\\')
                                if len(parts) >= 2:
                                    mid = parts[1]
                                    if '+' in mid:
                                        subparts = mid.split('+')
                                        if len(subparts) >= 3:
                                            ser = subparts[2]
                                    elif len(parts) >= 3:
                                        last = parts[2]
                                        if '&' not in last:
                                            ser = last
                            
                            details[port_name] = {
                                "port": port_name,
                                "name": friendly_name,
                                "manufacturer": manufacturer,
                                "vid": vid,
                                "pid": pid,
                                "ser": ser
                            }
            except Exception:
                pass
                
            # Secondary method: fallback to Registry if ports list is empty
            if not ports:
                import winreg
                try:
                    key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\SERIALCOMM")
                    for i in range(1024):
                        try:
                            name, value, type = winreg.EnumValue(key, i)
                            ports.append(value)
                        except OSError:
                            break
                except Exception:
                    pass
            
            # Tertiary fallback: PowerShell .NET GetPortNames()
            if not ports:
                try:
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    out = subprocess.check_output(
                        ["powershell", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames()"],
                        text=True,
                        startupinfo=startupinfo,
                        timeout=5
                    )
                    ports = [p.strip() for p in out.splitlines() if p.strip()]
                except Exception:
                    pass
                    
        else:
            # Unix platforms
            import glob
            if platform.system() == "Darwin":
                ports = glob.glob("/dev/cu.*")
            elif platform.system() == "Linux":
                ports = glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*")
                
    except Exception as e:
        return {"status": "error", "message": str(e), "ports": [], "details": {}}
        
    # Ensure all identified ports have a details entry (with defaults if missing)
    unique_ports = sorted(list(set(ports)))
    for p in unique_ports:
        occupied = False
        import serial
        try:
            test_ser = serial.Serial(p, timeout=0.1)
            test_ser.close()
        except Exception:
            occupied = True

        if p not in details:
            details[p] = {
                "port": p,
                "name": f"Serial Port ({p})",
                "manufacturer": "------",
                "vid": "------",
                "pid": "------",
                "ser": "------"
            }
        details[p]["occupied"] = occupied
            
    return {"status": "success", "ports": unique_ports, "details": details}

@app.websocket("/ws/serial")
async def websocket_serial(
    websocket: WebSocket, 
    port: str, 
    baud: int = 115200,
    bytesize: int = 8,
    stopbits: float = 1.0,
    parity: str = 'N'
):
    await websocket.accept()
    import serial
    ser = None
    read_task = None
    try:
        # Map parity
        parity_map = {
            'N': serial.PARITY_NONE,
            'E': serial.PARITY_EVEN,
            'O': serial.PARITY_ODD,
            'M': serial.PARITY_MARK,
            'S': serial.PARITY_SPACE
        }
        p_val = parity_map.get(parity.upper(), serial.PARITY_NONE)
        
        # Map stop bits
        stop_map = {
            1.0: serial.STOPBITS_ONE,
            1.5: serial.STOPBITS_ONE_POINT_FIVE,
            2.0: serial.STOPBITS_TWO
        }
        s_val = stop_map.get(stopbits, serial.STOPBITS_ONE)
        
        # Open serial port
        ser = serial.Serial(
            port=port, 
            baudrate=baud, 
            bytesize=bytesize, 
            parity=p_val, 
            stopbits=s_val, 
            timeout=0.1
        )
        active_backend_ports.add(port)
        
        # Background task to continuously read from the COM port
        async def read_from_serial():
            loop = asyncio.get_event_loop()
            try:
                while ser and ser.is_open:
                    # Run the blocking read call in a thread pool executor
                    data = await loop.run_in_executor(None, lambda: ser.read(1024))
                    if data:
                        # Decode using latin1 to preserve raw byte values (0-255) transparently
                        text_data = data.decode('latin1')
                        await websocket.send_json({"type": "data", "data": text_data})
                    await asyncio.sleep(0.01)
            except Exception as e:
                try:
                    await websocket.send_json({"type": "error", "message": f"Read error: {str(e)}"})
                except Exception:
                    pass

        read_task = asyncio.create_task(read_from_serial())

        # Main receive loop for writing data to the COM port
        while True:
            msg = await websocket.receive_json()
            if msg.get("action") == "write":
                payload = msg.get("data", "")
                is_hex = msg.get("hex", False)
                if is_hex:
                    try:
                        clean_payload = "".join(payload.split())
                        bytes_to_write = bytes.fromhex(clean_payload)
                        ser.write(bytes_to_write)
                        ser.flush()
                    except ValueError as ve:
                        await websocket.send_json({"type": "error", "message": f"Invalid Hex: {str(ve)}"})
                else:
                    ser.write(payload.encode('utf-8'))
                    ser.flush()
            elif msg.get("action") == "close":
                break

    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": f"Serial connection error: {str(e)}"})
        except Exception:
            pass
    finally:
        active_backend_ports.discard(port)
        if read_task:
            read_task.cancel()
        if ser and ser.is_open:
            try:
                ser.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass

@app.websocket("/ws/mqtt")
async def websocket_mqtt(
    websocket: WebSocket,
    host: str,
    port: int = 1883,
    cid: str = "nanopd_mqtt_client",
    user: str = None,
    pwd: str = None
):
    await websocket.accept()
    import paho.mqtt.client as mqtt
    import json
    
    msg_queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    
    def on_connect(c, userdata, flags, rc, properties=None):
        rc_val = rc.value if hasattr(rc, "value") else int(rc)
        status = "connected" if rc_val == 0 else f"refused:{rc}"
        asyncio.run_coroutine_threadsafe(
            msg_queue.put({"type": "status", "status": status, "rc": rc_val}),
            loop
        )
        
    def on_disconnect(c, userdata, flags, rc, properties=None):
        rc_val = rc.value if hasattr(rc, "value") else int(rc)
        asyncio.run_coroutine_threadsafe(
            msg_queue.put({"type": "status", "status": "disconnected", "rc": rc_val}),
            loop
        )
        
    def on_message(c, userdata, msg):
        # Use latin1 to transparently preserve all raw byte values (0-255).
        # This avoids the data corruption caused by utf-8 with errors='replace'
        # when receiving binary Modbus sensor payloads from the cellular DTU.
        try:
            payload_str = msg.payload.decode('latin1')
        except Exception:
            payload_str = msg.payload.hex()
        asyncio.run_coroutine_threadsafe(
            msg_queue.put({
                "type": "msg",
                "topic": msg.topic,
                "payload": payload_str,
                "qos": int(msg.qos),
                "retain": bool(msg.retain)
            }),
            loop
        )
        
    def on_log(c, userdata, level, buf):
        asyncio.run_coroutine_threadsafe(
            msg_queue.put({"type": "log", "message": buf}),
            loop
        )

    client = None
    send_task = None
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=cid)
        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        client.on_message = on_message
        client.on_log = on_log
        
        # Empty user/pwd string check
        username = user if (user and user.strip()) else None
        password = pwd if (pwd and pwd.strip()) else None
        if username:
            client.username_pw_set(username, password)
            
        # Use synchronous connect inside a thread to ensure the TCP handshake
        # completes before the loop starts, avoiding missed on_connect callbacks.
        await asyncio.to_thread(client.connect, host, port, 60)
        client.loop_start()
        
        async def send_to_websocket():
            while True:
                item = await msg_queue.get()
                await websocket.send_json(item)
                msg_queue.task_done()
                
        send_task = asyncio.create_task(send_to_websocket())
        
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "subscribe":
                topic = data.get("topic")
                qos = int(data.get("qos", 0))
                if topic:
                    client.subscribe(topic, qos)
                    await websocket.send_json({"type": "log", "message": f"[System] Subscribed to {topic} (QoS {qos})"})
            elif action == "unsubscribe":
                topic = data.get("topic")
                if topic:
                    client.unsubscribe(topic)
                    await websocket.send_json({"type": "log", "message": f"[System] Unsubscribed from {topic}"})
            elif action == "publish":
                topic = data.get("topic")
                payload = data.get("payload", "")
                qos = int(data.get("qos", 0))
                retain = bool(data.get("retain", False))
                if topic:
                    client.publish(topic, payload, qos, retain)
            elif action == "close":
                break
                
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": f"MQTT Error: {str(e)}"})
        except Exception:
            pass
    finally:
        if send_task:
            send_task.cancel()
        if client:
            client.loop_stop()
            try:
                client.disconnect()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass

@app.websocket("/ws/cellular")
async def websocket_cellular(
    websocket: WebSocket,
    port: str,
    baud: int = 115200,
    bytesize: int = 8,
    stopbits: float = 1.0,
    parity: str = 'N'
):
    await websocket.accept()
    import serial
    
    ser = None
    read_task = None
    send_task = None
    is_automating = False
    loop = asyncio.get_running_loop()
    
    # Message queue for outgoing WebSocket messages to guarantee thread safety
    send_queue = asyncio.Queue()
    
    # Thread-safe helper to enqueue messages to the WebSocket
    def queue_send(msg):
        loop.call_soon_threadsafe(send_queue.put_nowait, msg)
        
    parity_map = {
        'N': serial.PARITY_NONE,
        'E': serial.PARITY_EVEN,
        'O': serial.PARITY_ODD,
        'M': serial.PARITY_MARK,
        'S': serial.PARITY_SPACE
    }
    p_val = parity_map.get(parity.upper(), serial.PARITY_NONE)
    
    stop_map = {
        1.0: serial.STOPBITS_ONE,
        1.5: serial.STOPBITS_ONE_POINT_FIVE,
        2.0: serial.STOPBITS_TWO
    }
    s_val = stop_map.get(stopbits, serial.STOPBITS_ONE)
    
    try:
        ser = serial.Serial(
            port=port,
            baudrate=baud,
            bytesize=bytesize,
            parity=p_val,
            stopbits=s_val,
            timeout=0.1
        )
        active_backend_ports.add(port)
        
        def sync_log_cb(direction, text_or_bytes):
            if isinstance(text_or_bytes, (bytes, bytearray)):
                text = text_or_bytes.decode('latin1')
            else:
                text = text_or_bytes
            print(f"[DEBUG sync_log_cb] {direction}>> {text.strip()}", flush=True)
            queue_send({"type": "log", "direction": direction, "message": text})
            
        async def read_from_serial():
            try:
                while ser and ser.is_open:
                    # Un-comment if we need to see every loop:
                    # print(f"[DEBUG read_loop] is_automating={is_automating}", flush=True)
                    if not is_automating:
                        if ser.in_waiting > 0:
                            w = ser.in_waiting
                            print(f"[DEBUG read_loop] reading {w} bytes...", flush=True)
                            data = await loop.run_in_executor(None, lambda: ser.read(w))
                            if data:
                                text_data = data.decode('latin1')
                                queue_send({"type": "data", "data": text_data})
                    await asyncio.sleep(0.02)
            except Exception as e:
                print(f"[DEBUG read_loop] Error: {e}", flush=True)
                queue_send({"type": "error", "message": f"Read error: {str(e)}"})
                    
        async def send_to_websocket():
            try:
                while True:
                    msg = await send_queue.get()
                    await websocket.send_json(msg)
                    send_queue.task_done()
            except Exception as e:
                print(f"[DEBUG send_loop] Error: {e}", flush=True)
                pass

        read_task = asyncio.create_task(read_from_serial())
        send_task = asyncio.create_task(send_to_websocket())
        
        while True:
            msg = await websocket.receive_json()
            action = msg.get("action")
            
            if action == "write":
                if is_automating:
                    print("[DEBUG] Ignoring write action because is_automating is True", flush=True)
                    continue
                payload = msg.get("data", "")
                is_hex = msg.get("hex", False)
                if is_hex:
                    try:
                        clean_payload = "".join(payload.split())
                        bytes_to_write = bytes.fromhex(clean_payload)
                        ser.write(bytes_to_write)
                        ser.flush()
                    except ValueError as ve:
                        queue_send({"type": "error", "message": f"Invalid Hex: {str(ve)}"})
                else:
                    ser.write(payload.encode('utf-8'))
                    ser.flush()
                    
            elif action == "provision":
                is_automating = True
                await asyncio.sleep(0.2)
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        state = await asyncio.to_thread(cellular_mqtt_manager.read_hw_state, ser, sync_log_cb)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, False, sync_log_cb)
                        queue_send({"type": "hw_state", "state": state})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Provisioning failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_work_mode":
                is_automating = True
                await asyncio.sleep(0.2)
                mode = msg.get("mode", "MQTT")
                ip = msg.get("ip", "")
                port_val = msg.get("port", "")
                cid = msg.get("cid", "")
                user = msg.get("user", "")
                pwd = msg.get("pwd", "")
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_work_mode, ser, sync_log_cb, mode, ip, port_val, cid, user, pwd)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] Mode applied successfully. DTU rebooting."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Work mode apply failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_subs":
                is_automating = True
                await asyncio.sleep(0.2)
                subs = msg.get("subs", [])
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_subs, ser, sync_log_cb, subs)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] Topic subscriptions updated successfully."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Subs update failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_pubs":
                is_automating = True
                await asyncio.sleep(0.2)
                pubs = msg.get("pubs", [])
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_pubs, ser, sync_log_cb, pubs)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] Topic publishing updated successfully."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Pubs update failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_will":
                is_automating = True
                await asyncio.sleep(0.2)
                en = msg.get("en", False)
                topic = msg.get("topic", "")
                msg_val = msg.get("msg", "")
                qos = msg.get("qos", 0)
                retain = msg.get("retain", False)
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_will, ser, sync_log_cb, en, topic, msg_val, qos, retain)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] LWT Configuration updated successfully."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"LWT update failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_mqttcon":
                is_automating = True
                await asyncio.sleep(0.2)
                clean = msg.get("clean_session", True)
                keep = msg.get("keep_alive", 60)
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_mqttcon, ser, sync_log_cb, clean, keep)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] MQTT parameters updated successfully."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"MQTT parameters update failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_uart":
                is_automating = True
                await asyncio.sleep(0.2)
                baud_val = msg.get("baud")
                stop = msg.get("stop")
                data = msg.get("data")
                parity_val = msg.get("parity")
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_uart, ser, sync_log_cb, baud_val, stop, data, parity_val)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] UART settings applied. DTU rebooting."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"UART apply failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "check_network":
                is_automating = True
                await asyncio.sleep(0.2)
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        net_info = {}
                        net_cmds = [
                            ("MODULE", b'AT+MODULE\r\n', "+MODULE"),
                            ("SYSINFO", b'AT+SYSINFO\r\n', "+SYSINFO"),
                            ("ICCID", b'AT+ICCID\r\n', "+ICCID"),
                            ("IMSI", b'AT+IMSI\r\n', "+IMSI"),
                            ("SN", b'AT+SN\r\n', "+SN"),
                            ("CLK", b'AT+CLK\r\n', "+CLK"),
                            ("IMEI", b'AT+IMEI\r\n', "+IMEI"),
                            ("CSQ", b'AT+CSQ\r\n', "+CSQ")
                        ]
                        for key, cmd, prefix in net_cmds:
                            cmd_resp = await asyncio.to_thread(cellular_mqtt_manager._send_and_wait, ser, cmd, 1.0, sync_log_cb)
                            parsed = cellular_mqtt_manager.parse_slot_response(cmd_resp, prefix)
                            if parsed:
                                net_info[key] = parsed[0]
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, False, sync_log_cb)
                        queue_send({"type": "network_info", "data": net_info})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Network check failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "query_csq":
                is_automating = True
                await asyncio.sleep(0.2)
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        cmd_resp = await asyncio.to_thread(cellular_mqtt_manager._send_and_wait, ser, b'AT+CSQ\r\n', 1.0, sync_log_cb)
                        parsed = cellular_mqtt_manager.parse_slot_response(cmd_resp, "+CSQ")
                        csq_val = parsed[0] if parsed else "N/A"
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, False, sync_log_cb)
                        queue_send({"type": "csq_info", "csq": csq_val})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"CSQ query failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "reboot":
                is_automating = True
                await asyncio.sleep(0.2)
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] Reboot command sent successfully. DTU rebooting."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Reboot failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "apply_polling":
                is_automating = True
                await asyncio.sleep(0.2)
                task_mode = msg.get("task_mode", "OFF")
                cycle = msg.get("cycle")
                interval = msg.get("interval")
                iden_en = msg.get("enable_identifier", False)
                iden_fmt = msg.get("identifier_format", "")
                cmd_list = msg.get("list", [])
                try:
                    success = await asyncio.to_thread(cellular_mqtt_manager.enter_at_mode, ser, sync_log_cb)
                    if success:
                        await asyncio.to_thread(cellular_mqtt_manager.apply_polling, ser, sync_log_cb, task_mode, cycle, interval, iden_en, iden_fmt, cmd_list)
                        await asyncio.to_thread(cellular_mqtt_manager.exit_at_mode, ser, True, sync_log_cb)
                        queue_send({"type": "log", "direction": "SYS", "message": "[System] Polling configuration applied successfully."})
                    else:
                        queue_send({"type": "error", "message": "Failed to enter AT mode."})
                except Exception as e:
                    queue_send({"type": "error", "message": f"Polling apply failed: {str(e)}"})
                finally:
                    is_automating = False
                    
            elif action == "close":
                break
                
    except Exception as e:
        try:
            queue_send({"type": "error", "message": f"DTU connection error: {str(e)}"})
        except Exception:
            pass
    finally:
        active_backend_ports.discard(port)
        if read_task:
            read_task.cancel()
        if send_task:
            send_task.cancel()
        if ser and ser.is_open:
            try:
                ser.close()
            except Exception:
                pass
@app.websocket("/ws/repl")
async def websocket_repl(websocket: WebSocket):
    await websocket.accept()
    proc = None
    try:
        msg = await websocket.receive_json()
        action = msg.get("action")
        
        if action == "run":
            code_to_run = msg.get("code", "")
            timeout_val = int(msg.get("timeout", 30))
            
            # 1. Terminate other mpremote processes
            try:
                import psutil
                for p in psutil.process_iter(['pid', 'name', 'cmdline']):
                    try:
                        cmd = p.info.get('cmdline') or []
                        if 'python' in (p.info['name'] or '').lower() and any('mpremote' in arg for arg in cmd) and p.pid != os.getpid():
                            p.terminate()
                    except:
                        pass
            except:
                pass
                
            # 2. Get RP2350 port
            mcu_port = None
            import serial.tools.list_ports
            for port in serial.tools.list_ports.comports():
                desc = (port.description or "").upper()
                mfr  = (port.manufacturer or "").upper()
                if "RP2" in desc or "RP2" in mfr or port.vid == 0x2E8A:
                    mcu_port = port.device
                    break
                    
            if not mcu_port:
                await websocket.send_json({"type": "stderr", "data": "[error] RP2350 device not found. Please connect the device.\n"})
                await websocket.close()
                return
                
            # 3. Interrupt MCU by sending Ctrl+C
            await websocket.send_json({"type": "stdout", "data": f">> Interrupting MCU on {mcu_port}...\n"})
            try:
                import serial
                with serial.Serial(mcu_port, 115200, timeout=0.5) as ser:
                    ser.write(b'\x03')
                    time.sleep(0.1)
                    ser.write(b'\x03')
                    time.sleep(0.3)
                await websocket.send_json({"type": "stdout", "data": ">> MCU interrupted, ready.\n"})
            except Exception as e:
                await websocket.send_json({"type": "stdout", "data": f"[warn] Could not send Ctrl+C: {str(e)}\n"})
                
            # 4. Run the code using async subprocess
            proj_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            python_exe = os.path.join(proj_root, ".venv", "Scripts", "python.exe") if os.name == 'nt' else os.path.join(proj_root, ".venv", "bin", "python")
            if not os.path.exists(python_exe):
                python_exe = sys.executable
                
            cmd = [python_exe, "-m", "mpremote", "connect", mcu_port, "exec", code_to_run]
            
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            
            async def read_stream(stream, msg_type):
                try:
                    while True:
                        line = await stream.readline()
                        if not line:
                            break
                        decoded = line.decode('utf-8', errors='replace')
                        await websocket.send_json({"type": msg_type, "data": decoded})
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    try:
                        await websocket.send_json({"type": "stderr", "data": f"[error] Stream read error: {str(e)}\n"})
                    except:
                        pass
                        
            stdout_task = asyncio.create_task(read_stream(proc.stdout, "stdout"))
            stderr_task = asyncio.create_task(read_stream(proc.stderr, "stderr"))
            
            try:
                await asyncio.wait_for(proc.wait(), timeout=float(timeout_val))
                await asyncio.sleep(0.1)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "stderr", "data": f"\n>> [TIMEOUT] Connection closed after {timeout_val}s (Script may still be running on MCU)\n"})
                if proc:
                    try:
                        if os.name == 'nt':
                            subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], creationflags=subprocess.CREATE_NO_WINDOW)
                        else:
                            proc.kill()
                    except:
                        pass
            finally:
                stdout_task.cancel()
                stderr_task.cancel()
                
            await websocket.send_json({"type": "status", "data": "done"})
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "stderr", "data": f"[error] Execution failed: {str(e)}\n"})
        except:
            pass
    finally:
        if proc:
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    proc.kill()
            except:
                pass
        try:
            await websocket.close()
        except:
            pass


# --- MCU Filesystem Endpoints ---


import os
import json
import subprocess
import shutil
import time
from pathlib import Path
from fastapi import HTTPException, Query
from pydantic import BaseModel
import serial.tools.list_ports

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCK_FILE = Path(os.path.join(PROJECT_ROOT, ".mount.lock"))
LOG_FILE = Path(os.path.join(PROJECT_ROOT, ".mount.log"))
CREATIONFLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

CONFIG_PATH = os.path.abspath(os.path.join(PROJECT_ROOT, "data", "system_config.json"))

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r') as f:
                return json.load(f)
        except:
            pass
    return {}

def save_config(config):
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=4)
    except:
        pass

def get_local_path():
    config = load_config()
    path_str = config.get("xip_local_path")
    if path_str and os.path.exists(path_str):
        return path_str
    mcu_path = os.path.abspath(os.path.join(PROJECT_ROOT, "mcu"))
    if not os.path.exists(mcu_path):
        os.makedirs(mcu_path, exist_ok=True)
    return mcu_path

def is_process_running(pid):
    try:
        output = subprocess.check_output(['tasklist', '/FI', f'PID eq {pid}'], stderr=subprocess.STDOUT, creationflags=CREATIONFLAGS)
        return str(pid) in output.decode()
    except:
        return False

def get_mount_pid():
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            if is_process_running(pid):
                return pid
            else:
                LOCK_FILE.unlink(missing_ok=True)
        except:
            LOCK_FILE.unlink(missing_ok=True)
    return None

def is_mounted():
    return get_mount_pid() is not None

def start_mount(local_path):
    if is_mounted():
        return False
    python_exe = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe") if os.name == 'nt' else os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
    if not os.path.exists(python_exe):
        python_exe = sys.executable
    cmd = [python_exe, "-m", "mpremote", "mount", str(local_path)]
    try:
        log_handle = open(LOG_FILE, "w")
        proc = subprocess.Popen(cmd, creationflags=CREATIONFLAGS, stdout=log_handle, stderr=subprocess.STDOUT)
        LOCK_FILE.write_text(str(proc.pid))
        return True
    except Exception as e:
        print(f"Mount Error: {e}")
        return False

def stop_mount():
    pid = get_mount_pid()
    if pid:
        try:
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)], creationflags=CREATIONFLAGS)
        except:
            pass
    if LOCK_FILE.exists():
        LOCK_FILE.unlink(missing_ok=True)

def is_rp2350_connected() -> bool:
    try:
        for port in serial.tools.list_ports.comports():
            desc = (port.description or "").upper()
            mfr  = (port.manufacturer or "").upper()
            if "RP2" in desc or "RP2" in mfr or port.vid == 0x2E8A:
                return True
    except Exception:
        pass
    return False

def run_mpremote(args, timeout=20.0, soft_reset=False):
    python_exe = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe") if os.name == 'nt' else os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
    if not os.path.exists(python_exe):
        python_exe = sys.executable
        
    if soft_reset:
        subprocess.run([python_exe, "-m", "mpremote", "soft-reset"], capture_output=True, creationflags=CREATIONFLAGS)
        time.sleep(0.5)

    cmd = [python_exe, "-m", "mpremote"] + args
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            res = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=CREATIONFLAGS)
            stdout = res.stdout.decode('utf-8', errors='replace')
            stderr = res.stderr.decode('utf-8', errors='replace')
            if "could not enter raw repl" in stderr.lower() or "failed to access" in stderr.lower():
                time.sleep(1.0)
                continue
            return res.returncode, stdout, stderr
        except subprocess.TimeoutExpired:
            return -1, "", "Timeout: MCU did not respond."
        except Exception as e:
            return -2, "", str(e)
    return -3, "", "Failed to enter Raw REPL after retries."

def fetch_capacity():
    rc, out, _ = run_mpremote(["exec", "import os; s=os.statvfs('/'); print(f'{s[0]},{s[2]},{s[3]}')"], timeout=5.0)
    if rc == 0 and out and out.strip():
        try:
            parts = out.strip().split(',')
            if len(parts) == 3:
                bsize, tb, fb = int(parts[0]), int(parts[1]), int(parts[2])
                total = bsize * tb
                free  = bsize * fb
                return {"total": total, "used": total - free, "free": free}
        except:
            pass
    return None

MCU_WALK_SCRIPT = """
import os, json
def walk(p):
    out = []
    try:
        for f in os.ilistdir(p):
            n, t = f[0], f[1]
            s = f[3] if len(f) > 3 else 0
            cp = (p + '/' + n) if p != '/' else ('/' + n)
            out.append({'n': n, 't': 'dir' if t == 0x4000 else 'file', 's': 0 if t == 0x4000 else s, 'c': walk(cp) if t == 0x4000 else []})
    except: pass
    return out
print(json.dumps(walk('/')))
"""

def build_local_tree(base_path: str):
    nodes = []
    try:
        entries = sorted(Path(base_path).iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    except PermissionError:
        return nodes
    for entry in entries:
        if entry.name.startswith('.'): continue
        if entry.is_dir():
            nodes.append({"name": entry.name, "type": "dir", "size": 0, "children": build_local_tree(str(entry))})
        else:
            nodes.append({"name": entry.name, "type": "file", "size": entry.stat().st_size, "children": []})
    return nodes

def flatten_nodes(nodes, prefix=""):
    result = {}
    for node in nodes:
        path = f"{prefix}/{node['name']}".strip("/")
        if node['type'] == 'file':
            result[path] = node['size']
        elif node['type'] == 'dir':
            result.update(flatten_nodes(node.get('children', []), path))
    return result

@app.get("/api/mcufs/status")
def get_mcufs_status():
    connected = is_rp2350_connected()
    mounted = is_mounted()
    local_path = get_local_path()
    
    capacity = None
    if connected and not mounted:
        capacity = fetch_capacity()
        
    return {
        "status": "success",
        "connected": connected,
        "mounted": mounted,
        "local_path": local_path,
        "capacity": capacity
    }

class PathConfig(BaseModel):
    path: str

@app.post("/api/mcufs/set_path")
def set_local_path(config: PathConfig):
    if not os.path.exists(config.path):
        try:
            os.makedirs(config.path, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid path: {str(e)}")
    
    cfg = load_config()
    cfg["xip_local_path"] = config.path
    save_config(cfg)
    return {"status": "success", "local_path": config.path}

@app.post("/api/mcufs/open_folder")
def open_folder():
    local_path = get_local_path()
    try:
        if os.name == 'nt':
            os.startfile(local_path)
        else:
            subprocess.run(['xdg-open', local_path])
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mcufs/mount")
def mcufs_mount():
    local_path = get_local_path()
    success = start_mount(local_path)
    if success:
        return {"status": "success", "message": "Mounted virtual drive successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to mount virtual drive")

@app.post("/api/mcufs/unmount")
def mcufs_unmount():
    stop_mount()
    return {"status": "success", "message": "Unmounted virtual drive"}

@app.get("/api/mcufs/list_local")
def get_list_local():
    local_path = get_local_path()
    tree = build_local_tree(local_path)
    return {"status": "success", "tree": tree, "local_path": local_path}

@app.get("/api/mcufs/list_mcu")
def get_list_mcu():
    if is_mounted():
        return {"status": "success", "tree": [], "message": "Device is mounted, MCU files are mirrored locally."}
    if not is_rp2350_connected():
        raise HTTPException(status_code=400, detail="Device offline")
        
    rc, out, err = run_mpremote(["exec", MCU_WALK_SCRIPT])
    if rc != 0 or not out.strip():
        raise HTTPException(status_code=500, detail=f"Failed to list MCU files: {err}")
        
    try:
        raw = json.loads(out.strip())
        def _convert(node_list):
            result = []
            for n in sorted(node_list, key=lambda x: (x['t'] != 'dir', x['n'].lower())):
                result.append({
                    "name": n['n'],
                    "type": n['t'],
                    "size": n.get('s', 0),
                    "children": _convert(n.get('c', []))
                })
            return result
        tree = _convert(raw)
        return {"status": "success", "tree": tree}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse MCU tree: {str(e)}")

@app.post("/api/mcufs/push")
def mcufs_push():
    if is_mounted():
        raise HTTPException(status_code=400, detail="Cannot push while mounted")
    if not is_rp2350_connected():
        raise HTTPException(status_code=400, detail="Device offline")
        
    local_path = get_local_path()
    local_nodes = build_local_tree(local_path)
    
    rc, out, err = run_mpremote(["exec", MCU_WALK_SCRIPT])
    mcu_nodes = []
    if rc == 0 and out.strip():
        try:
            raw = json.loads(out.strip())
            def _convert(node_list):
                result = []
                for n in node_list:
                    result.append({
                        "name": n['n'],
                        "type": n['t'],
                        "size": n.get('s', 0),
                        "children": _convert(n.get('c', []))
                    })
                return result
            mcu_nodes = _convert(raw)
        except:
            pass
            
    local_map = flatten_nodes(local_nodes)
    mcu_map = flatten_nodes(mcu_nodes)
    
    to_delete = [p for p in mcu_map if p not in local_map]
    if to_delete:
        delete_script = f"import os; r=lambda d: ([r(d+'/'+f[0]) for f in os.ilistdir(d) if f[1]==0x4000], [os.remove(d+'/'+f[0]) for f in os.ilistdir(d) if f[1]!=0x4000], os.rmdir(d)); [r('/'+p) if (os.stat('/'+p)[0]&0x4000) else os.remove('/'+p) for p in {json.dumps(to_delete)}]"
        run_mpremote(["exec", delete_script], soft_reset=True)
        
    local_pattern = str(Path(local_path)).replace("\\", "/") + "/."
    rc, out, err = run_mpremote(["fs", "cp", "-r", local_pattern, ":/"], timeout=180.0, soft_reset=True)
    if rc == 0:
        return {"status": "success", "message": "Successfully pushed/mirrored files to MCU."}
    else:
        raise HTTPException(status_code=500, detail=f"Push failed: {err}")

@app.post("/api/mcufs/pull")
def mcufs_pull():
    if is_mounted():
        raise HTTPException(status_code=400, detail="Cannot pull while mounted")
    if not is_rp2350_connected():
        raise HTTPException(status_code=400, detail="Device offline")
        
    local_path = get_local_path()
    local_base = Path(local_path)
    
    rc, out, err = run_mpremote(["fs", "cp", "-r", ":.", str(local_base).replace("\\", "/")], timeout=300.0, soft_reset=True)
    if rc == 0:
        return {"status": "success", "message": "Successfully pulled files from MCU."}
    else:
        raise HTTPException(status_code=500, detail=f"Pull failed: {err}")

@app.post("/api/mcufs/format")
def mcufs_format():
    if is_mounted():
        raise HTTPException(status_code=400, detail="Cannot format while mounted")
    if not is_rp2350_connected():
        raise HTTPException(status_code=400, detail="Device offline")
        
    format_script = "import os\ndef r(d):\n try:\n  if os.stat(d)[0]&0x4000:\n   for f in os.ilistdir(d): r(d+'/'+f[0])\n   if d!='/': os.rmdir(d)\n  else: os.remove(d)\n except: pass\nr('/')"
    rc, out, err = run_mpremote(["exec", format_script], timeout=60.0, soft_reset=True)
    if rc == 0:
        return {"status": "success", "message": "MCU Flash formatted thoroughly."}
    else:
        raise HTTPException(status_code=500, detail=f"Format failed: {err}")

class DeleteItems(BaseModel):
    local_files: list = []
    mcu_files: list = []

@app.post("/api/mcufs/delete")
def mcufs_delete(items: DeleteItems):
    local_path = get_local_path()
    local_base = Path(local_path)
    
    deleted_local = []
    for rel_path in items.local_files:
        target_path = local_base / rel_path
        if target_path.exists():
            try:
                if target_path.is_dir():
                    shutil.rmtree(target_path, ignore_errors=True)
                else:
                    target_path.unlink(missing_ok=True)
                deleted_local.append(rel_path)
            except Exception as e:
                print(f"Failed to delete local {rel_path}: {e}")
                
    deleted_mcu = []
    if items.mcu_files:
        if is_mounted():
            raise HTTPException(status_code=400, detail="Cannot delete from MCU directly while mounted")
        if not is_rp2350_connected():
            raise HTTPException(status_code=400, detail="Device offline for MCU delete")
            
        paths_json = json.dumps(items.mcu_files)
        delete_script = f"""
import os, json
def rm_rf(d):
    try:
        if (os.stat(d)[0] & 0x4000):
            for f in os.ilistdir(d): rm_rf(d + '/' + f[0])
            os.rmdir(d)
        else: os.remove(d)
    except: pass
for p in {paths_json}: rm_rf('/' + p)
"""
        rc, out, err = run_mpremote(["exec", delete_script])
        if rc == 0:
            deleted_mcu = items.mcu_files
        else:
            raise HTTPException(status_code=500, detail=f"MCU delete failed: {err}")
            
    return {"status": "success", "deleted_local": deleted_local, "deleted_mcu": deleted_mcu}

@app.post("/api/mcufs/vdisk_reset")
def mcufs_vdisk_reset():
    if is_mounted():
        raise HTTPException(status_code=400, detail="Cannot reset while mounted")
    run_mpremote(["exec", "import machine; machine.bootloader()"], timeout=2.0)
    return {"status": "success", "message": "MCU rebooted into BOOTSEL mode."}

@app.post("/api/mcufs/mcu_reset")
def mcufs_mcu_reset():
    if is_mounted():
        raise HTTPException(status_code=400, detail="Cannot reset while mounted")
    run_mpremote(["exec", "import machine; machine.reset()"], timeout=2.0)
    return {"status": "success", "message": "MCU reset performed."}

@app.get("/api/mcufs/view_file")
def mcufs_view_file(path: str = Query(...), is_mcu: bool = Query(False)):
    local_path = get_local_path()
    target_file = None
    temp_path = None
    
    try:
        if is_mcu:
            if is_mounted():
                raise HTTPException(status_code=400, detail="Cannot view MCU files directly while mounted")
            if not is_rp2350_connected():
                raise HTTPException(status_code=400, detail="Device offline")
            temp_path = Path(os.path.join(PROJECT_ROOT, "mcu_temp_preview.tmp"))
            rc, out, err = run_mpremote(["fs", "cp", ":" + path, str(temp_path)])
            if rc != 0:
                raise HTTPException(status_code=500, detail=f"Failed to fetch file from MCU: {err}")
            target_file = temp_path
        else:
            target_file = Path(local_path) / path
            if not target_file.exists():
                raise HTTPException(status_code=404, detail="File not found")
                
        with open(target_file, "rb") as f:
            content = f.read()
            
        is_text = False
        text_content = ""
        try:
            text_content = content.decode('utf-8')
            is_text = True
        except UnicodeDecodeError:
            pass
            
        import base64
        return {
            "status": "success",
            "is_text": is_text,
            "content": text_content if is_text else base64.b64encode(content).decode('utf-8'),
            "filename": os.path.basename(path)
        }
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except:
                pass

def monitor_parent_process():

    """Monitors the parent process (Electron) and exits if it dies or is terminated."""
    import os
    import time
    import psutil
    
    parent_pid = os.getppid()
    if parent_pid <= 1:
        return
        
    try:
        parent = psutil.Process(parent_pid)
        parent_create_time = parent.create_time()
    except Exception:
        print("[Python Monitor] Parent process already terminated. Exiting.", flush=True)
        os._exit(0)
        
    while True:
        time.sleep(1)
        try:
            current_parent = psutil.Process(parent_pid)
            if current_parent.create_time() != parent_create_time or not current_parent.is_running():
                print("[Python Monitor] Parent process changed or terminated. Exiting.", flush=True)
                os._exit(0)
        except Exception:
            print("[Python Monitor] Exception checking parent process status. Exiting.", flush=True)
            os._exit(0)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="nanoPD Pro Backend Server")
    parser.add_argument("--port", type=int, default=9000, help="Port to run the FastAPI app")
    args = parser.parse_args()

    # Flush stdout immediately so Electron receives startup logs in real-time
    print(f"[Python] Initializing uvicorn server on port {args.port}...", flush=True)
    
    # Start parent process monitor thread
    import threading
    monitor_thread = threading.Thread(target=monitor_parent_process, daemon=True)
    monitor_thread.start()
    
    # Run server locally on localhost
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")

