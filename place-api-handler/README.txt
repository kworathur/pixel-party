# To start the websockets server 
npm start

# Open up a few windows with 
wscat -c "ws://127.0.0.1:8081"

# Make a valid update to the board, boradcasted to all clients
# {"x": 0, "y": 2, "r": 255, "g": 255, "b": 255}

# Try again before cooldown 

# out of bounds 
# {"x": 256, "y": 0, "r": 255, "g", 255, "b": 255}

# invalid RGB combination 
# {"x": 0, "y": 2, "r": 255, "g": 255, "b": 255}