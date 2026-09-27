import subprocess
import json
import boto3
from botocore.credentials import RefreshableCredentials
from botocore.session import get_session

# Use the aws CLI to obtain temporary credentials from the browser-based login session.
# This works with any credential source that the AWS CLI supports (SSO, aws login, etc.)
result = subprocess.run(
    ["aws", "configure", "export-credentials", "--profile", "default"],
    capture_output=True, text=True, check=True
)
creds = json.loads(result.stdout)

session = boto3.Session(
    aws_access_key_id=creds["AccessKeyId"],
    aws_secret_access_key=creds["SecretAccessKey"],
    aws_session_token=creds.get("SessionToken"),
    region_name="us-east-1",
)

client = session.client("bedrock-runtime")

MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

response = client.converse(
    modelId=MODEL_ID,
    messages=[
        {
            "role": "user",
            "content": [{"text": "The user said: 'Open my browser and go to Gmail'. Respond ONLY with a JSON object with two fields: 'action' (one of: open_browser, click, type_text, scroll, read_screen) and 'target' (what to open/click/type, e.g. a URL or text). No explanation, just the JSON."}],
        }
    ],
    inferenceConfig={"maxTokens": 512},
)

# Extract and print the response text
reply = response["output"]["message"]["content"][0]["text"]
print(reply)
