import asyncio
import websockets
import json

async def test_client():
    uri = "ws://127.0.0.1:9000/ws/cellular?port=COM6&baud=115200&bytesize=8&stopbits=1&parity=N"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected successfully!")
            
            # Send provision command
            print("Sending provision action...")
            await websocket.send(json.dumps({"action": "provision"}))
            
            # Listen for responses
            while True:
                try:
                    message = await websocket.recv()
                    data = json.loads(message)
                    print(f"WS RECV: {data}")
                    if data.get("type") == "hw_state":
                        print("Sync complete, exiting test.")
                        break
                    if data.get("type") == "error":
                        print("Error received, exiting test.")
                        break
                except websockets.exceptions.ConnectionClosed as e:
                    print(f"Connection closed: {e}")
                    break
    except Exception as e:
        print(f"Client error: {e}")

if __name__ == "__main__":
    asyncio.run(test_client())
