Get-ChildItem -Path 'C:\Aplicaciones\mi-servidor-web-v2\logs' -Filter '*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
