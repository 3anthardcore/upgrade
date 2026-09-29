import contextlib, io, json, os, pathlib, runpy, socket, struct, sys, tempfile
from unittest import mock
script=str(pathlib.Path(__file__).with_name('capture-runtime.py'))
own='172.30.50.4'; db='172.30.50.5'; marker='REVIEW_PAYLOAD_CANARY_DO_NOT_PERSIST'
def check(condition,message):
    if not condition: raise RuntimeError(message)
def packet(source=own,destination=db,sport=40000,dport=3306,ihl=5,total=None,fragment=0,tcpwords=5,payload=b''):
    tcp=struct.pack('!HHLLBBHHH',sport,dport,0,0,tcpwords<<4,0x10,0,0,0)+payload
    options=b'\x01'*max(0,ihl*4-20)
    header=struct.pack('!BBHHHBBH4s4s',0x40|ihl,0,total if total is not None else 20+len(options)+len(tcp),1,fragment,64,6,0,socket.inet_aton(source),socket.inet_aton(destination))
    return b'\0'*12+b'\x08\x00'+header+options+tcp
def ether(kind): return b'\0'*12+struct.pack('!H',kind)+b'\0'*40
class FakeSocket:
    def __init__(self,frames,received,dropped): self.frames=iter(frames); self.received=received; self.dropped=dropped
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def fileno(self): return 123
    def bind(self,*args): pass
    def settimeout(self,*args): pass
    def recv(self,*args): return next(self.frames)
    def getsockopt(self,*args): return struct.pack('II',self.received,self.dropped)
original_readlink=os.readlink
valid=packet(payload=marker.encode())
cases=[
 ('valid-db-request',[valid],True,0,None),
 ('valid-db-response',[packet(db,own,3306,40000)],True,0,None),
 ('ipv4-options',[packet(ihl=6)],True,0,None),
 ('no-db-control',[ether(0x0806)],False,0,None),
 ('more-fragments',[valid,packet(fragment=0x2000)],False,0,None),
 ('noninitial-fragment',[valid,packet(fragment=1)],False,0,None),
 ('padding-fake-ports',[valid,packet(total=20)],False,0,None),
 ('tcp-data-offset-small',[valid,packet(tcpwords=4)],False,0,None),
 ('tcp-data-offset-large',[valid,packet(tcpwords=15)],False,0,None),
 ('truncated-ipv4',[valid,packet(total=100)],False,0,None),
 ('external-ipv4',[valid,packet(destination='1.1.1.1',dport=443)],False,0,None),
 ('ipv6',[valid,ether(0x86dd)],False,0,None),
 ('vlan',[valid,ether(0x8100)],False,0,None),
 ('qinq',[valid,ether(0x88a8)],False,0,None),
 ('unknown-ethernet',[valid,ether(0x8864)],False,0,None),
 ('dropped-packet',[valid],False,1,None),
 ('unread-packet',[valid],False,0,2),
 ('wrong-db-port-direction',[packet(sport=3306,dport=80)],False,0,None),
 ('malformed-ethernet',[valid,b'x'],False,0,None),
 ('bad-ihl',[valid,packet(ihl=4)],False,0,None),
]
results=[]
def execute(frames,received,dropped,arg_changes=None,interface_ip=own):
    with tempfile.TemporaryDirectory(prefix='upgrade-observer-review-') as temp:
        target=pathlib.Path(temp)/'result.json'; clock=iter([0.]+[0.]*len(frames)+[2.]*10)
        info=b'\0'*20+socket.inet_aton(interface_ip)+b'\0'*16
        args={'--own-ip':own,'--database-ip':db,'--subnet':'172.30.50.0/29','--expected-netns':'net:[fixture]','--seconds':'1','--output':str(target)}
        args.update(arg_changes or {}); argv=[script]+[value for pair in args.items() for value in pair]
        raw_calls=[]
        def factory(family,*args,**kwargs):
            if family==socket.AF_PACKET: raw_calls.append(1)
            return FakeSocket(frames,received,dropped)
        stdout=io.StringIO()
        with mock.patch.object(sys,'argv',argv),mock.patch('socket.socket',side_effect=factory),mock.patch('fcntl.ioctl',return_value=info),mock.patch('os.readlink',side_effect=lambda path,*a,**kw:'net:[fixture]' if str(path)=='/proc/self/ns/net' else original_readlink(path,*a,**kw)),mock.patch('time.monotonic',side_effect=lambda:next(clock)),contextlib.redirect_stdout(stdout):
            try: runpy.run_path(script,run_name='__main__')
            except SystemExit as error: code=error.code
        if not target.exists(): return {'exit':str(code),'raw_socket_calls':len(raw_calls)}
        result=json.loads(target.read_text()); ready=target.with_suffix('.json.ready')
        check(marker not in target.read_text()+ready.read_text()+stdout.getvalue(),'payload persisted')
        check(target.stat().st_mode&0o777==0o600 and ready.stat().st_mode&0o777==0o600,'mode not private')
        check(result['payload_persisted'] is False and result['historical_first_bootstrap']=='NOT_VERIFIED' and result['future_requests']=='NOT_VERIFIED','scope broadened')
        check(result['subnet']=='172.30.50.0/29' and result['interface']=='eth0','missing observation boundary')
        return {'exit':code,'status':result['status'],'frames_read':result['counts']['frames_read'],'raw_socket_calls':len(raw_calls)}
for name,frames,positive,dropped,received in cases:
    result=execute(frames,received if received is not None else len(frames),dropped)
    check(result['status']==('PASS' if positive else 'INCONCLUSIVE_OR_FAILED'),name+': wrong status')
    check(result['exit']==(0 if positive else 1),name+': wrong exit')
    check(result['frames_read']==len(frames),name+': frames omitted')
    results.append({'case':name,'check':'PASS','observer_status':result['status']})
for name,args,ip in [('wrong-namespace',{'--expected-netns':'net:[wrong]'},own),('wrong-interface',{},'172.30.50.6'),('seconds-zero',{'--seconds':'0'},own),('seconds-over-bound',{'--seconds':'61'},own),('same-peers',{'--database-ip':own},own)]:
    result=execute([valid],1,0,args,ip)
    check('status' not in result and result['raw_socket_calls']==0,name+': raw capture was allowed')
    results.append({'case':name,'check':'PASS','observer_status':'REJECTED_BEFORE_RAW_SOCKET'})
print(json.dumps({'scope':'OWN_OBSERVER_WITH_SOCKET_IOCTL_CLOCK_DOUBLES_NO_NETWORK','python_optimization':sys.flags.optimize,'checks':len(results),'pass':len(results),'fail':0,'results':results},indent=2))
