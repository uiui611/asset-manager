# Run on ubuntu after reading /home/mizu/containers/AGENTS.md and checking git status.
# Changes only the app-specific upstream/location; validation and reload are separate.
from pathlib import Path
p=Path('/home/mizu/containers/nginx.conf')
s=p.read_text()
if 'upstream asset_manager {' in s:
    raise SystemExit('App upstream already exists; inspect before updating')
upstream='''    # Asset Atelier: private Kubernetes NodePort, no public Internet exposure.
    upstream asset_manager {
        server 192.168.101.11:30820;
        server 192.168.101.12:30820;
        server 192.168.101.13:30820;
        keepalive 8;
    }

'''
location='''    location = /asset-manager { return 301 /asset-manager/; }
    location /asset-manager/ {
        # Preserve the application base path; stream uploads without temporary disk files.
        proxy_pass http://asset_manager;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 1001m;
        proxy_read_timeout 900;
        proxy_send_timeout 900;
    }

'''
assert s.count('    upstream weather_zarr_viewer {')==1
assert s.count('    location = /weather-viewer {')==1
s=s.replace('    upstream weather_zarr_viewer {',upstream+'    upstream weather_zarr_viewer {')
s=s.replace('    location = /weather-viewer {',location+'    location = /weather-viewer {')
p.write_text(s)
