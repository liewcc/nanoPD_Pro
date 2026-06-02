import asyncio
import websockets
import json

async def mqtt_listener(mqtt_ws):
    print("[MQTT] Listening for messages...")
    try:
        async for message in mqtt_ws:
            data = json.loads(message)
            if data.get("type") == "msg":
                print(f"[MQTT RX] Topic: {data.get('topic')}, Payload: {data.get('payload')}")
            else:
                print(f"[MQTT STATUS/LOG] {data}")
    except Exception as e:
        print(f"[MQTT Listener Error] {e}")

async def cellular_listener(cell_ws):
    print("[Cellular] Listening for serial data...")
    try:
        async for message in cell_ws:
            data = json.loads(message)
            if data.get("type") == "data":
                print(f"[Cellular RX] Serial Data: {data.get('data')!r}")
            elif data.get("type") == "log":
                print(f"[Cellular LOG] {data.get('direction')}>> {data.get('message')}")
            else:
                print(f"[Cellular MSG] {data}")
    except Exception as e:
        print(f"[Cellular Listener Error] {e}")

async def main():
    mqtt_uri = "ws://127.0.0.1:9000/ws/mqtt?host=202.59.9.164&port=1883&cid=nanopd_mqtt_PC_client"
    cell_uri = "ws://127.0.0.1:9000/ws/cellular?port=COM6&baud=115200&bytesize=8&stopbits=1&parity=N"
    
    print("Connecting to Internet MQTT WebSocket...")
    try:
        mqtt_ws = await websockets.connect(mqtt_uri)
    except Exception as e:
        print(f"Failed to connect to MQTT WS: {e}. Is backend running on port 9000?")
        return
        
    print("Connecting to Cellular DTU WebSocket...")
    try:
        cell_ws = await websockets.connect(cell_uri)
    except Exception as e:
        print(f"Failed to connect to Cellular WS: {e}")
        await mqtt_ws.close()
        return

    # Start listener tasks
    mqtt_task = asyncio.create_task(mqtt_listener(mqtt_ws))
    cell_task = asyncio.create_task(cellular_listener(cell_ws))
    
    await asyncio.sleep(2)  # Wait for connections to stabilize
    
    # Subscribe to nanopd/dtu/tx on MQTT
    print("\n[Test] Subscribing MQTT client to 'nanopd/dtu/tx'...")
    await mqtt_ws.send(json.dumps({"action": "subscribe", "topic": "nanopd/dtu/tx", "qos": 1}))
    await asyncio.sleep(1)
    
    # 1. Test Cellular -> MQTT (DTU TX)
    print("\n[Test 1] Writing message to Cellular serial port (expecting it to publish to nanopd/dtu/tx)...")
    await cell_ws.send(json.dumps({"action": "write", "data": "Hello from Cellular Console", "hex": False}))
    await asyncio.sleep(4)
    
    # 2. Test MQTT -> Cellular (DTU RX)
    print("\n[Test 2] Publishing from MQTT client to 'nanopd/pc/tx' (expecting Cellular DTU to receive and output to serial)...")
    await mqtt_ws.send(json.dumps({
        "action": "publish",
        "topic": "nanopd/pc/tx",
        "payload": "Hello from MQTT Console",
        "qos": 0
    }))
    await asyncio.sleep(4)
    
    # Cleanup
    print("\nClosing connections...")
    mqtt_task.cancel()
    cell_task.cancel()
    await mqtt_ws.close()
    await cell_ws.close()

if __name__ == "__main__":
    asyncio.run(main())
