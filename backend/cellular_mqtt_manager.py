"""
Cellular MQTT Manager
Utility functions to manage AT configuration sequences and parsing for the 4G DTU.
"""
import time
import serial

def safe_int(val, default=0):
    """Safely convert a value to an integer, removing quotes if present."""
    try:
        if isinstance(val, str):
            val = val.strip().strip('"')
        return int(val)
    except (ValueError, TypeError):
        return default

def calculate_crc16(data: bytes) -> bytes:
    """Calculate Modbus RTU CRC-16 (Polynomial: 0xA001, Initial: 0xFFFF)"""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc = crc >> 1
    # Returns CRC bytes in Low-Byte, High-Byte order
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])

def _send_and_wait(ser, data: bytes, wait: float = 1.0, log_cb=None) -> bytes:
    """Sends bytes to the serial port, waits for response, and logs TX/RX."""
    ser.reset_input_buffer()
    if data and log_cb:
        log_cb("TX", data)
        
    ser.write(data)
    ser.flush()
    
    deadline = time.time() + wait
    buf = bytearray()
    last_t = None
    
    while time.time() < deadline:
        w = ser.in_waiting
        if w > 0:
            buf.extend(ser.read(w))
            last_t = time.time()
        elif last_t and (time.time() - last_t) > 0.2:
            break
        time.sleep(0.01)
        
    if buf and log_cb:
        # Split lines for readable rendering in the console
        for line in buf.replace(b'\r', b'').split(b'\n'):
            if line:
                log_cb("RX", bytes(line))
                
    return bytes(buf)

def enter_at_mode(ser, log_cb=None) -> bool:
    """Enters AT mode using ATK escape sequence."""
    if log_cb:
        log_cb("SYS", "[System] Entering AT Command Mode...")
    
    # 1. Pre-sequence guard silence
    time.sleep(1.1)
    ser.reset_input_buffer()
    
    # 2. Write escape sequence
    ser.write(b"+++")
    ser.flush()
    if log_cb:
        log_cb("TX", b"+++")
        
    # 3. Post-sequence guard silence (wait for DTU to process escape and respond)
    time.sleep(1.1)
    
    rx = bytearray()
    deadline = time.time() + 0.5
    while time.time() < deadline:
        w = ser.in_waiting
        if w > 0:
            rx.extend(ser.read(w))
        time.sleep(0.01)
        
    if rx and log_cb:
        log_cb("RX", bytes(rx))
        
    if b'atk' in rx.lower():
        ser.write(b'ATK')
        ser.flush()
        if log_cb:
            log_cb("TX", b"ATK")
        time.sleep(0.5)
        
        rx2 = bytearray()
        deadline2 = time.time() + 0.5
        while time.time() < deadline2:
            w = ser.in_waiting
            if w > 0:
                rx2.extend(ser.read(w))
            time.sleep(0.01)
            
        if rx2 and log_cb:
            log_cb("RX", bytes(rx2))
            if b'ERROR' in rx2.upper():
                return False
        return True
    else:
        # Try checking if already in AT mode
        resp = _send_and_wait(ser, b'AT\r\n', 1.0, log_cb)
        return b'OK' in resp.upper()

def exit_at_mode(ser, save_restart: bool = False, log_cb=None):
    """Exits AT mode by restarting (AT+PWR) or returns to transparent mode (ATO)."""
    if save_restart:
        if log_cb:
            log_cb("SYS", "[System] Restarting module to apply changes...")
        _send_and_wait(ser, b'AT+PWR\r\n', 1.5, log_cb)
    else:
        if log_cb:
            log_cb("SYS", "[System] Returning to transparent communication mode...")
        _send_and_wait(ser, b'ATO\r\n', 1.0, log_cb)

def parse_slot_response(resp_bytes, prefix):
    """Parse comma-separated values from a response line matching a prefix."""
    try:
        text = resp_bytes.decode('utf-8', errors='replace')
    except Exception:
        return None
        
    for line in text.splitlines():
        line = line.strip()
        if line.upper().startswith(prefix.upper()):
            payload = line.split(":", 1)[1].strip()
            # Quote-aware parsing
            parts = []
            current = ""
            in_quotes = False
            for ch in payload:
                if ch == '"':
                    in_quotes = not in_quotes
                elif ch == ',' and not in_quotes:
                    parts.append(current.strip().strip('"'))
                    current = ""
                    continue
                current += ch
            parts.append(current.strip().strip('"'))
            return parts
    return None

