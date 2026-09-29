#!/usr/bin/env python3
"""Bounded metadata-only observer in an explicitly selected PHP network namespace.

Run with host nsenter --net. This does not start PHP, grant egress, capture payload
to disk, or prove the historical first bootstrap. A positive DB frame is required.
"""
import argparse
import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import socket
import struct
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--own-ip', required=True)
p.add_argument('--database-ip', required=True)
p.add_argument('--subnet', required=True)
p.add_argument('--expected-netns', required=True)
p.add_argument('--seconds', type=int, default=20)
p.add_argument('--output', required=True)
args = p.parse_args()
def require(condition, message):
    if not condition:
        raise SystemExit(message)

own = ipaddress.IPv4Address(args.own_ip)
database = ipaddress.IPv4Address(args.database_ip)
subnet = ipaddress.IPv4Network(args.subnet)
require(own in subnet and database in subnet and own != database, 'Invalid peer bindings')
require(1 <= args.seconds <= 60, 'Observation must last between 1 and 60 seconds')
namespace = os.readlink('/proc/self/ns/net')
require(namespace == args.expected_netns, 'Unexpected network namespace')
output = Path(args.output)
require(output.is_absolute() and not output.exists() and not output.is_symlink(),
        'Output must be a new absolute path')
require(output.parent.resolve() == output.parent and output.parent.is_dir(),
        'Output parent must be an existing directory without symlinks')
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
    info = fcntl.ioctl(probe.fileno(), 0x8915, struct.pack('256s', b'eth0'))
    require(socket.inet_ntoa(info[20:24]) == str(own), 'Unexpected PHP interface')

counts = dict(frames_read=0, ipv4_frames=0, own_database_tcp_frames=0,
              external_ipv4_from_php=0, ipv6_frames=0, malformed_frames=0,
              unsupported_ethernet_frames=0)
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3)) as reader:
    reader.bind(('eth0', 0))
    reader.settimeout(0.25)
    ready = output.with_suffix(output.suffix + '.ready')
    with ready.open('x') as stream:
        stream.write(json.dumps({'namespace': namespace, 'own_ip': str(own)}))
    ready.chmod(0o600)
    deadline = time.monotonic() + args.seconds
    while time.monotonic() < deadline:
        try:
            frame = reader.recv(65535)
        except socket.timeout:
            continue
        counts['frames_read'] += 1
        if len(frame) < 14:
            counts['malformed_frames'] += 1
            continue
        ether_type = int.from_bytes(frame[12:14], 'big')
        if ether_type == 0x86dd:
            counts['ipv6_frames'] += 1
        if ether_type not in (0x0800, 0x0806, 0x86dd):
            counts['unsupported_ethernet_frames'] += 1
        if ether_type != 0x0800:
            continue
        if len(frame) < 34 or frame[14] >> 4 != 4:
            counts['malformed_frames'] += 1
            continue
        header = (frame[14] & 15) * 4
        total = int.from_bytes(frame[16:18], 'big')
        fragment = int.from_bytes(frame[20:22], 'big')
        if (header < 20 or total < header or len(frame) < 14 + total
                or fragment & 0x3fff):
            counts['malformed_frames'] += 1
            continue
        source = ipaddress.IPv4Address(frame[26:30])
        destination = ipaddress.IPv4Address(frame[30:34])
        counts['ipv4_frames'] += 1
        if source == own and destination not in subnet:
            counts['external_ipv4_from_php'] += 1
        if frame[23] == 6:
            if total - header < 20:
                counts['malformed_frames'] += 1
                continue
            tcp_header = (frame[14 + header + 12] >> 4) * 4
            if tcp_header < 20 or tcp_header > total - header:
                counts['malformed_frames'] += 1
                continue
            source_port, destination_port = struct.unpack(
                '!HH', frame[14 + header:18 + header])
            if ((source == own and destination == database and destination_port == 3306)
                    or (source == database and destination == own and source_port == 3306)):
                counts['own_database_tcp_frames'] += 1
    received, dropped = struct.unpack('II', reader.getsockopt(263, 6, 8))
passed = (counts['own_database_tcp_frames'] > 0
          and counts['external_ipv4_from_php'] == 0
          and counts['ipv6_frames'] == 0
          and counts['unsupported_ethernet_frames'] == 0
          and counts['malformed_frames'] == 0 and dropped == 0
          and received == counts['frames_read'])
result = {'scope': 'CURRENT_PHP_NAMESPACE_OBSERVATION_WINDOW_ONLY',
          'status': 'PASS' if passed else 'INCONCLUSIVE_OR_FAILED',
          'started_at': start, 'seconds': args.seconds, 'namespace': namespace,
          'own_ip': str(own), 'database_ip': str(database), 'subnet': str(subnet),
          'interface': 'eth0', 'counts': counts,
          'socket_received': received, 'socket_dropped': dropped,
          'payload_persisted': False, 'historical_first_bootstrap': 'NOT_VERIFIED',
          'future_requests': 'NOT_VERIFIED', 'http_result': 'SEPARATE_RECEIPT_REQUIRED'}
with output.open('x') as stream:
    json.dump(result, stream, indent=2)
output.chmod(0o600)
print(json.dumps(result))
raise SystemExit(0 if passed else 1)
