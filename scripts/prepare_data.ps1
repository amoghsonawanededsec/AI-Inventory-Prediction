$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Copy-Item -LiteralPath (Join-Path $root 'promte\chatbot_training_dataset.txt') -Destination (Join-Path $root 'data\chatbot_training_dataset.txt') -Force
Copy-Item -LiteralPath (Join-Path $root 'promte\chatbot_benchmark (1).csv') -Destination (Join-Path $root 'data\chatbot_benchmark.csv') -Force
Write-Host 'Training dataset and held-out benchmark copied to data/.'
