from flask import Flask, request, jsonify
from pyngrok import ngrok
import uuid

app = Flask(__name__)
# run_with_ngrok(app)  # Removed in favor of pyngrok

@app.route("/")
def home():
    return "<h1>DrawMatrix CAD Engine - Run with flask-ngrok</h1>"

@app.route("/generate", methods=["POST"])
def generate():
    data = request.json
    prompt = data.get("prompt", "")
    layer_id = data.get("layerId", "0")

    print(f"Generating for prompt: {prompt}")

    # Mock response with a single wall
    # This simulates a CAD engine returning objects based on an AI prompt
    objects = [
        {
            "id": str(uuid.uuid4()),
            "type": "wall",
            "layerId": layer_id,
            "transform": {
                "position": [0, 1.4, 0],
                "rotation": [0, 0, 0, 1],
                "scale": [1, 1, 1],
            },
            "properties": {
                "width": 5.0,
                "height": 2.8,
                "thickness": 0.2,
                "wallName": "Main Wall",
                "material": "concrete"
            },
            "color": "#4a4a4a"
        }
    ]

    return jsonify({"objects": objects})

if __name__ == "__main__":
    # Expose port 5000 via ngrok
    # If the user has an authtoken, they can set it via:
    # ngrok.set_auth_token("YOUR_AUTHTOKEN")
    public_url = ngrok.connect(5000).public_url
    print(f" * ngrok tunnel available at: {public_url}")
    
    # Save URL to a file for easy retrieval by the agent
    with open("ngrok_url.txt", "w") as f:
        f.write(public_url)
        
    app.run(port=5000)