def read_hw_state(ser, log_cb=None) -> dict:
    """Reads all current settings from the DTU hardware."""
    state = {}
    
    # 1. Read UART configuration
    resp = _send_and_wait(ser, b'AT+UART\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+UART")
    if parsed and len(parsed) >= 4:
        state["uart"] = {
            "baud": safe_int(parsed[0], 115200),
            "stop": parsed[1],
            "data": safe_int(parsed[2], 8),
            "parity": parsed[3]
        }
        
    # 2. Read Work Mode
    resp = _send_and_wait(ser, b'AT+WORK\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+WORK")
    if parsed:
        state["work_mode"] = parsed[0].upper()
        
    # 3. Read MQTT Connection Broker IP & Client Details
    resp = _send_and_wait(ser, b'AT+MQTTIP\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTIP")
    if parsed and len(parsed) >= 2:
        state["mqtt_ip"] = parsed[0]
        state["mqtt_port"] = parsed[1]
        
    # Read client details
    resp = _send_and_wait(ser, b'AT+MQTTCD\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTCD")
    if parsed:
        state["mqtt_cid"] = parsed[0]
        
    resp = _send_and_wait(ser, b'AT+MQTTUN\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTUN")
    if parsed:
        state["mqtt_user"] = parsed[0]
        
    resp = _send_and_wait(ser, b'AT+MQTTPW\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTPW")
    if parsed:
        state["mqtt_pwd"] = parsed[0]

    # Detect query syntax (AT+MQTTSUB1 vs AT+MQTTSUB1?)
    test_resp = _send_and_wait(ser, b"AT+MQTTSUB1\r\n", 1.0, log_cb)
    query_suffix = ""
    if b"ERROR" in test_resp.upper():
        query_suffix = "?"

    # 4. Read Subscription Slots (1-4)
    subs = []
    for i in range(1, 5):
        if i == 1 and query_suffix == "" and b"ERROR" not in test_resp.upper():
            resp = test_resp
        else:
            resp = _send_and_wait(ser, f"AT+MQTTSUB{i}{query_suffix}\r\n".encode('utf-8'), 1.0, log_cb)
        parsed = parse_slot_response(resp, f"+MQTTSUB{i}")
        if parsed and len(parsed) >= 3:
            subs.append({
                "slot": i,
                "en": parsed[0] == "1",
                "topic": parsed[1],
                "qos": safe_int(parsed[2], 0)
            })
    state["subs"] = subs

    # 5. Read Publishing Slots (1-4)
    pubs = []
    for i in range(1, 5):
        resp = _send_and_wait(ser, f"AT+MQTTPUB{i}{query_suffix}\r\n".encode('utf-8'), 1.0, log_cb)
        parsed = parse_slot_response(resp, f"+MQTTPUB{i}")
        if parsed and len(parsed) >= 4:
            pubs.append({
                "slot": i,
                "en": parsed[0] == "1",
                "topic": parsed[1],
                "qos": safe_int(parsed[2], 0),
                "retain": parsed[3] == "1"
            })
    state["pubs"] = pubs

    # 6. Read Will (LWT)
    resp = _send_and_wait(ser, b'AT+MQTTWILL\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTWILL")
    if parsed and len(parsed) >= 5:
        state["will"] = {
            "en": parsed[0] == "1",
            "topic": parsed[1],
            "msg": parsed[2],
            "qos": safe_int(parsed[3], 0),
            "retain": parsed[4] == "1"
        }

    # 7. Read MQTT Connection KeepAlive / CleanSession
    resp = _send_and_wait(ser, b'AT+MQTTCON\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTCON")
    if parsed and len(parsed) >= 2:
        state["clean_session"] = parsed[0] == "1"
        state["keep_alive"] = safe_int(parsed[1], 60)

    # 8. Read Polling parameters
    resp = _send_and_wait(ser, b'AT+TASKMD\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+TASKMD")
    if parsed:
        val = parsed[0].upper()
        state["task_mode"] = "MODBUS" if val == "USER" else val

    resp = _send_and_wait(ser, b'AT+TASKTIME\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+TASKTIME")
    if parsed and len(parsed) >= 2:
        state["task_cycle"] = safe_int(parsed[0], 1)
        state["task_interval"] = safe_int(parsed[1], 100)

    resp = _send_and_wait(ser, b'AT+MQTTDIST\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+MQTTDIST")
    if parsed and len(parsed) >= 2:
        state["enable_identifier"] = parsed[0] == "1"
        state["identifier_format"] = parsed[1]

    # Also read TASKDIST (outgoing identifier); if available, it overrides MQTTDIST
    # since the UI uses a single shared identifier setting for both directions.
    resp = _send_and_wait(ser, b'AT+TASKDIST\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+TASKDIST")
    if parsed and len(parsed) >= 2:
        state["enable_identifier"] = parsed[0] == "1"
        state["identifier_format"] = parsed[1]


    # 9. Read Polling script commands
    resp = _send_and_wait(ser, b'AT+TRANSPOLLNUM\r\n', 1.0, log_cb)
    parsed = parse_slot_response(resp, "+TRANSPOLLNUM")
    num_commands = 0
    if parsed:
        try:
            num_commands = int(parsed[0])
        except ValueError:
            pass
            
    polling_list = []
    if num_commands > 0:
        limit = min(num_commands, 20)
        for i in range(1, limit + 1):
            cmd_resp = _send_and_wait(ser, f"AT+TRANSCMD{i}\r\n".encode('utf-8'), 0.5, log_cb)
            c_parsed = parse_slot_response(cmd_resp, f"+TRANSCMD{i}")
            if c_parsed and len(c_parsed) >= 1:
                cmd_val = c_parsed[0]
                if cmd_val and cmd_val.lower() not in ["none", "nan", "error"]:
                    polling_list.append({"Index": str(i), "Command": cmd_val})
    state["polling_list"] = polling_list

    # 10. Read network parameters
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
        resp = _send_and_wait(ser, cmd, 1.0, log_cb)
        parsed = parse_slot_response(resp, prefix)
        if parsed:
            net_info[key] = parsed[0]
    state["network_info"] = net_info

    return state

def apply_work_mode(ser, log_cb, mode, ip, port, cid, user, pwd):
    """Apply DTU work mode and MQTT connection details."""
    _send_and_wait(ser, f'AT+WORK="{mode}"\r\n'.encode('utf-8'), 1.0, log_cb)
    time.sleep(0.3)
    if mode == "MQTT":
        if ip and port:
            _send_and_wait(ser, f'AT+MQTTIP="{ip}","{port}"\r\n'.encode('utf-8'), 1.0, log_cb)
            time.sleep(0.2)
        if cid:
            _send_and_wait(ser, f'AT+MQTTCD="{cid}"\r\n'.encode('utf-8'), 1.0, log_cb)
            time.sleep(0.2)
        if user is not None:
            _send_and_wait(ser, f'AT+MQTTUN="{user}"\r\n'.encode('utf-8'), 1.0, log_cb)
            time.sleep(0.2)
        if pwd is not None:
            _send_and_wait(ser, f'AT+MQTTPW="{pwd}"\r\n'.encode('utf-8'), 1.0, log_cb)
            time.sleep(0.2)

def apply_subs(ser, log_cb, subs):
    """Apply subscription slots (subs is a list of dicts with keys topic, qos, en)."""
    for i, sub in enumerate(subs):
        slot = i + 1
        en_str = "1" if sub.get("en") else "0"
        topic = sub.get("topic", "")
        qos = sub.get("qos", 0)
        _send_and_wait(ser, f'AT+MQTTSUB{slot}="{en_str}","{topic}","{qos}"\r\n'.encode('utf-8'), 1.0, log_cb)
        time.sleep(0.2)

def apply_pubs(ser, log_cb, pubs):
    """Apply publishing slots (pubs is a list of dicts with keys topic, qos, retain, en)."""
    for i, pub in enumerate(pubs):
        slot = i + 1
        en_str = "1" if pub.get("en") else "0"
        topic = pub.get("topic", "")
        qos = pub.get("qos", 0)
        ret_str = "1" if pub.get("retain") else "0"
        _send_and_wait(ser, f'AT+MQTTPUB{slot}="{en_str}","{topic}","{qos}","{ret_str}"\r\n'.encode('utf-8'), 1.0, log_cb)
        time.sleep(0.2)

def apply_will(ser, log_cb, en, topic, msg, qos, retain):
    """Apply Last Will and Testament configuration."""
    en_str = "1" if en else "0"
    ret_str = "1" if retain else "0"
    _send_and_wait(ser, f'AT+MQTTWILL="{en_str}","{topic}","{msg}","{qos}","{ret_str}"\r\n'.encode('utf-8'), 1.0, log_cb)

def apply_mqttcon(ser, log_cb, clean_session, keep_alive):
    """Apply clean session & keep alive parameters."""
    clean_str = "1" if clean_session else "0"
    _send_and_wait(ser, f'AT+MQTTCON="{clean_str}","{keep_alive}"\r\n'.encode('utf-8'), 1.0, log_cb)

def apply_uart(ser, log_cb, baud, stop, data, parity):
    """Apply DTU UART port configurations."""
    parity_str = str(parity).upper()
    _send_and_wait(ser, f'AT+UART="{baud}","{stop}","{data}","{parity_str}"\r\n'.encode('utf-8'), 1.0, log_cb)

def apply_polling(ser, log_cb, task_mode, cycle, interval, identifier_en, identifier_format, command_list):
    """Apply Modbus Polling parameters and task lists."""
    dtu_task_mode = "USER" if task_mode == "MODBUS" else task_mode
    _send_and_wait(ser, f'AT+TASKMD="{dtu_task_mode}"\r\n'.encode('utf-8'), 1.0, log_cb)
    time.sleep(0.2)
    
    # Configure advanced parameters to align with D60 configuration software steps
    _send_and_wait(ser, b'AT+MQTTFLT="OFF"\r\n', 1.0, log_cb)
    time.sleep(0.2)
    _send_and_wait(ser, b'AT+TASKDEV="D4X"\r\n', 1.0, log_cb)
    time.sleep(0.2)
    _send_and_wait(ser, b'AT+TASKCOMBNUM="20"\r\n', 1.0, log_cb)
    time.sleep(0.2)
    _send_and_wait(ser, b'AT+MODBUSPOLLNUM="0"\r\n', 1.0, log_cb)
    time.sleep(0.2)
    
    if cycle is not None and interval is not None:
        _send_and_wait(ser, f'AT+TASKTIME="{cycle}","{interval}"\r\n'.encode('utf-8'), 1.0, log_cb)
        time.sleep(0.2)
    
    iden_en_str = "1" if identifier_en else "0"
    
    # AT+MQTTDIST: Incoming identifier (DTU appends to messages IT receives from broker before passing to UART)
    # AT+TASKDIST: Outgoing identifier (DTU appends to messages IT sends to broker from UART/polling)
    # Both must be set in sync, as the original nanoPD reference implementation does.
    _send_and_wait(ser, f'AT+MQTTDIST="{iden_en_str}","{identifier_format}"\r\n'.encode('utf-8'), 1.0, log_cb)
    time.sleep(0.2)
    _send_and_wait(ser, f'AT+TASKDIST="{iden_en_str}","{identifier_format}"\r\n'.encode('utf-8'), 1.0, log_cb)
    time.sleep(0.2)
    
    # Write command counts
    num_cmds = len(command_list)
    _send_and_wait(ser, f'AT+TRANSPOLLNUM="{num_cmds}"\r\n'.encode('utf-8'), 1.0, log_cb)
    time.sleep(0.3)
    
    # Write command slot values
    for i, cmd in enumerate(command_list):
        slot = i + 1
        cmd_text = cmd.get("Command", "")
        _send_and_wait(ser, f'AT+TRANSCMD{slot}="{cmd_text}"\r\n'.encode('utf-8'), 1.0, log_cb)
        time.sleep(0.2)
