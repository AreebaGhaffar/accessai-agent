$credsOutput = aws configure export-credentials --format env-no-export --profile default
foreach ($line in $credsOutput) {
    if ($line -match '^(AWS_\w+)=(.+)$') {
        $varName = $Matches[1]
        $varValue = $Matches[2]
        [System.Environment]::SetEnvironmentVariable($varName, $varValue, "Process")
    }
}
& ".venv\Scripts\python.exe" "test_bedrock.py"
