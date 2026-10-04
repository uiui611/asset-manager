param([string]$Context = 'kubernetes-admin@kubernetes')
$ErrorActionPreference = 'Stop'
$taskKubectl = (Get-Command kubectl -ErrorAction Stop).Source
if ((& $taskKubectl config current-context) -ne $Context) { throw 'Unexpected kubectl context' }
# This script initializes only the new application database and Secret, not existing services.
$existingSecret = & $taskKubectl --context $Context -n default get secret asset-manager-credentials --ignore-not-found -o json
if ($existingSecret) { throw 'Credentials already exist; use existing Secret and inspect DB state before rerunning.' }
$taskPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$taskAccessKey = 'assetmanager' + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(6)).ToLowerInvariant()
$taskSecretKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(20)).ToLowerInvariant()
$taskSql = "CREATE ROLE asset_manager_owner NOLOGIN;`nCREATE ROLE asset_manager_app LOGIN PASSWORD '$taskPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;`nCREATE DATABASE asset_manager OWNER asset_manager_owner;`nREVOKE ALL ON DATABASE asset_manager FROM PUBLIC;`nGRANT CONNECT ON DATABASE asset_manager TO asset_manager_app;"
$taskSql | & $taskKubectl --context $Context -n default exec -i yb-tserver-0 -c yb-tserver -- /home/yugabyte/bin/ysqlsh -h 127.0.0.1 -U yugabyte -d yugabyte -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {throw 'DB bootstrap failed; inspect created resources before retry'}
$taskSchema = "SET ROLE asset_manager_owner;`n" + (Get-Content -Raw "$PSScriptRoot/../backend/schema.sql") + "`nGRANT USAGE ON SCHEMA public TO asset_manager_app;`nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO asset_manager_app;"
$taskSchema | & $taskKubectl --context $Context -n default exec -i yb-tserver-0 -c yb-tserver -- /home/yugabyte/bin/ysqlsh -h 127.0.0.1 -U yugabyte -d asset_manager -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {throw 'Schema initialization failed'}
$taskResource = @{apiVersion='v1';kind='Secret';metadata=@{name='asset-manager-credentials';namespace='default'};type='Opaque';stringData=@{DATABASE_URL="host=yb-tservers.default.svc.cluster.local port=5433 user=asset_manager_app password=$taskPassword dbname=asset_manager";S3_ACCESS_KEY=$taskAccessKey;S3_SECRET_KEY=$taskSecretKey}}
$taskResource | ConvertTo-Json -Depth 5 -Compress | & $taskKubectl --context $Context -n default create -f -
if ($LASTEXITCODE -ne 0) {throw 'Secret creation failed'}

