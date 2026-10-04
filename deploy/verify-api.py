"""Integration check against the deployed Rust API; touches only generated test UUIDs."""
import base64, hashlib, json, time, uuid, urllib.request, urllib.error, sys
base=sys.argv[1].rstrip('/')+'/api/'
created={}
def request(path,method='GET',body=None,headers=None):
    req=urllib.request.Request(base+path,data=body,method=method,headers=headers or {})
    try:
        with urllib.request.urlopen(req,timeout=90) as r:return r.status,r.read(),r.headers
    except urllib.error.HTTPError as e:return e.code,e.read(),e.headers

def upload(asset_id,name,data,version=None):
    boundary='asset-test-'+uuid.uuid4().hex
    m=json.dumps({'name':name,'tagIds':[]}).encode()
    body=b'--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n'+m+b'\r\n--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'+data+b'\r\n--'+boundary.encode()+b'--\r\n'
    h={'Content-Type':'multipart/form-data; boundary='+boundary}
    if version:h['If-Match']=version
    status,payload,_=request('assets/'+asset_id+'/content','PUT',body,h)
    assert status==200,(status,payload)
    result=json.loads(payload);created[asset_id]=result['version'];return result
try:
    assert request('tags')[0]==200
    data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=')
    asset_id=str(uuid.uuid4());start=time.monotonic();m=upload(asset_id,'integration-check.PNG',data)
    assert m['type']=='image' and 'image' in m['tagIds'] and m['sha256']==hashlib.sha256(data).hexdigest()
    assert not any(k in m for k in ['kind','role','parentAssetId'])
    assert request('assets/'+asset_id+'/content')[1]==data
    assert upload(asset_id,'integration-check.PNG',data)['version']=='1'
    status,body,_=request('assets/'+asset_id,'PATCH',json.dumps({'description':'updated'}).encode(),{'Content-Type':'application/json','If-Match':'1'})
    assert status==200,(status,body);created[asset_id]=json.loads(body)['version']
    assert request('assets/'+asset_id,'PATCH',b'{}',{'Content-Type':'application/json','If-Match':'1'})[0]==409
    assert request('assets/'+asset_id,'PATCH',b'{}',{'Content-Type':'application/json'})[0]==428
    assert request('assets/'+asset_id,'DELETE',headers={'If-Match':'2','Origin':'https://untrusted.example'})[0]==403
    print('PNG create/read/idempotency/CAS/origin checks passed in %.2fs'%(time.monotonic()-start))
    large=b'\x00'*(17*1024*1024);lid=str(uuid.uuid4());start=time.monotonic();upload(lid,'multipart-check.wav',large)
    result=request('assets/'+lid+'/content');assert result[0]==200 and hashlib.sha256(result[1]).digest()==hashlib.sha256(large).digest()
    print('17 MiB multipart roundtrip passed in %.2fs'%(time.monotonic()-start))
finally:
    for asset_id,version in created.items():
        status,body,_=request('assets/'+asset_id,'DELETE',headers={'If-Match':version})
        assert status==204,(status,body)
        assert request('assets/'+asset_id)[0]==404
        assert request('assets/'+asset_id,'DELETE',headers={'If-Match':version})[0]==204
    print('Removed only test assets:',len(created))
