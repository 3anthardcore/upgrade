#!/usr/bin/env bash
# Managed, per-project Docker bridge guard. No CMS may run before apply + live probes.
set -Eeuo pipefail
umask 077
[[ $# == 6 ]] || { echo 'Usage: isolate-network.sh apply|check PROJECT NETWORK BRIDGE PRIVATE_IPV4_SUBNET MARKER_ROOT' >&2; exit 2; }
mode=$1 project=$2 network=$3 bridge=$4 subnet=$5 marker_root=$6
[[ $mode == apply || $mode == check ]] || exit 2
[[ $EUID == 0 && $project =~ ^[a-z0-9][a-z0-9-]{0,40}$ && $network == upgrade-$project-isolated && $bridge =~ ^br-upg[a-z0-9-]{1,9}$ ]] || exit 2
[[ $marker_root == /opt/upgrade/private/network-guards && ! -L /opt/upgrade && ! -L /opt/upgrade/private && ! -L $marker_root ]] || exit 2
for cmd in docker iptables python3 ip sha256sum cut mktemp flock; do command -v "$cmd" >/dev/null; done
exec 9>/run/lock/upgrade-network-guard.lock
flock -n 9 || { echo 'Another network guard operation is active' >&2; exit 3; }
suffix=$(printf '%s' "$project" | sha256sum | cut -c1-10)
input_chain=UPG_I_$suffix
forward_chain=UPG_F_$suffix
marker=$marker_root/$project.json
inspection=$(mktemp)
trap 'rm -f -- "$inspection"' EXIT
python3 -I - "$subnet" <<'PY'
import ipaddress,sys
n=ipaddress.IPv4Network(sys.argv[1],strict=True)
assert n.is_private and n.prefixlen==24 and not n.is_loopback and not n.is_link_local
PY
iptables -w 5 -S DOCKER-USER >/dev/null
if ! docker network inspect "$network" > "$inspection" 2>/dev/null; then
  [[ $mode == apply && ! -e $marker ]] || { echo 'Managed network is absent' >&2; exit 3; }
  python3 -I - "$subnet" <<'PY'
import ipaddress,json,subprocess,sys
candidate=ipaddress.IPv4Network(sys.argv[1])
routes=json.loads(subprocess.check_output(['ip','-j','-4','route','show']))
for route in routes:
    dst=route.get('dst','default')
    if dst=='default': continue
    assert not candidate.overlaps(ipaddress.IPv4Network(dst,strict=False)), 'Subnet overlaps host route'
ids=subprocess.check_output(['docker','network','ls','-q'],text=True).split()
for network in json.loads(subprocess.check_output(['docker','network','inspect',*ids])):
    for entry in network.get('IPAM',{}).get('Config',[]) or []:
        if entry.get('Subnet') and ':' not in entry['Subnet']:
            assert not candidate.overlaps(ipaddress.IPv4Network(entry['Subnet'])), 'Subnet overlaps Docker network'
PY
  ! ip link show "$bridge" >/dev/null 2>&1 || { echo 'Bridge name is already in use' >&2; exit 3; }
  docker network create --driver bridge --internal --subnet "$subnet" --opt "com.docker.network.bridge.name=$bridge" --label "upgrade.project=$project" "$network" >/dev/null
  docker network inspect "$network" > "$inspection"
fi
python3 -I - "$inspection" "$network" "$bridge" "$subnet" "$project" <<'PY'
import json,sys
n=json.load(open(sys.argv[1]))[0]
assert n['Name']==sys.argv[2] and n['Driver']=='bridge' and n['Internal'] is True and not n.get('EnableIPv6')
assert n.get('Options',{}).get('com.docker.network.bridge.name')==sys.argv[3]
assert [x['Subnet'] for x in n['IPAM']['Config']]==[sys.argv[4]]
assert n.get('Labels',{}).get('upgrade.project')==sys.argv[5]
PY
if [[ -e $marker ]]; then
  [[ -f $marker && ! -L $marker ]] || exit 3
  python3 -I - "$marker" "$project" "$network" "$bridge" "$subnet" <<'PY'
import json,os,sys
s=os.stat(sys.argv[1]);assert s.st_uid==0 and s.st_mode&0o077==0
assert json.load(open(sys.argv[1]))==dict(zip(['project','network','bridge','subnet'],sys.argv[2:]))
PY
elif [[ $mode == apply ]]; then
  ! iptables -w 5 -S "$input_chain" >/dev/null 2>&1 || { echo 'Unowned input chain exists' >&2; exit 3; }
  ! iptables -w 5 -S "$forward_chain" >/dev/null 2>&1 || { echo 'Unowned forward chain exists' >&2; exit 3; }
  install -d -m 0700 "$marker_root"
  python3 -I - "$marker" "$project" "$network" "$bridge" "$subnet" <<'PY'
import json,sys
with open(sys.argv[1],'x') as f: json.dump(dict(zip(['project','network','bridge','subnet'],sys.argv[2:])),f)
PY
else
  echo 'Ownership marker missing' >&2; exit 3
fi
ensure() { if ! iptables -w 5 -C "$@" 2>/dev/null; then [[ $mode == apply ]] || return 1; iptables -w 5 -A "$@"; fi; }
for chain in "$input_chain" "$forward_chain"; do
  if ! iptables -w 5 -S "$chain" >/dev/null 2>&1; then [[ $mode == apply ]] || exit 3; iptables -w 5 -N "$chain"; fi
done
python3 -I - "$input_chain" "$forward_chain" "$bridge" "$mode" <<'PY'
import re,shlex,subprocess,sys
ci,cf,bridge,mode=sys.argv[1:]
def normalize(rule):
    if '--ctstate' in rule:
        index=rule.index('--ctstate')+1;rule[index]=','.join(sorted(rule[index].split(',')))
    if rule[-2:]==['--reject-with','icmp-port-unreachable']:rule=rule[:-2]
    return rule
expected={ci:[['-A',ci,'-m','conntrack','--ctstate','ESTABLISHED,RELATED','-j','ACCEPT'],['-A',ci,'-j','REJECT']],cf:[['-A',cf,'-i',bridge,'!','-o',bridge,'-j','REJECT'],['-A',cf,'!','-i',bridge,'-o',bridge,'-j','REJECT']]}
for chain,wanted in expected.items():
    actual=[normalize(shlex.split(x)) for x in subprocess.check_output(['iptables','-w','5','-S',chain],text=True).splitlines() if x.startswith('-A ')]
    assert actual==(wanted if mode=='check' else wanted[:len(actual)]), 'Unexpected rule/order in owned chain; refusing to replace it'
PY
ensure "$input_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ensure "$input_chain" -j REJECT
ensure "$forward_chain" -i "$bridge" ! -o "$bridge" -j REJECT
ensure "$forward_chain" ! -i "$bridge" -o "$bridge" -j REJECT
python3 -I - "$input_chain" "$forward_chain" "$bridge" "$mode" "$marker_root" <<'PY'
import hashlib,ipaddress,json,os,pathlib,re,shlex,stat,subprocess,sys
ci,cf,bridge,mode,marker_root=sys.argv[1:]
def normalize(rule):
    if '--ctstate' in rule:
        index=rule.index('--ctstate')+1;rule[index]=','.join(sorted(rule[index].split(',')))
    if rule[-2:]==['--reject-with','icmp-port-unreachable']:rule=rule[:-2]
    return rule
def rules(chain):return [normalize(shlex.split(x)[2:]) for x in subprocess.check_output(['iptables','-w','5','-S',chain],text=True).splitlines() if x.startswith('-A ')]
def owners():
    root=pathlib.Path(marker_root);meta=root.lstat()
    assert stat.S_ISDIR(meta.st_mode) and meta.st_uid==0 and meta.st_mode&0o077==0, 'Private guard marker root required'
    found={}
    for path in root.glob('*.json'):
        meta=path.lstat()
        assert stat.S_ISREG(meta.st_mode) and meta.st_uid==0 and meta.st_mode&0o077==0 and meta.st_size<=2048, 'Invalid guard ownership marker'
        owner=json.loads(path.read_text());project=owner.get('project','')
        assert re.fullmatch(r'[a-z0-9][a-z0-9-]{0,40}',project) and path.name==project+'.json' and owner.get('network')=='upgrade-'+project+'-isolated' and re.fullmatch(r'br-upg[a-z0-9-]{1,9}',owner.get('bridge','')), 'Guard ownership binding mismatch'
        subnet=ipaddress.IPv4Network(owner.get('subnet',''),strict=True)
        assert subnet.is_private and subnet.prefixlen==24, 'Guard ownership subnet mismatch'
        suffix=hashlib.sha256(project.encode()).hexdigest()[:10]
        assert suffix not in found, 'Ambiguous guard ownership'
        found[suffix]=owner
    return found
known_owners=owners()
def verify_prefix_guard(chain,rule):
    name=rule[-1];owner=known_owners.get(name[6:])
    assert owner is not None, 'Unowned leading guard chain'
    other_bridge=owner['bridge']
    if chain=='INPUT':
        assert rule==['-i',other_bridge,'-j',name], 'Guard input bridge mismatch'
        expected=[['-m','conntrack','--ctstate','ESTABLISHED,RELATED','-j','ACCEPT'],['-j','REJECT']]
    else:
        expected=[['-i',other_bridge,'!','-o',other_bridge,'-j','REJECT'],['!','-i',other_bridge,'-o',other_bridge,'-j','REJECT']]
    assert rules(name)==expected, 'Unverified leading guard rules'
def leading_guards(chain,current):
    prefix=[]
    for rule in current:
        managed=(len(rule)==4 and rule[0]=='-i' and re.fullmatch(r'br-upg[a-z0-9-]{1,9}',rule[1]) and rule[2]=='-j' and re.fullmatch(r'UPG_I_[0-9a-f]{10}',rule[3])) if chain=='INPUT' else (len(rule)==2 and rule[0]=='-j' and re.fullmatch(r'UPG_F_[0-9a-f]{10}',rule[1]))
        if not managed:break
        verify_prefix_guard(chain,rule)
        prefix.append(rule)
    return prefix
for chain,owned in [('INPUT',['-i',bridge,'-j',ci]),('DOCKER-USER',['-j',cf])]:
    current=rules(chain)
    if mode=='apply' and (owned not in leading_guards(chain,current) or current.count(owned)!=1):
        # Install the guard first, then remove only exact duplicate jumps; never leave an unguarded gap.
        subprocess.check_call(['iptables','-w','5','-I',chain,'1',*owned])
        current=rules(chain)
        for index in reversed(range(1,len(current))):
            if current[index]==owned:subprocess.check_call(['iptables','-w','5','-D',chain,str(index+1)])
    current=rules(chain)
    # Several isolated projects may coexist; every guard precedes unrelated rules.
    assert owned in leading_guards(chain,current) and current.count(owned)==1, 'Guard jump must be unique in leading managed guard prefix'
PY
printf 'SCOPED_NETWORK_RULES_PRESENT project=%s network=%s bridge=%s live_probes=REQUIRED restart_policy=NO_AUTO_START\n' "$project" "$network" "$bridge"
