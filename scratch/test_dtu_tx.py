import time
import serial
import paho.mqtt.client as mqtt
import threading

broker = "202.59.9.164"
port = 1883
topic = "nanopd/dtu/tx"
com_port = "COM6"
baud = 115200

received_messages = []

def on_connect(client, userdata, flags, rc, properties=None):
    print("MQTT Connected")
    client.subscribe(topic)

def on_message(client, userdata, msg):
    payload = msg.payload.decode('utf-8', errors='replace')
    print(f"MQTT RX<< Topic: {msg.topic}, Payload: {payload}")
    received_messages.append(payload)

# Start MQTT Client in background
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message
client.connect(broker, port, 60)
client.loop_start()

time.sleep(2)  # Wait for MQTT connection

try:
    print(f"Opening serial port {com_port}...")
    ser = serial.Serial(com_port, baud, timeout=1)
    
    print("Sending message without CRLF: 'TestNoCRLF'")
    ser.write(b"TestNoCRLF")
    ser.flush()
    
    time.sleep(3)
    
    print("Sending message with LF: 'TestLF\\n'")
    ser.write(b"TestLF\n")
    ser.flush()
    
    time.sleep(3)
    
    print("Sending message with CRLF: 'TestCRLF\\r\\n'")
    ser.write(b"TestCRLF\r\n")
    ser.flush()
    
    time.sleep(5)
    
    print("Closing serial port...")
    ser.close()
except Exception as e:
    print(f"Serial Error: {e}")

client.loop_stop()
client.disconnect()

print("\n--- Summary of Received Messages ---")
print(received_messages)
