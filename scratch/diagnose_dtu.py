import sys
import serial
import time

def sync_log_cb(direction, text_or_bytes):
    if isinstance(text_or_bytes, bytes):
        text = text_or_bytes.hex(' ').upper()
    else:
        text = str(text_or_bytes)
    print(f"{direction}>> {text}")

def enter_at_mode(ser):
    print("Entering AT Command Mode...")
    # 1. Pre-sequence guard silence
    time.sleep(1.1)
    ser.reset_input_buffer()
    
    # 2. Write escape sequence
    ser.write(b"+++")
    ser.flush()
    print("TX>> +++")
        
    # 3. Post-sequence guard silence
    time.sleep(1.1)
    
    rx = bytearray()
    if ser.in_waiting > 0:
        rx.extend(ser.read(ser.in_waiting))
    if rx:
        print(f"RX>> {rx.hex(' ').upper()} ({rx.decode('latin1', errors='replace')})")
        
    if b'atk' in rx.lower():
        ser.write(b'ATK')
        ser.flush()
        print("TX>> ATK")
        time.sleep(0.5)
        
        rx2 = bytearray()
        if ser.in_waiting > 0:
            rx2.extend(ser.read(ser.in_waiting))
        if rx2:
            print(f"RX2>> {rx2.hex(' ').upper()} ({rx2.decode('latin1', errors='replace')})")
            if b'ERROR' in rx2.upper():
                return False
        return True
    else:
        # Try checking if already in AT mode
        print("Not 'atk' in RX. Trying AT...")
        ser.reset_input_buffer()
        ser.write(b"AT\r\n")
        ser.flush()
        print("TX>> AT\\r\\n")
        time.sleep(1.0)
        rx3 = bytearray()
        if ser.in_waiting > 0:
            rx3.extend(ser.read(ser.in_waiting))
        if rx3:
            print(f"RX3>> {rx3.hex(' ').upper()} ({rx3.decode('latin1', errors='replace')})")
            return b'OK' in rx3.upper()
        return False

def main():
    port = "COM6"
    baud = 115200
    try:
        ser = serial.Serial(port=port, baudrate=baud, timeout=0.1)
        print(f"Opened {port} at {baud} baud successfully.")
        success = enter_at_mode(ser)
        print(f"Result: {success}")
        if success:
            # Query work mode
            ser.write(b"AT+WORK\r\n")
            ser.flush()
            time.sleep(0.5)
            rx = ser.read(ser.in_waiting)
            print(f"WORK MODE RESP: {rx.decode('latin1', errors='replace')}")
            # Exit
            ser.write(b"ATO\r\n")
            ser.flush()
            time.sleep(0.5)
            print("Exited AT mode.")
        ser.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    main()
