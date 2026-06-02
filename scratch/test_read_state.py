import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

import serial
import time
import cellular_mqtt_manager

def log_cb(direction, msg):
    if isinstance(msg, bytes):
        msg = msg.decode('latin1', errors='replace')
    print(f"[{direction}] {msg}", flush=True)

def main():
    port = "COM6"
    baud = 115200
    try:
        ser = serial.Serial(port=port, baudrate=baud, timeout=0.1)
        print(f"Opened {port} successfully.", flush=True)
        
        # Enter AT mode
        success = cellular_mqtt_manager.enter_at_mode(ser, log_cb)
        print(f"Enter AT mode result: {success}", flush=True)
        
        if success:
            print("Reading HW state...", flush=True)
            state = cellular_mqtt_manager.read_hw_state(ser, log_cb)
            print("HW State successfully read!", flush=True)
            print(state, flush=True)
            
            # Exit AT mode
            cellular_mqtt_manager.exit_at_mode(ser, False, log_cb)
            print("Exited AT mode.", flush=True)
        ser.close()
    except Exception as e:
        print(f"Error: {e}", flush=True)

if __name__ == '__main__':
    main()
